package app.tuno

import android.app.Application
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import coil.Coil
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

enum class Session { Loading, SignedOut, Offline, SignedIn }

enum class Tab { Home, Search, Library }

/** Pages pushed on top of a tab, Spotify-style: each tab keeps its own history. */
sealed interface Route {
    data class PlaylistPage(val id: Long) : Route
    data object Liked : Route
    data object AllSongs : Route
    data class ArtistPage(val name: String) : Route
    data class AlbumPage(val name: String) : Route
    data object Recents : Route
    data object Downloads : Route
    data object Settings : Route
}

/** Bottom sheets and dialogs (only one is open at a time). */
sealed interface Sheet {
    data class TrackMenu(val track: Track, val playlistId: Long? = null) : Sheet
    data class AddTo(val tracks: List<Track>) : Sheet
    data class Link(val prefill: String = "") : Sheet
    data object Create : Sheet
    data object Queue : Sheet
    data class NewPlaylist(val trackIds: List<Long> = emptyList()) : Sheet
    data class Rename(val playlist: Playlist) : Sheet
    data class PlaylistMenu(val playlist: Playlist) : Sheet
    data class ConfirmDeleteTrack(val track: Track) : Sheet
    data class ConfirmDeletePlaylist(val playlist: Playlist) : Sheet
}

data class ArtistInfo(val name: String, val cover: String?, val count: Int, val plays: Int, val lastPlayed: Long, val added: Long)
data class AlbumInfo(val name: String, val artist: String, val cover: String?, val count: Int, val added: Long)

const val NAV_HEIGHT = 64
const val MINI_HEIGHT = 56

/** Height of the mini player + navigation bar that float over the bottom of every page. */
@Composable
fun TunoViewModel.bottomInset(): Dp {
    val nav = with(LocalDensity.current) { WindowInsets.navigationBars.getBottom(this).toDp() }
    return nav + NAV_HEIGHT.dp + (if (player.hasItem) (MINI_HEIGHT + 8).dp else 0.dp) + 12.dp
}

class TunoViewModel(app: Application) : AndroidViewModel(app) {
    private val tuno = app as TunoApp
    private val prefs = tuno.prefs
    val api = tuno.api
    val player = PlayerState(app, api)
    val updates = tuno.updates

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
    var loadedOnce by mutableStateOf(false)
        private set
    /** Bumped each time the library is reloaded from the server (Home re-sorts its rows then, not on every play). */
    var libraryVersion by mutableIntStateOf(0)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var message by mutableStateOf<String?>(null)

    var server: String
        get() = prefs.server
        set(v) { prefs.server = v }

    // ---- Navigation and overlays
    var tab by mutableStateOf(Tab.Home)
        private set
    private val stacks: Map<Tab, SnapshotStateList<Route>> = Tab.entries.associateWith { mutableStateListOf() }
    var drawerOpen by mutableStateOf(false)
    var playerOpen by mutableStateOf(false)
    var sheet by mutableStateOf<Sheet?>(null)
    /** A link shared to Tuno from another app, waiting to be shown in the download sheet. */
    var pendingLink by mutableStateOf<String?>(null)
    /** True while the app is on screen (download progress is only polled then). */
    var foreground = true

    fun stack(t: Tab = tab): List<Route> = stacks.getValue(t)
    val route: Route? get() = stacks.getValue(tab).lastOrNull()

    fun navigate(r: Route) {
        sheet = null
        playerOpen = false
        drawerOpen = false
        val s = stacks.getValue(tab)
        if (s.lastOrNull() != r) s.add(r)
        if (r is Route.PlaylistPage) loadPlaylist(r.id)
    }

    /** Spotify's tab bar: tapping the open tab again goes back to its start page. */
    fun selectTab(t: Tab) {
        if (t == tab) stacks.getValue(t).clear() else tab = t
    }

    fun canGoBack() = stacks.getValue(tab).isNotEmpty() || tab != Tab.Home

    fun back() {
        val s = stacks.getValue(tab)
        if (s.isNotEmpty()) s.removeAt(s.lastIndex) else tab = Tab.Home
    }

