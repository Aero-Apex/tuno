package app.tuno

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.Player
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Keeps the progress bar moving, but only while the app is on screen (nothing runs in the background). */
@Composable
private fun TickWhileVisible(player: PlayerState) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(player.playing) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            player.refreshPosition()
            while (player.playing) {
                delay(500)
                player.refreshPosition()
            }
        }
    }
}

private fun PlayerState.fraction() = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f

/** Spotify's floating mini player: tinted with the cover's color; swipe sideways to change song. */
@Composable
fun MiniPlayer(vm: TunoViewModel, onOpen: () -> Unit) {
    val p = vm.player
    if (!p.hasItem) return
    TickWhileVisible(p)
    val color = rememberArtColor(p.artwork, Color(0xFF3A3A3A)).darken(0.2f)
    val track = vm.track(p.trackId)
    var drag by remember { mutableFloatStateOf(0f) }
    val threshold = with(LocalDensity.current) { 72.dp.toPx() }

    Box(
        Modifier.padding(horizontal = 8.dp).fillMaxWidth().height(MINI_HEIGHT.dp).clip(RoundedCornerShape(6.dp)).background(color)
            .clickable(onClick = onOpen)
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (drag < -threshold) p.next() else if (drag > threshold) p.previousTrack()
                        drag = 0f
                    },
                    onDragCancel = { drag = 0f },
                ) { change, amount ->
                    change.consume()
                    drag += amount
                }
            },
    ) {
        Row(
            Modifier.fillMaxSize().padding(start = 8.dp, end = 2.dp).graphicsLayer {
                translationX = drag * 0.6f
                alpha = 1f - (kotlin.math.abs(drag) / (threshold * 3)).coerceIn(0f, 0.6f)
            },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Cover(p.artwork, 40.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(p.title, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(p.artist, fontSize = 12.sp, color = Color.White.copy(alpha = 0.72f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            SaveButton(vm, track, p.sourceUrl, 22.dp)
            Box(Modifier.size(44.dp).clip(CircleShape).clickable { p.toggle() }, contentAlignment = Alignment.Center) {
                if (p.buffering && !p.playing) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Icon(if (p.playing) TIcons.Pause else TIcons.Play, if (p.playing) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(24.dp))
            }
        }
        // Thin progress line along the bottom edge.
        Canvas(Modifier.align(Alignment.BottomCenter).padding(horizontal = 8.dp).fillMaxWidth().height(2.dp)) {
            drawRoundRect(Color.White.copy(alpha = 0.25f), cornerRadius = CornerRadius(size.height))
            drawRoundRect(Color.White, size = Size(size.width * p.fraction(), size.height), cornerRadius = CornerRadius(size.height))
        }
    }
}

/** Plus / check for library songs; a download button while previewing a search result. */
@Composable
private fun SaveButton(vm: TunoViewModel, track: Track?, sourceUrl: String?, size: androidx.compose.ui.unit.Dp) {
    when {
        track != null -> Box(Modifier.size(44.dp).clip(CircleShape).clickable { vm.toggleLike(track) }, contentAlignment = Alignment.Center) {
            LikeIcon(track.liked, size, tint = Color.White)
        }
        sourceUrl != null -> {
            val done = sourceUrl in vm.requested
            Box(Modifier.size(44.dp).clip(CircleShape).clickable(enabled = !done) { vm.download(sourceUrl) }, contentAlignment = Alignment.Center) {
                if (done) LikeIcon(true, size) else Icon(TIcons.DownloadCircle, "Download", tint = Color.White, modifier = Modifier.size(size + 2.dp))
            }
        }
    }
}

private fun contextLabel(ctx: PlayContext?): String = when (ctx?.kind) {
    "playlist" -> "PLAYING FROM PLAYLIST"
    "artist" -> "PLAYING FROM ARTIST"
    "album" -> "PLAYING FROM ALBUM"
    "search" -> "PLAYING FROM SEARCH"
    else -> "PLAYING FROM YOUR LIBRARY"
}

/** Full-screen Now Playing: cover-colored gradient, big artwork, seek bar and controls. Drag down to close. */
@Composable
fun NowPlaying(vm: TunoViewModel, onClose: () -> Unit) {
    val p = vm.player
    BackHandler(onBack = onClose)
    TickWhileVisible(p)
    val accent = LocalAccent.current
    val base = rememberArtColor(p.artwork, Color(0xFF404040))
    val track = vm.track(p.trackId)
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val closeAt = with(LocalDensity.current) { 140.dp.toPx() }
    var seeking by remember { mutableStateOf<Float?>(null) }
    val ctx = LocalContext.current

    Box(
        Modifier.fillMaxSize().offset { IntOffset(0, offset.value.roundToInt()) }
            .background(Brush.verticalGradient(0f to base, 0.55f to base.darken(0.55f), 1f to Color(0xFF121212)))
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragEnd = { if (offset.value > closeAt) onClose() else scope.launch { offset.animateTo(0f) } },
                    onDragCancel = { scope.launch { offset.animateTo(0f) } },
                ) { change, amount ->
                    change.consume()
                    scope.launch { offset.snapTo((offset.value + amount).coerceAtLeast(0f)) }
                }
            },
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp)) {
            Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(TIcons.ChevronDown, "Close", onClose, modifier = Modifier.offset(x = (-12).dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(contextLabel(p.context), fontSize = 10.sp, letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.8f), maxLines = 1)
                    Text(p.context?.name ?: "Tuno", fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                }
                IconBtn(TIcons.MoreVert, "More options", { track?.let { vm.sheet = Sheet.TrackMenu(it) } }, modifier = Modifier.offset(x = 12.dp), enabled = track != null)
            }

            Spacer(Modifier.weight(1f))
            Art(
                p.artwork,
                Modifier.fillMaxWidth().aspectRatio(1f).shadow(20.dp, RoundedCornerShape(8.dp)),
                RoundedCornerShape(8.dp),
            )
            Spacer(Modifier.weight(1f))

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(p.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.basicMarquee(initialDelayMillis = 2500))
                    Text(
                        p.artist,
                        fontSize = 16.sp,
                        color = Color.White.copy(alpha = 0.72f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable(enabled = track != null) {
                            track?.let { vm.navigate(Route.ArtistPage(it.mainArtist)) }
                        },
                    )
                }
                SaveButton(vm, track, p.sourceUrl, 28.dp)
            }

            Spacer(Modifier.height(16.dp))
            SeekBar(seeking ?: p.fraction(), onChange = { seeking = it }) { f ->
                p.seekTo((f * p.duration).toLong())
                seeking = null
            }
            Row(Modifier.fillMaxWidth()) {
                val shown = seeking?.let { (it * p.duration).toLong() } ?: p.position
                Text(formatTime(shown), fontSize = 11.sp, color = Color.White.copy(alpha = 0.7f))
                Spacer(Modifier.weight(1f))
                Text(if (p.duration > 0) formatTime(p.duration) else "-:--", fontSize = 11.sp, color = Color.White.copy(alpha = 0.7f))
            }

            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                ToggleIcon(TIcons.Shuffle, "Shuffle", p.shuffle, accent.color) { p.toggleShuffle() }
                IconBtn(TIcons.SkipPrevious, "Previous", { p.previous() }, iconSize = 34.dp, size = 56.dp)
                Box(
                    Modifier.size(66.dp).clip(CircleShape).background(Color.White).clickable { p.toggle() },
                    contentAlignment = Alignment.Center,
                ) {
                    if (p.buffering && !p.playing) CircularProgressIndicator(Modifier.size(28.dp), color = Color.Black, strokeWidth = 3.dp)
                    else Icon(if (p.playing) TIcons.Pause else TIcons.Play, if (p.playing) "Pause" else "Play", tint = Color.Black, modifier = Modifier.size(30.dp))
                }
                IconBtn(TIcons.SkipNext, "Next", { p.next() }, iconSize = 34.dp, size = 56.dp)
                Box(contentAlignment = Alignment.Center) {
                    ToggleIcon(TIcons.Repeat, "Repeat", p.repeat != Player.REPEAT_MODE_OFF, accent.color) { p.cycleRepeat() }
                    if (p.repeat == Player.REPEAT_MODE_ONE) {
                        Box(
                            Modifier.align(Alignment.TopEnd).offset(x = (-6).dp, y = 8.dp).size(13.dp).clip(CircleShape).background(accent.color),
                            contentAlignment = Alignment.Center,
                        ) { Text("1", fontSize = 8.sp, fontWeight = FontWeight.Black, color = accent.on, lineHeight = 8.sp) }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(TIcons.Share, "Share", {
                    val text = track?.sourceUrl ?: p.sourceUrl ?: "${p.title} – ${p.artist}"
                    ctx.startActivity(
                        android.content.Intent.createChooser(
                            android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, text),
                            null,
                        ),
                    )
                }, modifier = Modifier.offset(x = (-12).dp), iconSize = 20.dp)
                Spacer(Modifier.weight(1f))
                IconBtn(TIcons.Queue, "Queue", { vm.sheet = Sheet.Queue }, modifier = Modifier.offset(x = 12.dp), iconSize = 22.dp)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Shuffle / repeat: accent-colored with a dot underneath while on, like Spotify. */
@Composable
private fun ToggleIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, on: Boolean, accent: Color, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = if (on) accent else Color.White, modifier = Modifier.size(24.dp))
        if (on) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).size(4.dp).clip(CircleShape).background(accent))
    }
}

