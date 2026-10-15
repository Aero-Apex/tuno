package app.tuno

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

fun formatTime(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

fun formatSeconds(sec: Double?): String = if (sec == null) "" else formatTime((sec * 1000).toLong())

fun formatBytes(b: Long): String = when {
    b >= 1024L * 1024 * 1024 -> "%.1f GB".format(b / 1024.0 / 1024 / 1024)
    b >= 1024L * 1024 -> "%.0f MB".format(b / 1024.0 / 1024)
    else -> "%d KB".format(b / 1024)
}

/** Square cover art, or a music-note placeholder while there is none. */
@Composable
fun Cover(url: String?, size: Dp, modifier: Modifier = Modifier, radius: Dp = 6.dp) {
    val shape = RoundedCornerShape(radius)
    Box(
        modifier.size(size).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.Center,
    ) {
        if (url == null) {
            Icon(TIcons.MusicNote, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(size / 2))
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        }
    }
}

@Composable
fun TrackRow(
    track: Track,
    api: Api,
    current: Boolean,
    onClick: () -> Unit,
    onLike: () -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(api.imageUrl(track.cover), 48.dp)
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                track.artist,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text(formatSeconds(track.duration), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(if (track.liked) "Remove from Liked" else "Add to Liked") },
                    leadingIcon = { Icon(if (track.liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder, null) },
                    onClick = { menu = false; onLike() },
                )
                if (onDelete != null) {
                    DropdownMenuItem(
                        text = { Text("Delete from server") },
                        leadingIcon = { Icon(Icons.Default.Delete, null) },
                        onClick = { menu = false; confirm = true },
                    )
                }
            }
        }
    }
    if (confirm && onDelete != null) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Delete this song?") },
            text = { Text("“${track.title}” is removed from the server and every playlist. This cannot be undone.") },
            confirmButton = { TextButton(onClick = { confirm = false; onDelete() }) { Text("Delete", color = Color(0xFFFF6B6B)) } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}