    // ---- Search
    var query by mutableStateOf("")
    var searchSource by mutableStateOf("ytmusic")
    var results by mutableStateOf<List<SearchResult>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    var searchedFor by mutableStateOf("")
        private set
    var recentSearches by mutableStateOf(prefs.recentSearches)
        private set
    /** Links already sent to the server this session (their download buttons turn into checks). */
    var requested by mutableStateOf<Set<String>>(emptySet())
        private set

    // ---- Library view settings
    var libraryGrid by mutableStateOf(prefs.libraryGrid)
        private set
    var librarySort by mutableStateOf(prefs.librarySort)
        private set

    fun toggleLibraryGrid() {
        libraryGrid = !libraryGrid
        prefs.libraryGrid = libraryGrid
    }

    fun cycleLibrarySort() {
        librarySort = (librarySort + 1) % 3
        prefs.librarySort = librarySort
    }

    // ---- Playlist pages (songs of each opened playlist)
    var playlistTracks by mutableStateOf<Map<Long, List<Track>>>(emptyMap())
        private set

    // ---- Derived library views
    val liked by derivedStateOf { tracks.filter { it.liked } }

    val artists by derivedStateOf {
        tracks.groupBy { it.mainArtist.lowercase() }.values.map { group ->
            ArtistInfo(
                name = group.first().mainArtist,
                cover = group.firstOrNull { it.cover != null }?.cover,
                count = group.size,
                plays = group.sumOf { it.playCount },
                lastPlayed = group.maxOf { it.lastPlayedAt },
                added = group.maxOf { it.addedAt },
            )
        }
    }

    val albums by derivedStateOf {
        tracks.filter { it.album != null }.groupBy { it.album!!.lowercase() }.values.map { group ->
            AlbumInfo(group.first().album!!, group.first().mainArtist, group.firstOrNull { it.cover != null }?.cover, group.size, group.maxOf { it.addedAt })
        }
    }

    val recentlyPlayed by derivedStateOf { tracks.filter { it.lastPlayedAt > 0 }.sortedByDescending { it.lastPlayedAt }.take(20) }
    val recentlyAdded by derivedStateOf { tracks.sortedByDescending { it.addedAt }.take(20) }
    val onRepeat by derivedStateOf { tracks.filter { it.playCount > 1 }.sortedByDescending { it.playCount }.take(20) }

    fun artistTracks(name: String) = tracks.filter { t -> t.artists.any { it.equals(name, ignoreCase = true) } }
    fun albumTracks(name: String) = tracks.filter { it.album.equals(name, ignoreCase = true) }

