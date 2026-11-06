package app.tuno

import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Plays music in the background with a lock-screen / notification player. It only lives while something is playing. */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var autoplayJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        val app = application as TunoApp
        val upstream = OkHttpDataSource.Factory(app.api.client)
        val dataSource = CacheDataSource.Factory()
            .setCache(app.audioCache)
            .setUpstreamDataSourceFactory(upstream)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        // If a phone's preferred audio decoder fails to start, try the next one instead of giving up on the song.
        val renderers = DefaultRenderersFactory(this).setEnableDecoderFallback(true)
        val player = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            // Songs are small: a modest buffer keeps memory and mobile data use low.
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(20_000, 40_000, 2_500, 5_000)
                    .build(),
            )
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true, // pause for calls, duck for notifications
            )
            .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) continueAfterQueue(player)
            }

            override fun onPlayerError(error: PlaybackException) {
                // Songs that fail mid-queue are skipped by the app; when the last one fails, Autoplay takes over.
                if (!player.hasNextMediaItem()) continueAfterQueue(player)
            }
        })

        session = MediaSession.Builder(this, player)
            // Notification/lock-screen artwork comes from our server, so it needs the logged-in client too.
            .setBitmapLoader(DataSourceBitmapLoader(MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()), upstream))
            .build()
    }

    /**
     * Like Spotify's Autoplay: when the queue runs out (repeat off), keep going with library songs that aren't in the
     * queue yet, favoring the artists that were just playing. Library songs are files on the server, so they play
     * even when YouTube is blocking streams.
     */
    private fun continueAfterQueue(player: ExoPlayer) {
        val app = application as TunoApp
        if (!app.prefs.autoplay || player.repeatMode != Player.REPEAT_MODE_OFF || autoplayJob?.isActive == true) return
        val count = player.mediaItemCount
        // An emptied queue also "ends"; that's not the end of something the user was listening to.
        if (count == 0) return
        autoplayJob = scope.launch {
            val library = runCatching { withContext(Dispatchers.IO) { app.api.tracks() } }.getOrNull().orEmpty()
            // Nothing to add, or the user started something else meanwhile.
            if (library.isEmpty() || player.mediaItemCount != count) return@launch
            val queued = (0 until count).map { player.getMediaItemAt(it).mediaMetadata }
            val inQueue = queued.mapNotNull { m -> m.extras?.getLong("trackId")?.takeIf { it > 0 } }.toSet()
            val recentArtists = queued.takeLast(20).mapNotNull { it.artist?.toString()?.lowercase() }.toSet()
            val lastId = queued.lastOrNull()?.extras?.getLong("trackId")
            var pool = library.filter { it.id !in inQueue }
            // Everything was in the queue already: start over with the whole library, minus the song that just ended.
            if (pool.isEmpty()) pool = library.filter { it.id != lastId }
            if (pool.isEmpty()) pool = library
            val same = pool.filter { it.artist.lowercase() in recentArtists }.shuffled().take(10)
            val picked = same.map { it.id }.toSet()
            val rest = pool.filter { it.id !in picked }.shuffled().take(25 - same.size)
            val more = (same + rest).shuffled().map { trackItem(app.api, it, autoplay = true) }
            // With shuffle on, the player would mix new songs in among played ones, so start a fresh queue.
            // Otherwise keep only the last 100 played songs, so hours of Autoplay don't grow the queue forever.
            if (player.shuffleModeEnabled) player.removeMediaItems(0, count)
            else if (count > 400) player.removeMediaItems(0, count - 100)
            val start = player.mediaItemCount
            player.addMediaItems(more)
            player.seekTo(start, 0)
            player.prepare()
            player.play()
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiping the app away stops the service unless music is actually playing. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
