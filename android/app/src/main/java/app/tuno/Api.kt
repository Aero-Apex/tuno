package app.tuno

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cache
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// ---- Models (parsed by hand from the server's JSON: no extra libraries to ship or load) ----

data class User(val name: String, val quotaBytes: Long, val isAdmin: Boolean)

data class Track(
    val id: Long,
    val title: String,
    val artist: String,
    val album: String?,
    val duration: Double?,
    val cover: String?,
    val liked: Boolean,
)

data class Playlist(val id: Long, val name: String, val count: Int, val cover: String?, val pending: Int)

data class Job(
    val id: Long,
    val status: String,
    val title: String?,
    val artist: String?,
    val url: String?,
    val progress: Double,
    val error: String?,
)

data class SearchResult(
    val key: String,
    val source: String,
    val kind: String,
    val url: String,
    val title: String,
    val artist: String,
    val duration: Double?,
    val thumbnail: String?,
    val trackId: Long?,
)

data class Colors(val accent: String, val bg: String, val surface: String, val elevated: String, val text: String, val muted: String)

class ApiException(val code: Int, message: String) : Exception(message)

private fun JSONObject.str(key: String): String? = if (isNull(key) || !has(key)) null else getString(key)
private fun JSONObject.dbl(key: String): Double? = if (isNull(key) || !has(key)) null else getDouble(key)

private fun parseTrack(o: JSONObject) = Track(
    id = o.getLong("id"),
    title = o.optString("title"),
    artist = o.optString("artist"),
    album = o.str("album"),
    duration = o.dbl("duration"),
    cover = o.str("cover"),
    liked = o.optBoolean("liked"),
)

private fun <T> JSONArray.map(f: (JSONObject) -> T): List<T> = List(length()) { f(getJSONObject(it)) }

/** Saved settings: which server to talk to and the login session. */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("tuno", Context.MODE_PRIVATE)
    var server: String
        get() = sp.getString("server", DEFAULT_SERVER)!!
        set(v) = sp.edit().putString("server", v).apply()
    var session: String?
        get() = sp.getString("session", null)
        set(v) = sp.edit().putString("session", v).apply()

    companion object {
        const val DEFAULT_SERVER = "https://tuno.eu.cc"
    }
}

/** Turns what someone typed into a clean base URL ("tuno.eu.cc" -> "https://tuno.eu.cc"). */
fun normalizeServer(input: String): String? {
    var s = input.trim().trimEnd('/')
    if (s.isEmpty()) return null
    if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
    return if (s.toHttpUrlOrNull() != null) s else null
}

class Api(ctx: Context, private val prefs: Prefs) {
    /** Called when the server says the session ended (expired, or the password was changed). */
    var onAuthLost: () -> Unit = {}

    val server: String get() = prefs.server

