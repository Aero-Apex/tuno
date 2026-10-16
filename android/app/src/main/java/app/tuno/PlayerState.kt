package app.tuno

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Where the queue came from, for "PLAYING FROM PLAYLIST · Name" and for the play buttons on that page. */
data class PlayContext(val id: String, val kind: String, val name: String)

data class QueueEntry(val index: Int, val title: String, val artist: String, val artwork: String?)

/** What the screens need to know about playback, kept in sync with the background service through a MediaController. */
class PlayerState(ctx: Context, private val api: Api) {
    private var controller: MediaController? = null

    /** Called with a short message when a song can't be played. */
    var onError: (String) -> Unit = {}

    /** Called when a library song starts, so "Recently played" updates without asking the server. */
    var onPlayed: (Long) -> Unit = {}

    var title by mutableStateOf("")
        private set
    var artist by mutableStateOf("")
        private set
    var artwork by mutableStateOf<String?>(null)
        private set
    var trackId by mutableLongStateOf(0L)
        private set
    /** Original link of a search result being previewed (so it can be downloaded from the player). */
    var sourceUrl by mutableStateOf<String?>(null)
        private set
    var hasItem by mutableStateOf(false)
        private set
    var playing by mutableStateOf(false)
        private set
    var buffering by mutableStateOf(false)
        private set
    var shuffle by mutableStateOf(false)
        private set
    var repeat by mutableIntStateOf(Player.REPEAT_MODE_OFF)
        private set
    var duration by mutableLongStateOf(0L)
        private set
    var position by mutableLongStateOf(0L)
        private set
    var context by mutableStateOf<PlayContext?>(null)
        private set
    /** Bumped whenever the queue changes, so the queue sheet re-reads it. */
    var queueVersion by mutableIntStateOf(0)
        private set

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            sync(player)
            if (events.contains(Player.EVENT_TIMELINE_CHANGED) || events.contains(Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED)) queueVersion++
        }

        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            // Counts as a play (for "Recently played" / "On repeat") once a library song starts.
            val id = item?.mediaMetadata?.extras?.getLong("trackId") ?: 0L
            if (id > 0) {
                onPlayed(id)
                CoroutineScope(Dispatchers.IO).launch { api.markPlayed(id) }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val c = controller ?: return
            onError(if (title.isNotEmpty()) "Couldn't play “$title”" else "Couldn't play this song")
            // Like Spotify: skip a song that can't be played instead of stopping the whole queue.
            if (c.hasNextMediaItem()) {
                c.seekToNextMediaItem()
                c.prepare()
                c.play()
            }
        }
    }

    init {
        val token = SessionToken(ctx, ComponentName(ctx, PlaybackService::class.java))
        val future = MediaController.Builder(ctx, token).buildAsync()
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            sync(c)
        }, ContextCompat.getMainExecutor(ctx))
    }

    private fun sync(p: Player) {
        val meta = p.mediaMetadata
        hasItem = p.mediaItemCount > 0
        title = meta.title?.toString().orEmpty()
        artist = meta.artist?.toString().orEmpty()
        artwork = meta.artworkUri?.toString()
        trackId = meta.extras?.getLong("trackId") ?: 0L
        sourceUrl = meta.extras?.getString("sourceUrl")
        playing = p.isPlaying
        buffering = p.playbackState == Player.STATE_BUFFERING
        shuffle = p.shuffleModeEnabled
        repeat = p.repeatMode
        duration = p.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
        position = p.currentPosition.coerceAtLeast(0L)
    }

    /** Called about once a second while the screen is on (never in the background). */
    fun refreshPosition() {
        controller?.let {
            position = it.currentPosition.coerceAtLeast(0L)
            duration = it.duration.takeIf { d -> d != C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
        }
    }

    private fun item(t: Track): MediaItem = MediaItem.Builder()
        .setMediaId("t${t.id}")
        .setUri(api.streamUrl(t.id))
        .setCustomCacheKey("track-${t.id}")
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(t.title)
                .setArtist(t.artist)
                .setAlbumTitle(t.album)
                .setArtworkUri(api.imageUrl(t.cover)?.let(Uri::parse))
                .setExtras(Bundle().apply { putLong("trackId", t.id) })
                .build(),
        )
        .build()

    fun isContext(id: String) = context?.id == id

    /** Plays [tracks] as the queue, starting at [start]. */
    fun play(tracks: List<Track>, start: Int, ctx: PlayContext? = null, shuffled: Boolean = false) {
        val c = controller ?: return
        if (tracks.isEmpty()) return
        context = ctx
        c.shuffleModeEnabled = shuffled
        c.setMediaItems(tracks.map(::item), if (shuffled) tracks.indices.random() else start.coerceIn(0, tracks.lastIndex), 0)
        c.prepare()
        c.play()
    }

    /** The play button on a playlist page: pause/resume if this playlist is playing, otherwise start it. */
    fun playContext(tracks: List<Track>, ctx: PlayContext, shuffled: Boolean = shuffle) {
        if (isContext(ctx.id) && hasItem) toggle() else play(tracks, 0, ctx, shuffled)
    }

    /** Plays a search result straight from the server before it is downloaded. */
    fun playPreview(r: SearchResult) {
        val c = controller ?: return
        context = PlayContext("search", "search", "Search")
        val i = MediaItem.Builder()
            .setMediaId("p:${r.key}")
            .setUri(api.previewUrl(r.url))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(r.title)
                    .setArtist(r.artist)
                    .setArtworkUri(api.imageUrl(r.thumbnail)?.let(Uri::parse))
                    .setExtras(Bundle().apply { putString("sourceUrl", r.url) })
                    .build(),
            )
            .build()
        c.setMediaItem(i)
        c.prepare()
        c.play()
    }

    /** "Add to queue": plays right after the current song. */
    fun addToQueue(t: Track) {
        val c = controller ?: return
        if (c.mediaItemCount == 0) {
            play(listOf(t), 0)
            return
        }
        c.addMediaItem(c.currentMediaItemIndex + 1, item(t))
    }

    /** The current song followed by what plays next, in playback order (shuffle-aware), up to [limit] songs. */
    fun upcoming(limit: Int = 60): List<QueueEntry> {
        val c = controller ?: return emptyList()
        val timeline = c.currentTimeline
        if (timeline.isEmpty) return emptyList()
        val out = ArrayList<QueueEntry>()
        var i = c.currentMediaItemIndex
        while (i != C.INDEX_UNSET && out.size < limit) {
            val m = c.getMediaItemAt(i).mediaMetadata
            out += QueueEntry(i, m.title?.toString().orEmpty(), m.artist?.toString().orEmpty(), m.artworkUri?.toString())
            i = timeline.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, c.shuffleModeEnabled)
        }
        return out
    }

    fun skipTo(index: Int) {
        controller?.run {
            seekTo(index, 0)
            play()
        }
    }

    fun toggle() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            if (c.playbackState == Player.STATE_ENDED) c.seekTo(c.currentMediaItemIndex, 0)
            c.play()
        }
    }

    fun next() { controller?.seekToNextMediaItem() }

    fun previous() {
        val c = controller ?: return
        // Like Spotify: the first press restarts the song, a second press goes to the previous one.
        if (c.currentPosition > 3000 || !c.hasPreviousMediaItem()) c.seekTo(0) else c.seekToPreviousMediaItem()
    }

    /** Swiping the mini player: always the previous song (no restart). */
    fun previousTrack() {
        controller?.let { if (it.hasPreviousMediaItem()) it.seekToPreviousMediaItem() else it.seekTo(0) }
    }

    fun seekTo(ms: Long) {
        controller?.seekTo(ms)
        position = ms
    }

    fun toggleShuffle() { controller?.let { it.shuffleModeEnabled = !it.shuffleModeEnabled } }

    fun cycleRepeat() {
        controller?.let {
            it.repeatMode = when (it.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
        }
    }

    /** Stops playback and clears the queue (used when logging out). */
    fun stop() {
        controller?.run {
            stop()
            clearMediaItems()
        }
        context = null
    }

    fun release() {
        controller?.run {
            removeListener(listener)
            release()
        }
        controller = null
    }
}
