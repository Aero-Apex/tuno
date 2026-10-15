package app.tuno

import android.app.Application
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import java.io.File

class TunoApp : Application(), ImageLoaderFactory {
    val prefs by lazy { Prefs(this) }
    val api by lazy { Api(this, prefs) }

    /**
     * Songs you have played stay on the phone (up to 250 MB, oldest dropped first), so replaying them uses no mobile
     * data and puts no load on the server.
     */
    val audioCache: SimpleCache by lazy {
        SimpleCache(File(cacheDir, "audio"), LeastRecentlyUsedCacheEvictor(250L * 1024 * 1024), StandaloneDatabaseProvider(this))
    }

    /** Cover art loader: shares the logged-in client and keeps a small memory and disk cache. */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient(api.client)
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.15).build() }
        .diskCache { DiskCache.Builder().directory(File(cacheDir, "img")).maxSizeBytes(60L * 1024 * 1024).build() }
        .crossfade(false)
        .respectCacheHeaders(false)
        .build()
}