    init {
        api.onAuthLost = {
            viewModelScope.launch {
                if (session == Session.SignedIn) {
                    player.stop()
                    session = Session.SignedOut
                }
            }
        }
        player.onError = { message = it }
        // Updates: install a downloaded one as soon as no music is playing, and tell the person when Android needs their OK.
        viewModelScope.launch {
            snapshotFlow { player.playing }.collect { playing ->
                if (session == Session.SignedIn) updates.installIfIdle(playing)
            }
        }
        viewModelScope.launch {
            snapshotFlow { updates.state }.collect { s ->
                if (s is UpdateState.NeedsPermission) message = "Tuno ${s.info.version} is ready. Allow installing it in Settings > Updates."
                if (s is UpdateState.Ready) updates.installIfIdle(player.playing)
            }
        }
        player.onPlayed = { id ->
            val now = System.currentTimeMillis()
            tracks = tracks.map { if (it.id == id) it.copy(playCount = it.playCount + 1, lastPlayedAt = now) else it }
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

    private fun signedIn(u: User, bytes: Long) {
        user = u
        used = bytes
        session = Session.SignedIn
        refreshLibrary()
        refreshJobs()
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
            playlistTracks = emptyMap()
            jobs = emptyList()
            results = emptyList()
            query = ""
            colors = null
            user = null
            loadedOnce = false
            stacks.values.forEach { it.clear() }
            tab = Tab.Home
            drawerOpen = false
            sheet = null
            playerOpen = false
            session = Session.SignedOut
        }
    }

    private var lastRefresh = 0L

    /** Reloads songs, playlists and the storage meter (cheap when nothing changed: the server answers "not modified"). */
    fun refreshLibrary() {
        lastRefresh = System.currentTimeMillis()
        viewModelScope.launch {
            libraryLoading = true
            try {
                val t = async { api.tracks() }
                val p = async { api.playlists() }
                tracks = t.await()
                playlists = p.await()
                loadedOnce = true
                libraryVersion++
                // Keep open playlist pages current too.
                for (r in stacks.values.flatten()) if (r is Route.PlaylistPage) loadPlaylist(r.id)
                api.me().let { used = it.second }
            } catch (e: Exception) {
                if (e !is ApiException || e.code != 401) message = e.message ?: "Couldn't refresh"
            } finally {
                libraryLoading = false
            }
        }
    }

    /** Called when the app comes back to the screen: refreshes if the data is more than half a minute old. */
    fun onResume() {
        foreground = true
        if (session == Session.SignedIn && System.currentTimeMillis() - lastRefresh > 30_000) {
            refreshLibrary()
            refreshJobs()
        }
        if (session == Session.SignedIn) {
            updates.onResumed(getApplication())
            updates.checkIfDue()
        }
    }

    private var poller: CoJob? = null

    fun refreshJobs() {
        viewModelScope.launch {
            val before = jobs.count { it.status == "done" }
            try {
                jobs = api.jobs()
            } catch (e: Exception) {
                return@launch
            }
            // Something finished since last time: the library has new songs.
            if (jobs.count { it.status == "done" } != before) refreshLibrary()
            if (activeJobs() > 0) pollJobs()
        }
    }

    /** Follows download progress every few seconds while something is downloading and the app is on screen. */
    private fun pollJobs() {
        if (poller?.isActive == true) return
        poller = viewModelScope.launch {
            while (true) {
                delay(3000)
                if (!foreground) continue
                val before = jobs.count { it.status == "done" }
                jobs = runCatching { api.jobs() }.getOrNull() ?: continue
                if (jobs.count { it.status == "done" } != before) refreshLibrary()
                if (activeJobs() == 0) break
            }
        }
    }

    fun activeJobs() = jobs.count { it.active }

    private var lastSearch = ""

    /** Runs a search (skipped when the same words on the same source were just searched). */
    fun search(q: String = query, source: String = searchSource) {
        val text = q.trim()
        if (text.isEmpty()) {
            results = emptyList()
            searchedFor = ""
            lastSearch = ""
            return
        }
        val key = "$source|$text"
        if (key == lastSearch) return
        lastSearch = key
        viewModelScope.launch {
            searching = true
            try {
                val found = api.search(text, source)
                if (lastSearch == key) {
                    results = found
                    searchedFor = text
                }
            } catch (e: Exception) {
                lastSearch = ""
                message = e.message ?: "Search failed"
            } finally {
                searching = false
            }
        }
    }

    /** Adds a search to "Recent searches" (when it was actually used, not for every letter typed). */
    fun rememberSearch(q: String = query) {
        val text = q.trim()
        if (text.isEmpty() || isLinkText(text)) return
        recentSearches = (listOf(text) + recentSearches.filterNot { it.equals(text, ignoreCase = true) }).take(12)
        prefs.recentSearches = recentSearches
    }

    private fun isLinkText(s: String) = s.startsWith("http://") || s.startsWith("https://") || s.startsWith("spotify:")

    fun removeRecentSearch(q: String?) {
        recentSearches = if (q == null) emptyList() else recentSearches - q
        prefs.recentSearches = recentSearches
    }

    fun download(url: String) {
        requested = requested + url
        viewModelScope.launch {
            try {
                message = api.importUrl(url)
                refreshJobs()
            } catch (e: Exception) {
                requested = requested - url
                message = e.message ?: "Couldn't start the download"
            }
        }
    }

    fun toggleLike(t: Track) {
        val liked = !t.liked
        fun List<Track>.patch() = map { if (it.id == t.id) it.copy(liked = liked) else it }
        tracks = tracks.patch()
        playlistTracks = playlistTracks.mapValues { it.value.patch() }
        message = if (liked) "Added to Liked Songs." else "Removed from Liked Songs."
        viewModelScope.launch {
            try {
                api.setLiked(t.id, liked)
            } catch (e: Exception) {
                message = e.message
                refreshLibrary()
            }
        }
    }

    fun track(id: Long): Track? = tracks.firstOrNull { it.id == id }

    fun delete(t: Track) {
        viewModelScope.launch {
            try {
                api.deleteTrack(t.id)
                tracks = tracks.filter { it.id != t.id }
                playlistTracks = playlistTracks.mapValues { e -> e.value.filter { it.id != t.id } }
                message = "Deleted “${t.title}”."
                refreshLibrary()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't delete"
            }
        }
    }

    fun loadPlaylist(id: Long) {
        viewModelScope.launch {
            try {
                playlistTracks = playlistTracks + (id to api.playlistTracks(id))
            } catch (e: ApiException) {
                if (e.code == 404) {
                    // Deleted elsewhere: leave its page.
                    stacks.values.forEach { s -> s.removeAll { it == Route.PlaylistPage(id) } }
                } else message = e.message
            } catch (e: Exception) {
                message = e.message ?: "Couldn't open the playlist"
            }
        }
    }

    fun createPlaylist(name: String, trackIds: List<Long>) {
        viewModelScope.launch {
            try {
                val p = api.createPlaylist(name.trim().ifEmpty { "My playlist #${playlists.size + 1}" }, trackIds)
                playlists = listOf(p) + playlists
                sheet = null
                navigate(Route.PlaylistPage(p.id))
                refreshLibrary()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't create the playlist"
            }
        }
    }

    fun addToPlaylist(p: Playlist, items: List<Track>) {
        sheet = null
        viewModelScope.launch {
            try {
                api.addToPlaylist(p.id, items.map { it.id })
                message = "Added to ${p.name}."
                loadPlaylist(p.id)
                refreshLibrary()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't add to the playlist"
            }
        }
    }

    fun removeFromPlaylist(playlistId: Long, t: Track) {
        playlistTracks = playlistTracks + (playlistId to (playlistTracks[playlistId].orEmpty().filter { it.id != t.id }))
        viewModelScope.launch {
            try {
                api.removeFromPlaylist(playlistId, t.id)
                message = "Removed from playlist."
                refreshLibrary()
            } catch (e: Exception) {
                message = e.message
                loadPlaylist(playlistId)
            }
        }
    }

    fun renamePlaylist(p: Playlist, name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            try {
                val updated = api.renamePlaylist(p.id, name.trim())
                playlists = playlists.map { if (it.id == p.id) updated else it }
                sheet = null
            } catch (e: Exception) {
                message = e.message ?: "Couldn't rename"
            }
        }
    }