    /**
     * One shared client for the API, cover art and audio. It sends the login cookie to our server only, and keeps a small
     * disk cache so lists the server says haven't changed (ETag) cost a tiny "not modified" reply instead of a full download.
     */
    val client: OkHttpClient = OkHttpClient.Builder()
        .cache(Cache(File(ctx.cacheDir, "http"), 20L * 1024 * 1024))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val ours = original.url.host == prefs.server.toHttpUrlOrNull()?.host
            val token = prefs.session
            val req = if (ours && token != null) original.newBuilder().header("Cookie", "tuno_session=$token").build() else original
            val res = chain.proceed(req)
            if (ours) {
                for (h in res.headers("Set-Cookie")) {
                    if (h.startsWith("tuno_session=")) prefs.session = h.substringAfter('=').substringBefore(';').ifEmpty { null }
                }
                if (res.code == 401 && !req.url.encodedPath.startsWith("/api/auth/")) onAuthLost()
            }
            res
        }
        .build()

    /** Absolute URL for a path the server returned (covers) or a remote image, routed through the server's image proxy. */
    fun imageUrl(path: String?): String? = when {
        path == null -> null
        path.startsWith("/") -> server + path
        else -> "$server/api/img?url=${enc(path)}"
    }

    fun streamUrl(trackId: Long) = "$server/api/stream/$trackId"
    fun previewUrl(url: String) = "$server/api/preview?url=${enc(url)}"

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private suspend fun call(method: String, path: String, body: JSONObject? = null): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(server + path)
        val payload = body?.toString()?.toRequestBody("application/json".toMediaType())
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> if (payload != null) builder.delete(payload) else builder.delete()
            else -> builder.method(method, payload ?: "{}".toRequestBody("application/json".toMediaType()))
        }
        client.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val msg = runCatching { JSONObject(text).getString("error") }.getOrNull() ?: "Request failed (${res.code})"
                throw ApiException(res.code, msg)
            }
            text
        }
    }

    private fun parseUser(o: JSONObject) = User(o.optString("name"), o.optLong("quotaBytes"), o.optBoolean("isAdmin"))

    suspend fun login(password: String): User {
        val r = JSONObject(call("POST", "/api/auth/login", JSONObject().put("password", password)))
        return parseUser(r.getJSONObject("user"))
    }

    /** The signed-in user and how many bytes of music they store. */
    suspend fun me(): Pair<User, Long> {
        val r = JSONObject(call("GET", "/api/auth/me"))
        return parseUser(r.getJSONObject("user")) to r.optLong("used")
    }

    suspend fun logout() {
        runCatching { call("POST", "/api/auth/logout") }
        prefs.session = null
        client.cache?.evictAll()
    }

    /** The colors chosen in the web app's Appearance settings, so both apps look the same. */
    suspend fun colors(): Colors? = runCatching {
        val c = JSONObject(call("GET", "/api/settings")).getJSONObject("theme").getJSONObject("colors")
        Colors(c.getString("accent"), c.getString("bg"), c.getString("surface"), c.getString("elevated"), c.getString("text"), c.getString("muted"))
    }.getOrNull()

    suspend fun tracks(): List<Track> = JSONArray(call("GET", "/api/tracks")).map(::parseTrack)

    suspend fun playlists(): List<Playlist> = JSONArray(call("GET", "/api/playlists")).map {
        Playlist(it.getLong("id"), it.optString("name"), it.optInt("count"), it.str("cover"), it.optInt("pending"))
    }

    suspend fun playlistTracks(id: Long): List<Track> = JSONObject(call("GET", "/api/playlists/$id")).getJSONArray("tracks").map(::parseTrack)

    suspend fun search(q: String, source: String): List<SearchResult> =
        JSONArray(call("GET", "/api/search?q=${enc(q)}&source=$source")).map {
            SearchResult(
                key = it.optString("key"),
                source = it.optString("source"),
                kind = it.optString("kind", "track"),
                url = it.optString("url"),
                title = it.optString("title"),
                artist = it.optString("artist"),
                duration = it.dbl("duration"),
                thumbnail = it.str("thumbnail"),
                trackId = if (it.isNull("trackId") || !it.has("trackId")) null else it.getLong("trackId"),
            )
        }

    /** Starts downloading a link (song, album or playlist) on the server. Returns a short message for the user. */
    suspend fun importUrl(url: String): String {
        val r = JSONObject(call("POST", "/api/import", JSONObject().put("url", url)))
        val queued = r.optInt("queued")
        return when {
            queued > 0 -> "Downloading ${if (queued == 1) "1 song" else "$queued songs"}"
            else -> "Already in your library"
        }
    }

    suspend fun jobs(): List<Job> = JSONObject(call("GET", "/api/jobs")).getJSONArray("jobs").map {
        Job(it.getLong("id"), it.optString("status"), it.str("title"), it.str("artist"), it.str("url"), it.optDouble("progress", 0.0), it.str("error"))
    }

    suspend fun cancelJob(id: Long) { call("POST", "/api/jobs/$id/cancel", JSONObject()) }
    suspend fun retryJob(id: Long) { call("POST", "/api/jobs/$id/retry", JSONObject()) }
    suspend fun clearFinished() { call("DELETE", "/api/jobs/finished") }

    suspend fun setLiked(id: Long, liked: Boolean) { call("PATCH", "/api/tracks/$id", JSONObject().put("liked", liked)) }
    suspend fun deleteTrack(id: Long) { call("DELETE", "/api/tracks/$id") }
    suspend fun markPlayed(id: Long) { runCatching { call("POST", "/api/tracks/$id/play", JSONObject()) } }
}
