package app.tuno

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val LIB_FILTERS = listOf("Playlists", "Songs", "Artists", "Albums")
private val SORTS = listOf("Recents", "Recently added", "Alphabetical")
// Songs never sort by "last played": the song you just tapped would jump away from under your finger.
private val SONG_SORTS = listOf("Recently added", "Title", "Artist")

/** One entry of Your Library (playlist, artist, album or Liked Songs) in a form both the list and grid can show. */
private class LibItem(
    val key: String,
    val title: String,
    val subtitle: String,
    val recent: Long,
    val added: Long,
    val route: Route,
    val contextId: String,
    val circle: Boolean = false,
    val pinned: Boolean = false,
    val image: @Composable (Modifier) -> Unit,
)

@Composable
fun LibraryScreen(vm: TunoViewModel) {
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    BackHandler(enabled = searching || filter != null) {
        if (searching) { searching = false; text = "" } else filter = null
    }
    val api = vm.api
    val owner = vm.user?.name ?: "You"

    val items = buildList {
        if (filter == null || filter == "Playlists") {
            add(LibItem("liked", "Liked Songs", "Playlist • ${songs(vm.liked.size)}", Long.MAX_VALUE, Long.MAX_VALUE, Route.Liked, "liked", pinned = true) {
                LikedArt(it)
            })
            vm.playlists.forEach { p ->
                add(LibItem("p${p.id}", p.name, if (p.pending > 0) "Downloading ${songs(p.pending)}…" else "Playlist • $owner", p.updatedAt, p.updatedAt, Route.PlaylistPage(p.id), "playlist:${p.id}") {
                    PlaylistArt(p, api, it)
                })
            }
        }
        if (filter == null || filter == "Artists") vm.artists.forEach { a ->
            add(LibItem("a${a.name}", a.name, "Artist", a.lastPlayed, a.added, Route.ArtistPage(a.name), "artist:${a.name}", circle = true) {
                Art(api.imageUrl(a.cover), it, CircleShape, TIcons.Person)
            })
        }
        if (filter == null || filter == "Albums") vm.albums.forEach { a ->
            add(LibItem("al${a.name}", a.name, "Album • ${a.artist}", a.added, a.added, Route.AlbumPage(a.name), "album:${a.name}") {
                Art(api.imageUrl(a.cover), it, RoundedCornerShape(4.dp), TIcons.Album)
            })
        }
    }.filter { text.isBlank() || it.title.contains(text, true) || it.subtitle.contains(text, true) }
        .let { list ->
            when (vm.librarySort) {
                1 -> list.sortedByDescending { it.added }
                2 -> list.sortedWith(compareByDescending<LibItem> { it.pinned }.thenBy { it.title.lowercase() })
                else -> list.sortedByDescending { it.recent }
            }
        }

    val songsFiltered = if (filter == "Songs") {
        vm.tracks.filter { text.isBlank() || "${it.title} ${it.artist} ${it.album.orEmpty()}".contains(text, true) }.let { list ->
            when (vm.librarySort) {
                1 -> list.sortedBy { it.title.lowercase() }
                2 -> list.sortedWith(compareBy<Track> { it.mainArtist.lowercase() }.thenBy { it.title.lowercase() })
                else -> list.sortedByDescending { it.addedAt }
            }
        }
    } else emptyList()

    Column(Modifier.fillMaxSize()) {
        TabHeader(vm, "Your Library") {
            IconBtn(TIcons.Search, "Search Your Library", { searching = !searching; if (!searching) text = "" })
            IconBtn(TIcons.Plus, "Create", { vm.sheet = Sheet.Create })
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Gap8) {
            if (filter != null) ClearChip { filter = null }
            LIB_FILTERS.filter { filter == null || filter == it }.filter { it != "Albums" || vm.albums.isNotEmpty() }.forEach { f ->
                Chip(f, filter == f) { filter = if (filter == f) null else f }
            }
        }
        if (searching) LibrarySearchField(text) { text = it }

        DownloadingBanner(vm)

        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(CircleShape).clickable { vm.cycleLibrarySort() }.padding(vertical = 8.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(TIcons.Sort, null, tint = S.Text, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text((if (filter == "Songs") SONG_SORTS else SORTS)[vm.librarySort], fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.weight(1f))
            if (filter != "Songs") IconBtn(if (vm.libraryGrid) TIcons.ListView else TIcons.Grid, if (vm.libraryGrid) "List view" else "Grid view", { vm.toggleLibraryGrid() }, iconSize = 18.dp)
        }

        when {
            filter == "Songs" -> LazyColumn(Modifier.fillMaxSize()) {
                if (songsFiltered.isEmpty() && vm.loadedOnce) item { EmptyState(if (text.isBlank()) "No songs yet" else "Couldn't find “$text”", "Search or paste a link to download music.") }
                items(songsFiltered, key = { it.id }) { t ->
                    TrackRow(
                        t, api,
                        current = vm.player.trackId == t.id,
                        playing = vm.player.playing,
                        onClick = { vm.player.play(songsFiltered, songsFiltered.indexOf(t), PlayContext("songs", "library", "Your Library")) },
                        onMore = { vm.sheet = Sheet.TrackMenu(t) },
                    )
                }
                item { BottomSpace(vm) }
            }
            vm.libraryGrid -> LazyVerticalGrid(
                GridCells.Fixed(3),
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(items, key = { it.key }) { item -> GridEntry(vm, item) }
                item(span = { GridItemSpan(3) }) { BottomSpace(vm) }
            }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                if (items.isEmpty() && text.isNotBlank()) item { EmptyState("Couldn't find “$text”", "Try searching again using a different spelling or keyword.") }
                items(items, key = { it.key }) { item -> ListEntry(vm, item, 64.dp) }
                item { BottomSpace(vm) }
            }
        }
    }
}