    fun deletePlaylist(p: Playlist) {
        sheet = null
        viewModelScope.launch {
            try {
                api.deletePlaylist(p.id)
                stacks.values.forEach { s -> s.removeAll { it == Route.PlaylistPage(p.id) } }
                playlists = playlists.filter { it.id != p.id }
                message = "Deleted “${p.name}”."
            } catch (e: Exception) {
                message = e.message ?: "Couldn't delete"
            }
        }
    }

    fun syncPlaylist(p: Playlist) {
        sheet = null
        viewModelScope.launch {
            try {
                message = api.syncPlaylist(p.id)
                refreshJobs()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't check for new songs"
            }
        }
    }

    fun cancelJob(j: Job) = viewModelScope.launch { runCatching { api.cancelJob(j.id) }; refreshJobs() }
    fun retryJob(j: Job) = viewModelScope.launch { runCatching { api.retryJob(j.id) }; refreshJobs() }
    fun retryFailed() = viewModelScope.launch { runCatching { api.retryFailed() }; refreshJobs() }
    fun cancelAll() = viewModelScope.launch { runCatching { api.cancelAll() }; refreshJobs() }
    fun clearFinished() = viewModelScope.launch { runCatching { api.clearFinished() }; refreshJobs() }

    /** Frees the on-device audio and cover caches. */
    fun clearCaches() {
        val cache = tuno.audioCache
        for (key in cache.keys.toList()) runCatching { cache.removeResource(key) }
        api.client.cache?.evictAll()
        Coil.imageLoader(tuno).apply {
            memoryCache?.clear()
            diskCache?.clear()
        }
        message = "Cache cleared."
    }

    fun cacheBytes(): Long = tuno.audioCache.cacheSpace

    override fun onCleared() {
        player.release()
    }
}
