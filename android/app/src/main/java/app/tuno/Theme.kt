package app.tuno

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Spotify's dark palette (the app always uses it; only the accent follows the web app's Appearance settings). */
object S {
    val Bg = Color(0xFF121212)
    val Black = Color(0xFF000000)
    val Sheet = Color(0xFF242424)
    val Elevated = Color(0xFF282828)
    val Tile = Color(0xFF2A2A2A)
    val Pressed = Color(0xFF3E3E3E)
    val Text = Color.White
    val Subdued = Color(0xFFB3B3B3)
    val Muted = Color(0xFF7C7C7C)
    val Green = Color(0xFF1ED760)
    val Error = Color(0xFFF15E6C)
}

/** Spotify-like type scale on the system sans-serif. */
object T {
    val PageTitle = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp)
    val Section = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp)
    val Big = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp, lineHeight = 30.sp)
    val RowTitle = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Normal)
    val RowSub = TextStyle(fontSize = 13.sp, color = S.Subdued)
    val Label = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Bold)
    val Small = TextStyle(fontSize = 12.sp, color = S.Subdued)
    val Tiny = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Medium)
}

data class Accent(val color: Color, val on: Color)

val LocalAccent = staticCompositionLocalOf { Accent(S.Green, Color.Black) }

private fun hex(s: String?, fallback: Color): Color =
    runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(fallback)

@Composable
fun TunoTheme(colors: Colors?, content: @Composable () -> Unit) {
    val accent = hex(colors?.accent, S.Green)
    val onAccent = if (accent.luminance() > 0.4f) Color.Black else Color.White
    val scheme = darkColorScheme(
        primary = accent,
        onPrimary = onAccent,
        background = S.Bg,
        onBackground = S.Text,
        surface = S.Bg,
        onSurface = S.Text,
        onSurfaceVariant = S.Subdued,
        surfaceContainerLowest = S.Black,
        surfaceContainerLow = S.Sheet,
        surfaceContainer = S.Sheet,
        surfaceContainerHigh = S.Elevated,
        surfaceContainerHighest = S.Tile,
        surfaceVariant = S.Tile,
        outline = S.Muted,
        outlineVariant = S.Pressed,
        secondaryContainer = S.Tile,
        onSecondaryContainer = S.Text,
        error = S.Error,
    )
    val type = Typography().run {
        copy(
            bodyLarge = bodyLarge.copy(letterSpacing = 0.sp),
            bodyMedium = bodyMedium.copy(letterSpacing = 0.sp),
            labelLarge = labelLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.sp),
        )
    }
    MaterialTheme(colorScheme = scheme, typography = type) {
        // White is the default for any text or icon that doesn't pick a color (Compose's own default is black).
        CompositionLocalProvider(LocalAccent provides Accent(accent, onAccent), LocalContentColor provides S.Text, content = content)
    }
}
