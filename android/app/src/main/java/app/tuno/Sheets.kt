package app.tuno

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Shows whichever sheet or dialog the view model asks for. */
@Composable
fun Sheets(vm: TunoViewModel) {
    val close = { vm.sheet = null }
    when (val s = vm.sheet) {
        null -> Unit
        is Sheet.TrackMenu -> TrackMenuSheet(vm, s.track, s.playlistId, close)
        is Sheet.AddTo -> AddToPlaylistSheet(vm, s.tracks, close)
        is Sheet.Link -> LinkSheet(vm, s.prefill, close)
        Sheet.Create -> CreateSheet(vm, close)
        Sheet.Queue -> QueueSheet(vm, close)
        is Sheet.PlaylistMenu -> PlaylistMenuSheet(vm, s.playlist, close)
        is Sheet.NewPlaylist -> NameDialog("Give your playlist a name", "My playlist #${vm.playlists.size + 1}", "Create", close) {
            vm.createPlaylist(it, s.trackIds)
        }
        is Sheet.Rename -> NameDialog("Edit playlist name", s.playlist.name, "Save", close) { vm.renamePlaylist(s.playlist, it) }
        is Sheet.ConfirmDeleteTrack -> ConfirmDialog(
            "Delete this song?",
            "“${s.track.title}” is removed from the server and from every playlist. This can't be undone.",
            "Delete",
            close,
        ) { close(); vm.delete(s.track) }
        is Sheet.ConfirmDeletePlaylist -> ConfirmDialog(
            "Delete playlist?",
            "This will delete “${s.playlist.name}”. The songs stay in your library.",
            "Delete",
            close,
        ) { vm.deletePlaylist(s.playlist) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpotifySheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = S.Sheet,
        contentColor = S.Text,
        shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp),
        dragHandle = { BottomSheetDefaults.DragHandle(color = S.Muted, width = 36.dp, height = 4.dp) },
    ) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) { content() }
    }
}

@Composable
private fun SheetItem(icon: ImageVector, text: String, tint: Color = S.Subdued, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(18.dp))
        Text(text, fontSize = 16.sp, color = S.Text)
    }
}

@Composable
private fun SheetHeader(title: String, subtitle: String, image: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        image()
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = T.RowSub, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    HorizontalDivider(Modifier.padding(top = 8.dp, bottom = 4.dp), color = Color.White.copy(alpha = 0.08f))
}

@Composable
private fun TrackMenuSheet(vm: TunoViewModel, given: Track, playlistId: Long?, close: () -> Unit) {
    val t = vm.track(given.id) ?: given
    val ctx = LocalContext.current
    SpotifySheet(close) {
        SheetHeader(t.title, t.artist) { Cover(vm.api.imageUrl(t.cover), 48.dp) }
        Row(
            Modifier.fillMaxWidth().clickable { vm.toggleLike(t); close() }.padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LikeIcon(t.liked, 24.dp)
            Spacer(Modifier.width(18.dp))
            Text(if (t.liked) "Remove from Liked Songs" else "Add to Liked Songs", fontSize = 16.sp)
        }
        SheetItem(TIcons.PlusCircle, "Add to playlist") { vm.sheet = Sheet.AddTo(listOf(t)) }
        if (playlistId != null) SheetItem(TIcons.Close, "Remove from this playlist") { close(); vm.removeFromPlaylist(playlistId, t) }
        SheetItem(TIcons.Queue, "Add to queue") {
            vm.player.addToQueue(t)
            vm.message = "Added to queue."
            close()
        }
        SheetItem(TIcons.Person, "Go to artist") { vm.navigate(Route.ArtistPage(t.mainArtist)) }
        t.album?.let { album -> SheetItem(TIcons.Album, "Go to album") { vm.navigate(Route.AlbumPage(album)) } }
        SheetItem(TIcons.Share, "Share") {
            close()
            val text = t.sourceUrl ?: "${t.title} – ${t.artist}"
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))
        }
        SheetItem(TIcons.Trash, "Delete from server") { vm.sheet = Sheet.ConfirmDeleteTrack(t) }
    }
}

@Composable
private fun PlaylistMenuSheet(vm: TunoViewModel, p: Playlist, close: () -> Unit) {
    SpotifySheet(close) {
        SheetHeader(p.name, "Playlist • ${songs(p.count)}") { PlaylistArt(p, vm.api, Modifier.size(48.dp)) }
        SheetItem(TIcons.Edit, "Edit name") { vm.sheet = Sheet.Rename(p) }
        if (p.sourceUrl != null) SheetItem(TIcons.Refresh, "Check for new songs") { vm.syncPlaylist(p) }
        SheetItem(TIcons.Queue, "Add to queue") {
            vm.playlistTracks[p.id].orEmpty().forEach(vm.player::addToQueue)
            vm.message = "Added to queue."
            close()
        }
        SheetItem(TIcons.Trash, "Delete playlist") { vm.sheet = Sheet.ConfirmDeletePlaylist(p) }
    }
}

@Composable
private fun AddToPlaylistSheet(vm: TunoViewModel, items: List<Track>, close: () -> Unit) {
    SpotifySheet(close) {
        Text("Add to playlist", fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp), textAlign = TextAlign.Center)
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            PillButton("New playlist", { vm.sheet = Sheet.NewPlaylist(items.map { it.id }) })
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(Modifier.heightIn(max = 420.dp)) {
            items(vm.playlists, key = { it.id }) { p ->
                MediaRow(p.name, songs(p.count), { vm.addToPlaylist(p, items) }) { PlaylistArt(p, vm.api, Modifier.size(52.dp)) }
            }
        }
    }
}

