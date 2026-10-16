package app.tuno

import android.content.Context
import android.util.LruCache
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.graphics.drawable.toBitmap
import androidx.palette.graphics.Palette
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Colors already worked out, by image URL (a few bytes each; covers are decoded tiny and only once). */
private val artColors = LruCache<String, Int>(200)

/**
 * The Spotify-style tint for a cover: its main color, kept dark enough for white text on top.
 * Returns [fallback] until the cover has loaded, then animates to the cover's color.
 */
@Composable
fun rememberArtColor(url: String?, fallback: Color = Color(0xFF3A3A3A)): Color {
    val ctx = LocalContext.current
    var color by remember(url) { mutableStateOf(url?.let { artColors.get(it) }?.let { Color(it) }) }
    LaunchedEffect(url) {
        if (url == null || color != null) return@LaunchedEffect
        extractColor(ctx, url)?.let {
            artColors.put(url, it)
            color = Color(it)
        }
    }
    return animateColorAsState(color ?: fallback, tween(450), label = "art").value
}

private suspend fun extractColor(ctx: Context, url: String): Int? {
    val request = ImageRequest.Builder(ctx).data(url).size(96).allowHardware(false).build()
    val result = ctx.imageLoader.execute(request) as? SuccessResult ?: return null
    return withContext(Dispatchers.Default) {
        val bitmap = result.drawable.toBitmap()
        val palette = Palette.from(bitmap).maximumColorCount(16).generate()
        val dominant = palette.dominantSwatch ?: return@withContext null
        val hsv = FloatArray(3)
        android.graphics.Color.colorToHSV(dominant.rgb, hsv)
        // A near-black or grey dominant color looks dull: use a colorful swatch when the cover has a real one.
        val pick = if (hsv[2] < 0.15f || hsv[1] < 0.12f) {
            listOfNotNull(palette.darkVibrantSwatch, palette.vibrantSwatch, palette.mutedSwatch)
                .firstOrNull { it.population >= dominant.population / 12 } ?: dominant
        } else dominant
        shade(pick.rgb)
    }
}

/** Keeps the hue, caps saturation and brightness like Spotify's headers so white text stays readable. */
private fun shade(rgb: Int): Int {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(rgb, hsv)
    hsv[1] = hsv[1].coerceAtMost(0.78f)
    hsv[2] = hsv[2].coerceIn(0.24f, 0.52f)
    return android.graphics.Color.HSVToColor(hsv)
}

/** Darker version of a tint (mini player, bottom of gradients). */
fun Color.darken(f: Float): Color = Color(red * (1 - f), green * (1 - f), blue * (1 - f), alpha)
