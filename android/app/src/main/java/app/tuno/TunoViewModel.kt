package app.tuno

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import coil.Coil
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

enum class Session { Loading, SignedOut, Offline, SignedIn }

class TunoViewModel(app: Application) : AndroidViewModel(app) {
    private val tuno = app as TunoApp
    private val prefs = tuno.prefs
    val api = tuno.api
    val player = PlayerState(app, api)

    var session by mutableStateOf(Session.Loading)
        private set
    var user by mutableStateOf<User?>(null)
        private set
    var used by mutableLongStateOf(0L)
        private set
    var colors by mutableStateOf<Colors?>(null)
        private set
    var tracks by mutableStateOf<List<Track>>(emptyList())
        private set
    var playlists by mutableStateOf<List<Playlist>>(emptyList())
        private set
    var jobs by mutableStateOf<List<Job>>(emptyList())
        private set
    var libraryLoading by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var message by mutableStateOf<String?>(null)

    var server: String
        get() = prefs.server
        set(v) { prefs.server = v }

    // Search
    var results by mutableStateOf<List<SearchResult>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    var searchedFor by mutableStateOf("")
        private set

    // Playlist detail
    var openPlaylist by mutableStateOf<Playlist?>(null)
        private set
    var playlistTracks by mutableStateOf<List<Track>>(emptyList())
        private set

    init {
        api.onAuthLost = {
            viewModelScope.launch {
                if (session == Session.SignedIn) {
                    player.stop()
                    session = Session.SignedOut
                }
            }
        }
        bootstrap()
    }

    fun bootstrap() {
        session = Session.Loading
        error = null
        viewModelScope.launch {
            if (prefs.session == null) {
                session = Session.SignedOut
                return@launch
            }
            try {
                val (u, bytes) = api.me()
                signedIn(u, bytes)
            } catch (e: ApiException) {
                session = Session.SignedOut
            } catch (e: Exception) {
                error = "Can't reach ${prefs.server}"
                session = Session.Offline
            }
        }
    }

    private suspend fun signedIn(u: User, bytes: Long) {
        user = u
        used = bytes
        session = Session.SignedIn
        refreshLibrary()
        viewModelScope.launch { api.colors()?.let { colors = it } }
    }

    fun login(serverInput: String, password: String) {
        val normalized = normalizeServer(serverInput)
        if (normalized == null) {
            error = "That doesn't look like a web address"
            return
        }
        if (password.isEmpty()) {
            error = "Enter your password"
            return
        }
        busy = true
        error = null
        prefs.server = normalized
        viewModelScope.launch {
            try {
                val u = api.login(password)
                val bytes = runCatching { api.me().second }.getOrDefault(0L)
                signedIn(u, bytes)
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = "Can't reach $normalized"
            } finally {
                busy = false
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            player.stop()
            api.logout()
            tracks = emptyList()
            playlists = emptyList()
            jobs = emptyList()
            results = emptyList()
            colors = null
            user = null
            openPlaylist = null
            session = Session.SignedOut
        }
    }

    /** Reloads songs, playlists and the storage meter (cheap when nothing changed: the server answers "not modified"). */
    fun refreshLibrary() {
        viewModelScope.launch {
            libraryLoading = true
            try {
                val t = async { api.tracks() }
                val p = async { api.playlists() }
                tracks = t.await()
                playlists = p.await()
                api.me().let { used = it.second }
            } catch (e: Exception) {
                if (e !is ApiException || e.code != 401) message = e.message ?: "Couldn't refresh"
            } finally {
                libraryLoading = false
            }
        }
    }

    fun refreshJobs() {
        viewModelScope.launch {
            val before = jobs.count { it.status == "done" }
            try {
                jobs = api.jobs()
            } catch (e: Exception) {
                return@launch
            }
            // Something finished since last time: the library has new songs.
            if (jobs.count { it.status == "done" } != before && before >= 0) refreshLibrary()
        }
    }

    fun activeJobs() = jobs.count { it.status == "running" || it.status == "queued" }

    fun search(query: String, source: String) {
        val q = query.trim()
        if (q.isEmpty()) {
            results = emptyList()
            searchedFor = ""
            return
        }
        viewModelScope.launch {
            searching = true
            try {
                results = api.search(q, source)
                searchedFor = q
            } catch (e: Exception) {
                message = e.message ?: "Search failed"
            } finally {
                searching = false
            }
        }
    }

    fun download(url: String) {
        viewModelScope.launch {
            try {
                message = api.importUrl(url)
                refreshJobs()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't start the download"
            }
        }
    }

    fun toggleLike(t: Track) {
        val liked = !t.liked
        tracks = tracks.map { if (it.id == t.id) it.copy(liked = liked) else it }
        playlistTracks = playlistTracks.map { if (it.id == t.id) it.copy(liked = liked) else it }
        viewModelScope.launch {
            try {
                api.setLiked(t.id, liked)
            } catch (e: Exception) {
                message = e.message
                refreshLibrary()
            }
        }
    }

    fun delete(t: Track) {
        viewModelScope.launch {
            try {
                api.deleteTrack(t.id)
                tracks = tracks.filter { it.id != t.id }
                playlistTracks = playlistTracks.filter { it.id != t.id }
                message = "Deleted “${t.title}”"
                refreshLibrary()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't delete"
            }
        }
    }

    fun cancelJob(j: Job) = viewModelScope.launch { runCatching { api.cancelJob(j.id) }; refreshJobs() }
    fun retryJob(j: Job) = viewModelScope.launch { runCatching { api.retryJob(j.id) }; refreshJobs() }
    fun clearFinished() = viewModelScope.launch { runCatching { api.clearFinished() }; refreshJobs() }

    fun open(p: Playlist?) {
        openPlaylist = p
        playlistTracks = emptyList()
        if (p == null) return
        viewModelScope.launch {
            try {
                playlistTracks = api.playlistTracks(p.id)
            } catch (e: Exception) {
                message = e.message ?: "Couldn't open the playlist"
            }
        }
    }

    /** Frees the on-device audio and cover caches. */
    fun clearCaches() {
        val cache = tuno.audioCache
        for (key in cache.keys.toList()) runCatching { cache.removeResource(key) }
        api.client.cache?.evictAll()
        Coil.imageLoader(tuno).apply {
            memoryCache?.clear()
            diskCache?.clear()
        }
        message = "Cleared"
    }

    fun cacheBytes(): Long = tuno.audioCache.cacheSpace

    override fun onCleared() {
        player.release()
    }
}
