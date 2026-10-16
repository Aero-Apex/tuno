package app.tuno

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

fun formatTime(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

fun formatSeconds(sec: Double?): String = if (sec == null) "" else formatTime((sec * 1000).toLong())

/** Spotify's playlist length: "48 min 12 sec" or "1 hr 5 min". */
fun formatTotal(sec: Double): String {
    val s = sec.toLong()
    val h = s / 3600
    val m = (s % 3600) / 60
    return when {
        h > 0 -> "$h hr $m min"
        m > 0 -> "$m min ${s % 60} sec"
        else -> "${s % 60} sec"
    }
}

fun formatBytes(b: Long): String = when {
    b >= 1024L * 1024 * 1024 -> "%.1f GB".format(b / 1024.0 / 1024 / 1024)
    b >= 1024L * 1024 -> "%.0f MB".format(b / 1024.0 / 1024)
    else -> "%d KB".format(b / 1024)
}

fun songs(n: Int) = if (n == 1) "1 song" else "$n songs"

/** Cover art filling [modifier], or Spotify's grey placeholder with a note while there is none. */
@Composable
fun Art(url: String?, modifier: Modifier, shape: Shape = RoundedCornerShape(4.dp), placeholder: ImageVector = TIcons.Note) {
    Box(modifier.clip(shape).background(S.Elevated), contentAlignment = Alignment.Center) {
        if (url == null) {
            Icon(placeholder, null, tint = S.Muted, modifier = Modifier.fillMaxSize(0.42f))
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
fun Cover(url: String?, size: Dp, modifier: Modifier = Modifier, radius: Dp = 4.dp, circle: Boolean = false) =
    Art(url, modifier.size(size), if (circle) CircleShape else RoundedCornerShape(radius), if (circle) TIcons.Person else TIcons.Note)

/** A playlist's picture: its own cover, a 2×2 mosaic of its songs (like Spotify), or the first song's cover. */
@Composable
fun PlaylistArt(p: Playlist, api: Api, modifier: Modifier, radius: Dp = 4.dp) {
    val shape = RoundedCornerShape(radius)
    when {
        p.cover != null -> Art(api.imageUrl(p.cover), modifier, shape)
        p.covers.size >= 4 -> Column(modifier.clip(shape)) {
            for (r in 0..1) Row(Modifier.weight(1f)) {
                for (c in 0..1) Art(api.imageUrl(p.covers[r * 2 + c]), Modifier.weight(1f).fillMaxSize(), RoundedCornerShape(0.dp))
            }
        }
        else -> Art(api.imageUrl(p.covers.firstOrNull()), modifier, shape)
    }
}

/** The purple-to-mint "Liked Songs" tile with a white heart. */
@Composable
fun LikedArt(modifier: Modifier, radius: Dp = 4.dp) {
    Box(
        modifier.clip(RoundedCornerShape(radius)).background(Brush.linearGradient(listOf(Color(0xFF450AF5), Color(0xFF8E8EE5), Color(0xFFC4EFD9)))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(TIcons.Heart, null, tint = Color.White, modifier = Modifier.fillMaxSize(0.38f))
    }
}

private val AVATAR_COLORS = listOf(0xFFF573A0, 0xFFFF7A4D, 0xFFFFC864, 0xFF9CF0E1, 0xFFB49BC8, 0xFF7FB2FF).map { Color(it) }

@Composable
fun Avatar(name: String, size: Dp = 32.dp, onClick: (() -> Unit)? = null) {
    val bg = AVATAR_COLORS[(name.hashCode() and 0x7fffffff) % AVATAR_COLORS.size]
    Box(
        Modifier.size(size).clip(CircleShape).background(bg).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(name.take(1).uppercase(), color = Color.Black, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.45f).sp)
    }
}

/** Spotify filter chip: grey pill, accent-colored when selected. */
@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    val accent = LocalAccent.current
    Box(
        Modifier.height(32.dp).clip(CircleShape).background(if (selected) accent.color else S.Tile)
            .clickable(role = Role.Tab, onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 13.sp, color = if (selected) accent.on else S.Text, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

/** The round "clear filter" chip Spotify shows before the selected chip. */
@Composable
fun ClearChip(onClick: () -> Unit) {
    Box(Modifier.size(32.dp).clip(CircleShape).background(S.Tile).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(TIcons.Close, "Clear filter", tint = S.Text, modifier = Modifier.size(14.dp))
    }
}

/** The big round play/pause button. */
@Composable
fun PlayButton(playing: Boolean, size: Dp = 56.dp, enabled: Boolean = true, onClick: () -> Unit) {
    val accent = LocalAccent.current
    Box(
        Modifier.size(size).clip(CircleShape).background(if (enabled) accent.color else S.Pressed).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(if (playing) TIcons.Pause else TIcons.Play, if (playing) "Pause" else "Play", tint = accent.on, modifier = Modifier.size(size * 0.42f))
    }
}

/** Spotify's save button: an outlined plus, or a filled check once the song is in Liked Songs. */
@Composable
fun LikeIcon(liked: Boolean, size: Dp = 24.dp, tint: Color = S.Subdued, modifier: Modifier = Modifier) {
    val accent = LocalAccent.current
    Canvas(modifier.size(size)) {
        val r = this.size.minDimension / 2 * 0.86f
        val c = center
        val w = this.size.minDimension * 0.07f
        if (liked) {
            drawCircle(accent.color, r, c)
            val s = this.size.minDimension
            val path = androidx.compose.ui.graphics.Path().apply {
                moveTo(c.x - s * 0.19f, c.y + s * 0.01f)
                lineTo(c.x - s * 0.05f, c.y + s * 0.15f)
                lineTo(c.x + s * 0.2f, c.y - s * 0.12f)
            }
            drawPath(path, accent.on, style = Stroke(width = w * 1.4f, cap = StrokeCap.Round))
        } else {
            drawCircle(tint, r, c, style = Stroke(w))
            val l = r * 0.5f
            drawLine(tint, Offset(c.x - l, c.y), Offset(c.x + l, c.y), w, StrokeCap.Round)
            drawLine(tint, Offset(c.x, c.y - l), Offset(c.x, c.y + l), w, StrokeCap.Round)
        }
    }
}

/** Three bouncing bars that mark the song that is playing (still while paused). */
@Composable
fun Equalizer(playing: Boolean, modifier: Modifier = Modifier.size(14.dp), color: Color = LocalAccent.current.color) {
    val phases = if (playing) {
        val t = rememberInfiniteTransition(label = "eq")
        listOf(420, 300, 520).map { ms ->
            t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(ms), RepeatMode.Reverse), label = "bar").value
        }
    } else listOf(0.45f, 0.8f, 0.3f)
    Canvas(modifier) {
        val bw = size.width / 5
        phases.forEachIndexed { i, f ->
            val h = size.height * f
            drawRoundRect(color, Offset(i * bw * 2, size.height - h), Size(bw, h), CornerRadius(bw / 3))
        }
    }
}

/** A song in a list: cover, title (accent-colored while it plays), artist and a "more" button. */
@Composable
fun TrackRow(
    track: Track,
    api: Api,
    current: Boolean,
    playing: Boolean,
    onClick: () -> Unit,
    onMore: () -> Unit,
    showCover: Boolean = true,
    subtitle: String = track.artist,
) {
    val accent = LocalAccent.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showCover) {
            Cover(api.imageUrl(track.cover), 48.dp)
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (current) {
                    Equalizer(playing, Modifier.size(12.dp))
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    track.title,
                    style = T.RowTitle,
                    color = if (current) accent.color else S.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(subtitle, style = T.RowSub, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
        IconBtn(TIcons.MoreVert, "More options for ${track.title}", onMore, tint = S.Subdued, iconSize = 20.dp)
    }
}

/** A row in Your Library / search results: picture, title, subtitle. */
@Composable
fun MediaRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    pinned: Boolean = false,
    titleColor: Color = S.Text,
    trailing: @Composable RowScope.() -> Unit = {},
    image: @Composable () -> Unit,
) {
    val accent = LocalAccent.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        image()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = T.RowTitle, color = titleColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                if (pinned) {
                    Icon(TIcons.Pin, "Pinned", tint = accent.color, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(6.dp))
                }
                Text(subtitle, style = T.RowSub, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        trailing()
    }
}

@Composable
fun IconBtn(
    icon: ImageVector,
    description: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = S.Text,
    iconSize: Dp = 24.dp,
    size: Dp = 48.dp,
    enabled: Boolean = true,
) {
    Box(
        modifier.size(size).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = if (enabled) tint else S.Muted, modifier = Modifier.size(iconSize))
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = T.Section, color = S.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 28.dp, bottom = 12.dp))
}

/** Header used by the tab roots: avatar, big title and actions on the right. */
@Composable
fun TabHeader(vm: TunoViewModel, title: String, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 16.dp, end = 4.dp, top = 8.dp).height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(vm.user?.name ?: "?", 34.dp) { vm.drawerOpen = true }
        Spacer(Modifier.width(12.dp))
        Text(title, style = T.PageTitle, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
    }
}

/** Simple top bar for pushed pages (Downloads, Settings). */
@Composable
fun PageBar(title: String, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBtn(TIcons.Back, "Back", onBack)
        Text(title, style = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold), modifier = Modifier.weight(1f).padding(start = 4.dp))
        actions()
    }
}