/** Spotify's thin seek bar with a round thumb: tap or drag to seek. */
@Composable
private fun SeekBar(fraction: Float, onChange: (Float) -> Unit, onDone: (Float) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    var last by remember { mutableFloatStateOf(0f) }
    Box(
        Modifier.fillMaxWidth().height(28.dp)
            .pointerInput(Unit) {
                detectTapGestures { pos -> onDone((pos.x / size.width).coerceIn(0f, 1f)) }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { pos ->
                        dragging = true
                        last = (pos.x / size.width).coerceIn(0f, 1f)
                        onChange(last)
                    },
                    onDragEnd = {
                        dragging = false
                        onDone(last)
                    },
                    onDragCancel = { dragging = false },
                ) { change, _ ->
                    change.consume()
                    last = (change.position.x / size.width).coerceIn(0f, 1f)
                    onChange(last)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxWidth().fillMaxHeight()) {
            val h = 4.dp.toPx()
            val y = size.height / 2
            drawRoundRect(Color.White.copy(alpha = 0.3f), Offset(0f, y - h / 2), Size(size.width, h), CornerRadius(h / 2))
            drawRoundRect(Color.White, Offset(0f, y - h / 2), Size(size.width * fraction, h), CornerRadius(h / 2))
            drawCircle(Color.White, (if (dragging) 8.dp else 6.dp).toPx(), Offset(size.width * fraction, y))
        }
    }
}
