package app.tuno

import android.app.Application
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.intercept.Interceptor
import coil.request.ImageResult
import coil.size.Dimension
import coil.disk.DiskCache
import coil.memory.MemoryCache
import java.io.File

class TunoApp : Application(), ImageLoaderFactory {
    val prefs by lazy { Prefs(this) }
    val api by lazy { Api(this, prefs) }
    val updates by lazy { UpdateManager(this, api, prefs) }

    /**
     * Songs you have played stay on the phone (up to 250 MB, oldest dropped first), so replaying them uses no mobile
     * data and puts no load on the server.
     */
    val audioCache: SimpleCache by lazy {
        SimpleCache(File(cacheDir, "audio"), LeastRecentlyUsedCacheEvictor(250L * 1024 * 1024), StandaloneDatabaseProvider(this))
    }

    /** Cover art loader: shares the logged-in client and keeps a small memory and disk cache. */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        // Same login and connections, but no OkHttp cache: Coil keeps its own disk cache, so pictures would be stored twice.
        .okHttpClient { api.client.newBuilder().cache(null).build() }
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.15).build() }
        .diskCache { DiskCache.Builder().directory(File(cacheDir, "img")).maxSizeBytes(60L * 1024 * 1024).build() }
        .crossfade(false)
        .respectCacheHeaders(false)
        .components { add(ThumbnailInterceptor()) }
        .build()
}

/**
 * A 48 dp row doesn't need a 2 MB cover. This asks the server for a copy at about the size the picture will be drawn
 * (128, 256 or 512 px wide), which is usually 5-20 KB instead of up to several MB. Bigger pictures (the player) and
 * servers that don't know the option get the original.
 */
private class ThumbnailInterceptor : Interceptor {
    private val widths = listOf(128, 256, 512)
    private val sized = Regex("[?&]w=[0-9]+")

    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        val request = chain.request
        val url = request.data as? String ?: return chain.proceed(request)
        val isServerImage = "/api/cover/" in url || "/api/files/covers/" in url || "/api/img?" in url
        val px = (chain.size.width as? Dimension.Pixels)?.px
        val width = if (isServerImage && px != null && !sized.containsMatchIn(url)) widths.firstOrNull { it >= px } else null
        if (width == null) return chain.proceed(request)
        return chain.proceed(request.newBuilder().data(url + (if ('?' in url) "&" else "?") + "w=$width").build())
    }
}