/** White (or outlined) pill button, as on Spotify's dialogs and empty states. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
    color: Color = Color.White,
    textColor: Color = Color.Black,
    enabled: Boolean = true,
    content: (@Composable BoxScope.() -> Unit)? = null,
) {
    Box(
        modifier.height(48.dp).clip(CircleShape)
            .then(if (filled) Modifier.background(if (enabled) color else S.Pressed) else Modifier.background(Color.Transparent))
            .then(if (!filled) Modifier.border(1.dp, S.Muted, CircleShape) else Modifier)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 28.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content()
        else Text(text, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (filled) (if (enabled) textColor else S.Muted) else S.Text)
    }
}

/** Square card used in the Home carousels (cover + two lines of text). */
@Composable
fun CarouselCard(title: String, subtitle: String, width: Dp, onClick: () -> Unit, circle: Boolean = false, image: @Composable (Modifier) -> Unit) {
    Column(
        Modifier.width(width).clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick),
        horizontalAlignment = if (circle) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        image(Modifier.fillMaxWidth().aspectRatio(1f))
        Text(
            title,
            style = TextStyle(fontSize = 13.sp, fontWeight = if (circle) FontWeight.SemiBold else FontWeight.Normal, color = S.Text),
            maxLines = if (circle) 1 else 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        if (subtitle.isNotEmpty()) Text(subtitle, style = T.Small, maxLines = if (circle) 1 else 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Space for the floating mini player and the navigation bar at the end of every scrolling page. */
@Composable
fun BottomSpace(vm: TunoViewModel) = Spacer(Modifier.height(vm.bottomInset()))

@Composable
fun EmptyState(title: String, body: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold), color = S.Text, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Text(body, style = T.RowSub.copy(fontSize = 14.sp), textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        if (action != null) {
            Spacer(Modifier.height(24.dp))
            action()
        }
    }
}

/** Arrangement shortcut for evenly spaced rows. */
val Gap8 = Arrangement.spacedBy(8.dp)