@Composable
private fun CreateSheet(vm: TunoViewModel, close: () -> Unit) {
    SpotifySheet(close) {
        CreateRow(TIcons.Note, "Playlist", "Build a playlist with songs from your library") { vm.sheet = Sheet.NewPlaylist() }
        CreateRow(TIcons.Link, "Download from link", "Save songs, albums or playlists from YouTube, Spotify, SoundCloud and more") { vm.sheet = Sheet.Link() }
        CreateRow(TIcons.Search, "Search and download", "Find any song and keep it in your library") { close(); vm.selectTab(Tab.Search) }
    }
}

@Composable
private fun CreateRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp).clip(CircleShape).background(S.Pressed), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = S.Text, modifier = Modifier.size(26.dp))
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text(subtitle, style = T.RowSub, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun LinkSheet(vm: TunoViewModel, prefill: String, close: () -> Unit) {
    var url by remember { mutableStateOf(prefill) }
    val clipboard = LocalClipboardManager.current
    val focus = remember { FocusRequester() }
    val valid = url.trim().let { it.startsWith("http") || it.startsWith("spotify:") || it.startsWith("www.") }
    LaunchedEffect(Unit) { if (prefill.isEmpty()) focus.requestFocus() }
    val go = {
        if (valid) {
            vm.download(url.trim())
            close()
        }
    }
    SpotifySheet(close) {
        Column(Modifier.imePadding().padding(horizontal = 20.dp)) {
            Text("Download from link", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("Paste a link to a song, album or playlist from YouTube, YouTube Music, Spotify, SoundCloud or Bandcamp.", style = T.RowSub, modifier = Modifier.padding(top = 6.dp))
            Row(
                Modifier.padding(top = 18.dp).fillMaxWidth().height(50.dp).clip(RoundedCornerShape(6.dp)).background(Color.White).padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(TIcons.Link, null, tint = Color(0xFF121212), modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = url,
                    onValueChange = { url = it },
                    singleLine = true,
                    textStyle = TextStyle(color = Color.Black, fontSize = 15.sp),
                    cursorBrush = SolidColor(Color.Black),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { go() }),
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (url.isEmpty()) Text("https://…", color = Color(0xFF6A6A6A), fontSize = 15.sp)
                            inner()
                        }
                    },
                )
                if (url.isNotEmpty()) IconBtn(TIcons.Close, "Clear", { url = "" }, tint = Color(0xFF535353), iconSize = 16.dp, size = 40.dp)
            }
            Row(Modifier.padding(top = 18.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Paste", { clipboard.getText()?.text?.trim()?.let { url = it } }, Modifier.weight(1f), filled = false)
                PillButton("Download", { go() }, Modifier.weight(1f), color = LocalAccent.current.color, textColor = LocalAccent.current.on, enabled = valid)
            }
        }
    }
}

@Composable
private fun QueueSheet(vm: TunoViewModel, close: () -> Unit) {
    val p = vm.player
    val queue = remember(p.queueVersion, p.trackId) { p.upcoming() }
    val accent = LocalAccent.current
    SpotifySheet(close) {
        Text("Queue", fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
        LazyColumn(Modifier.heightIn(max = 560.dp)) {
            queue.firstOrNull()?.let { now ->
                item { Text("Now playing", style = T.Label.copy(fontSize = 16.sp), modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 6.dp)) }
                item {
                    MediaRow(now.title, now.artist, {}, titleColor = accent.color, trailing = { Equalizer(p.playing, Modifier.padding(end = 8.dp).size(14.dp)) }) {
                        Cover(now.artwork, 48.dp)
                    }
                }
            }
            if (queue.size > 1) {
                item {
                    Text(
                        "Next from: ${p.context?.name ?: "your queue"}",
                        style = T.Label.copy(fontSize = 16.sp),
                        modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp),
                    )
                }
                items(queue.drop(1), key = { it.index }) { q -> MediaRow(q.title, q.artist, { p.skipTo(q.index) }) { Cover(q.artwork, 48.dp) } }
            } else {
                item { Text("Nothing else is queued.", style = T.RowSub, modifier = Modifier.padding(20.dp)) }
            }
        }
    }
}

/** Spotify's full-screen "name your playlist" page. */
@Composable
private fun NameDialog(title: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(
            Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF5A5A5A), S.Bg))).imePadding().padding(28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(36.dp))
            BasicTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                textStyle = TextStyle(color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                cursorBrush = SolidColor(LocalAccent.current.color),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onConfirm(value.text) }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
            HorizontalDivider(Modifier.padding(top = 6.dp), color = S.Subdued)
            Spacer(Modifier.height(40.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                PillButton("Cancel", onDismiss, filled = false)
                PillButton(confirm, { onConfirm(value.text) }, color = LocalAccent.current.color, textColor = LocalAccent.current.on, enabled = value.text.isNotBlank())
            }
        }
    }
}

@Composable
private fun ConfirmDialog(title: String, body: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = S.Elevated,
        shape = RoundedCornerShape(10.dp),
        title = { Text(title, fontWeight = FontWeight.Bold, fontSize = 20.sp) },
        text = { Text(body, color = S.Subdued) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm.uppercase(), color = S.Error, fontWeight = FontWeight.Bold, letterSpacing = 1.sp) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCEL", color = S.Text, fontWeight = FontWeight.Bold, letterSpacing = 1.sp) } },
    )
}
