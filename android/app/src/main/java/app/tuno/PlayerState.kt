package app.tuno

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** What the screens need to know about playback, kept in sync with the background service through a MediaController. */
class PlayerState(ctx: Context, private val api: Api) {
    private var controller: MediaController? = null

    var title by mutableStateOf("")
        private set
    var artist by mutableStateOf("")
        private set
    var artwork by mutableStateOf<String?>(null)
        private set
    var trackId by mutableLongStateOf(0L)
        private set
    var hasItem by mutableStateOf(false)
        private set
    var playing by mutableStateOf(false)
        private set
    var buffering by mutableStateOf(false)
        private set
    var shuffle by mutableStateOf(false)
        private set
    var repeat by mutableStateOf(Player.REPEAT_MODE_OFF)
        private set
    var duration by mutableLongStateOf(0L)
        private set
    var position by mutableLongStateOf(0L)
        private set

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = sync(player)

        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            // Counts as a play (for "Jump back in" / "On repeat") once a library song starts.
            val id = item?.mediaMetadata?.extras?.getLong("trackId") ?: 0L
            if (id > 0) CoroutineScope(Dispatchers.IO).launch { api.markPlayed(id) }
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
        playing = p.isPlaying
        buffering = p.playbackState == Player.STATE_BUFFERING
        shuffle = p.shuffleModeEnabled
        repeat = p.repeatMode
        duration = p.duration.coerceAtLeast(0L)
        position = p.currentPosition.coerceAtLeast(0L)
    }

    /** Called about once a second while the screen is on (never in the background). */
    fun refreshPosition() {
        controller?.let {
            position = it.currentPosition.coerceAtLeast(0L)
            duration = it.duration.coerceAtLeast(0L)
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

    /** Plays [tracks] as the queue, starting at [start]. */
    fun play(tracks: List<Track>, start: Int, shuffled: Boolean = false) {
        val c = controller ?: return
        if (tracks.isEmpty()) return
        c.setMediaItems(tracks.map(::item), start.coerceIn(0, tracks.lastIndex), 0)
        c.shuffleModeEnabled = shuffled
        c.prepare()
        c.play()
    }

    /** Plays a search result straight from the server before it is downloaded. */
    fun playPreview(r: SearchResult) {
        val c = controller ?: return
        val i = MediaItem.Builder()
            .setMediaId("p:${r.key}")
            .setUri(api.previewUrl(r.url))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(r.title)
                    .setArtist(r.artist)
                    .setArtworkUri(api.imageUrl(r.thumbnail)?.let(Uri::parse))
                    .build(),
            )
            .build()
        c.setMediaItem(i)
        c.prepare()
        c.play()
    }

    fun toggle() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else c.play()
    }

    fun next() { controller?.seekToNextMediaItem() }

    fun previous() {
        val c = controller ?: return
        // Like most players: the first press restarts the song, a second press goes to the previous one.
        if (c.currentPosition > 3000) c.seekTo(0) else c.seekToPreviousMediaItem()
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
    }

    fun release() {
        controller?.run {
            removeListener(listener)
            release()
        }
        controller = null
    }
}