@Composable
private fun ListEntry(vm: TunoViewModel, item: LibItem, size: Dp) {
    val current = vm.player.hasItem && vm.player.isContext(item.contextId)
    MediaRow(
        title = item.title,
        subtitle = item.subtitle,
        onClick = { vm.navigate(item.route) },
        pinned = item.pinned,
        titleColor = if (current) LocalAccent.current.color else S.Text,
        trailing = { if (current) Equalizer(vm.player.playing, Modifier.padding(end = 6.dp).size(14.dp)) },
    ) { item.image(Modifier.size(size)) }
}

@Composable
private fun GridEntry(vm: TunoViewModel, item: LibItem) {
    Column(Modifier.clip(RoundedCornerShape(4.dp)).clickable { vm.navigate(item.route) }, horizontalAlignment = if (item.circle) Alignment.CenterHorizontally else Alignment.Start) {
        item.image(Modifier.fillMaxWidth().aspectRatio(1f))
        Text(item.title, fontSize = 13.sp, color = S.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (item.pinned) {
                Icon(TIcons.Pin, null, tint = LocalAccent.current.color, modifier = Modifier.size(11.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(item.subtitle, style = T.Small, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LibrarySearchField(text: String, onChange: (String) -> Unit) {
    val focus = remember { FocusRequester() }
    androidx.compose.runtime.LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(6.dp)).background(S.Tile).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(TIcons.Search, null, tint = S.Subdued, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = text,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
            cursorBrush = SolidColor(LocalAccent.current.color),
            modifier = Modifier.weight(1f).focusRequester(focus),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) Text("Search Your Library", color = S.Subdued, fontSize = 14.sp)
                    inner()
                }
            },
        )
        if (text.isNotEmpty()) IconBtn(TIcons.Close, "Clear", { onChange("") }, iconSize = 14.dp, size = 32.dp)
    }
}

/** "Downloading 3 songs" with progress, shown while the server is working (tap for the full list). */
@Composable
private fun DownloadingBanner(vm: TunoViewModel) {
    val active = vm.jobs.filter { it.active }
    if (active.isEmpty()) return
    val running = active.firstOrNull { it.status == "running" }
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(S.Tile)
            .clickable { vm.navigate(Route.Downloads) }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(TIcons.DownloadCircle, null, tint = LocalAccent.current.color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Downloading ${songs(active.size)}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(running?.let { jobTitle(vm, it) } ?: "Waiting…", style = T.Small, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (running != null) {
                LinearProgressIndicator(
                    progress = { (running.progress / 100).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.padding(top = 6.dp).fillMaxWidth().height(3.dp).clip(CircleShape),
                    color = LocalAccent.current.color,
                    trackColor = S.Pressed,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        }
        Icon(TIcons.ChevronRight, null, tint = S.Subdued, modifier = Modifier.padding(start = 8.dp).size(18.dp))
    }
}
