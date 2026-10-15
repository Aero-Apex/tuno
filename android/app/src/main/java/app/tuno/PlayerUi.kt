package app.tuno

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.Player
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

/** Keeps the progress bar moving, but only while the app is on screen (nothing runs in the background). */
@Composable
private fun TickWhileVisible(player: PlayerState) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(player.playing) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            player.refreshPosition()
            while (player.playing) {
                delay(1000)
                player.refreshPosition()
            }
        }
    }
}

@Composable
fun MiniPlayer(vm: TunoViewModel, onOpen: () -> Unit) {
    val p = vm.player
    if (!p.hasItem) return
    TickWhileVisible(p)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable(onClick = onOpen),
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Cover(p.artwork, 42.dp, radius = 4.dp)
            Column(Modifier.weight(1f)) {
                Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
            if (p.buffering) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            IconButton(onClick = { p.toggle() }) { Icon(if (p.playing) TIcons.Pause else Icons.Default.PlayArrow, if (p.playing) "Pause" else "Play") }
            IconButton(onClick = { p.next() }) { Icon(TIcons.SkipNext, "Next") }
        }
        LinearProgressIndicator(
            progress = { if (p.duration > 0) (p.position.toFloat() / p.duration).coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp),
            gapSize = 0.dp,
            drawStopIndicator = {},
        )
    }
}

@Composable
fun FullPlayer(vm: TunoViewModel, onClose: () -> Unit) {
    val p = vm.player
    BackHandler(onBack = onClose)
    TickWhileVisible(p)
    var dragging by remember { mutableStateOf<Float?>(null) }
    val liked = vm.tracks.firstOrNull { it.id == p.trackId }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.KeyboardArrowDown, "Close player", modifier = Modifier.size(32.dp)) }
            Text("Now playing", Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.size(48.dp))
        }
        Spacer(Modifier.height(16.dp))
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            if (p.artwork != null) AsyncImage(p.artwork, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Icon(TIcons.MusicNote, null, modifier = Modifier.size(96.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(24.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(p.title, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
            }
            if (liked != null) {
                IconButton(onClick = { vm.toggleLike(liked) }) {
                    Icon(
                        if (liked.liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        "Like",
                        tint = if (liked.liked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        val fraction = dragging ?: if (p.duration > 0) (p.position.toFloat() / p.duration).coerceIn(0f, 1f) else 0f
        Slider(
            value = fraction,
            onValueChange = { dragging = it },
            onValueChangeFinished = {
                dragging?.let { p.seekTo((it * p.duration).toLong()) }
                dragging = null
            },
            enabled = p.duration > 0,
        )
        Row(Modifier.fillMaxWidth()) {
            Text(formatTime(if (dragging != null) (fraction * p.duration).toLong() else p.position), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            Text(formatTime(p.duration), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { p.toggleShuffle() }) {
                Icon(TIcons.Shuffle, "Shuffle", tint = if (p.shuffle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            }
            IconButton(onClick = { p.previous() }, modifier = Modifier.size(56.dp)) { Icon(TIcons.SkipPrevious, "Previous", modifier = Modifier.size(36.dp)) }
            Box(
                Modifier.size(68.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable { p.toggle() },
                contentAlignment = Alignment.Center,
            ) {
                if (p.buffering) CircularProgressIndicator(Modifier.size(32.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 3.dp)
                else Icon(
                    if (p.playing) TIcons.Pause else Icons.Default.PlayArrow,
                    if (p.playing) "Pause" else "Play",
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(40.dp),
                )
            }
            IconButton(onClick = { p.next() }, modifier = Modifier.size(56.dp)) { Icon(TIcons.SkipNext, "Next", modifier = Modifier.size(36.dp)) }
            IconButton(onClick = { p.cycleRepeat() }) {
                Icon(
                    if (p.repeat == Player.REPEAT_MODE_ONE) TIcons.RepeatOne else TIcons.Repeat,
                    "Repeat",
                    tint = if (p.repeat != Player.REPEAT_MODE_OFF) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}
