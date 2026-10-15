package app.tuno

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

private fun hex(s: String?, fallback: Color): Color =
    runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(fallback)

/** Dark theme using the colors from the web app's Appearance settings (Spotify-green defaults until they load). */
@Composable
fun TunoTheme(colors: Colors?, content: @Composable () -> Unit) {
    val accent = hex(colors?.accent, Color(0xFF1ED760))
    val bg = hex(colors?.bg, Color(0xFF121212))
    val surface = hex(colors?.surface, Color(0xFF000000))
    val elevated = hex(colors?.elevated, Color(0xFF1F1F1F))
    val text = hex(colors?.text, Color.White)
    val muted = hex(colors?.muted, Color(0xFFA7A7A7))
    val onAccent = if (accent.luminance() > 0.5f) Color.Black else Color.White
    val scheme = darkColorScheme(
        primary = accent,
        onPrimary = onAccent,
        background = bg,
        onBackground = text,
        surface = bg,
        onSurface = text,
        onSurfaceVariant = muted,
        surfaceContainer = surface,
        surfaceContainerHigh = elevated,
        surfaceContainerHighest = elevated,
        surfaceVariant = elevated,
        outline = muted,
        secondaryContainer = elevated,
        onSecondaryContainer = text,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}
