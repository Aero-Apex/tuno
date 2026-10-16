package app.tuno

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val SOURCES = listOf("ytmusic" to "Songs", "youtube" to "YouTube", "soundcloud" to "SoundCloud", "library" to "Your Library")

/** Spotify's "Browse all" cards (colors from Spotify's category palette), each a quick search. */
private val GENRES = listOf(
    "Pop" to 0xFF8D67AB, "Hip-Hop" to 0xFFBA5D07, "Phonk" to 0xFF503750, "Electronic" to 0xFF0D73EC,
    "Rock" to 0xFFE91429, "Chill" to 0xFF477D95, "Workout" to 0xFF777777, "Indie" to 0xFFE1118C,
    "R&B" to 0xFFDC148C, "Latin" to 0xFFE1118C, "K-pop" to 0xFF148A08, "Lo-fi" to 0xFF7358FF,
    "Slowed + reverb" to 0xFF1E3264, "Jazz" to 0xFF8C1932, "Classical" to 0xFF7D4B32, "Gaming" to 0xFFE8115B,
    "Sleep" to 0xFF1E3264, "Party" to 0xFFAF2896, "Focus" to 0xFF503750, "Throwback" to 0xFFBC5900,
)

private fun isLink(s: String) = s.trim().let { it.startsWith("http://") || it.startsWith("https://") || it.startsWith("spotify:") || it.startsWith("www.") }

@Composable
fun SearchScreen(vm: TunoViewModel) {
    var focused by rememberSaveable { mutableStateOf(false) }
    val active = focused || vm.query.isNotEmpty()
    BackHandler(enabled = active) {
        vm.query = ""
        focused = false
    }
    if (active) SearchActive(vm, onCancel = { vm.query = ""; focused = false }) else SearchBrowse(vm, onFocus = { focused = true })
}

@Composable
private fun SearchBrowse(vm: TunoViewModel, onFocus: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item { TabHeader(vm, "Search") { IconBtn(TIcons.Link, "Download from link", { vm.sheet = Sheet.Link() }) } }
        item {
            // The white search box (opens the search page).
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().height(48.dp).clip(RoundedCornerShape(6.dp))
                    .background(Color.White).clickable(onClick = onFocus).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(TIcons.SearchBold, null, tint = Color(0xFF121212), modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(10.dp))
                Text("What do you want to listen to?", color = Color(0xFF535353), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1)
            }
        }
        val artists = vm.artists.sortedByDescending { it.plays * 4 + it.count }.take(4)
        if (artists.isNotEmpty()) {
            item { Text("Start browsing", style = T.Label.copy(fontSize = 16.sp), modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 12.dp)) }
            items(artists.chunked(2)) { row ->
                Row(Modifier.padding(horizontal = 16.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { a ->
                        BrowseCard(a.name, rememberArtColor(vm.api.imageUrl(a.cover), Color(0xFF27856A)), vm.api.imageUrl(a.cover), Modifier.weight(1f)) {
                            vm.navigate(Route.ArtistPage(a.name))
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        item { Text("Browse all", style = T.Label.copy(fontSize = 16.sp), modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 12.dp)) }
        items(GENRES.chunked(2)) { row ->
            Row(Modifier.padding(horizontal = 16.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (name, color) ->
                    BrowseCard(name, Color(color), null, Modifier.weight(1f)) {
                        vm.query = name
                        vm.searchSource = "ytmusic"
                        vm.search(name, "ytmusic")
                        vm.rememberSearch(name)
                    }
                }
            }
        }
        item { BottomSpace(vm) }
    }
}

/** A colored category card with a tilted cover in the corner. */
@Composable
private fun BrowseCard(title: String, color: Color, image: String?, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.height(96.dp).clip(RoundedCornerShape(6.dp)).background(color).clickable(onClick = onClick)) {
        Text(
            title,
            style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(12.dp).fillMaxWidth(0.7f),
        )
        Box(
            Modifier.align(Alignment.BottomEnd).offset(x = 16.dp, y = 6.dp).size(64.dp).rotate(25f)
                .shadow(6.dp, RoundedCornerShape(4.dp)).clip(RoundedCornerShape(4.dp)).background(color.darken(0.3f)),
            contentAlignment = Alignment.Center,
        ) {
            if (image != null) Art(image, Modifier.fillMaxSize(), RoundedCornerShape(4.dp))
            else Box(
                Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.35f), color.darken(0.45f)))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(TIcons.Note, null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.offset(x = (-6).dp, y = (-4).dp).size(30.dp))
            }
        }
    }
}

@Composable
private fun SearchActive(vm: TunoViewModel, onCancel: () -> Unit) {
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val link = isLink(vm.query)
    LaunchedEffect(Unit) { if (vm.query.isEmpty()) focus.requestFocus() }
    // Searches as you type (after a short pause), like Spotify.
    LaunchedEffect(vm.query, vm.searchSource) {
        if (vm.query.isBlank() || link) return@LaunchedEffect
        kotlinx.coroutines.delay(450)
        vm.search()
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(S.Elevated).statusBarsPadding().height(60.dp).padding(start = 4.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBtn(TIcons.Back, "Back", onCancel)
            BasicTextField(
                value = vm.query,
                onValueChange = { vm.query = it },
                singleLine = true,
                textStyle = TextStyle(color = Color.White, fontSize = 16.sp),
                cursorBrush = SolidColor(LocalAccent.current.color),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    focusManager.clearFocus()
                    if (link) vm.download(vm.query.trim()) else {
                        vm.search()
                        vm.rememberSearch()
                    }
                }),
                modifier = Modifier.weight(1f).focusRequester(focus),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (vm.query.isEmpty()) Text("What do you want to listen to?", color = S.Subdued, fontSize = 16.sp, maxLines = 1)
                        inner()
                    }
                },
            )
            if (vm.query.isNotEmpty()) IconBtn(TIcons.Close, "Clear", { vm.query = ""; focus.requestFocus() }, iconSize = 18.dp, size = 40.dp)
        }

        when {
            link -> LinkPrompt(vm)
            vm.query.isBlank() -> RecentSearches(vm)
            else -> Results(vm)
        }
    }
}

@Composable
private fun LinkPrompt(vm: TunoViewModel) {
    val url = vm.query.trim()
    val done = url in vm.requested
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        MediaRow(
            title = if (done) "Added to your downloads" else "Download from this link",
            subtitle = url,
            onClick = { if (!done) vm.download(url) },
            trailing = { if (done) LikeIcon(true, 22.dp, modifier = Modifier.padding(end = 4.dp)) },
        ) {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(4.dp)).background(S.Elevated), contentAlignment = Alignment.Center) {
                Icon(TIcons.Download, null, tint = S.Text)
            }
        }
        Text(
            "Songs, albums and playlists from YouTube, YouTube Music, Spotify, SoundCloud, Bandcamp and more are saved to your library.",
            style = T.RowSub,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun RecentSearches(vm: TunoViewModel) {
    if (vm.recentSearches.isEmpty()) {
        EmptyState("Play what you love", "Search for artists, songs or albums, or paste a link to download it.")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item { Text("Recent searches", style = T.Label.copy(fontSize = 16.sp), modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp)) }
        items(vm.recentSearches, key = { it }) { q ->
            MediaRow(
                q,
                "Search",
                onClick = { vm.query = q; vm.search(q); vm.rememberSearch(q) },
                trailing = { IconBtn(TIcons.Close, "Remove", { vm.removeRecentSearch(q) }, tint = S.Subdued, iconSize = 16.dp) },
            ) {
                Box(Modifier.size(48.dp).clip(RoundedCornerShape(4.dp)).background(S.Elevated), contentAlignment = Alignment.Center) {
                    Icon(TIcons.Search, null, tint = S.Subdued, modifier = Modifier.size(22.dp))
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                PillButton("Clear recent searches", { vm.removeRecentSearch(null) }, filled = false)
            }
        }
        item { BottomSpace(vm) }
    }
}

@Composable
private fun Results(vm: TunoViewModel) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Gap8) {
            SOURCES.forEach { (id, label) -> Chip(label, vm.searchSource == id) { vm.searchSource = id } }
        }
        Box(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize()) {
                if (!vm.searching && vm.searchedFor.isNotEmpty() && vm.results.isEmpty()) {
                    item { EmptyState("No results found for “${vm.searchedFor}”", "Check the spelling, or try another source.") }
                }
                items(vm.results, key = { it.key }) { r -> ResultRow(vm, r) }
                item { BottomSpace(vm) }
            }
            if (vm.searching) {
                CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 32.dp).size(32.dp), color = S.Subdued, strokeWidth = 3.dp)
            }
        }
    }
}

@Composable
private fun ResultRow(vm: TunoViewModel, r: SearchResult) {
    val inLibrary = r.trackId?.let(vm::track)
    val requested = r.url in vm.requested
    val playingThis = vm.player.hasItem && ((inLibrary != null && vm.player.trackId == inLibrary.id) || vm.player.sourceUrl == r.url)
    val kind = when (r.kind) {
        "playlist" -> "Playlist"
        "album" -> "Album"
        "artist" -> "Artist"
        else -> if (r.source == "youtube") "Video" else "Song"
    }
    MediaRow(
        title = r.title,
        subtitle = listOfNotNull(kind, r.artist.ifBlank { null }).joinToString(" • "),
        titleColor = if (playingThis) LocalAccent.current.color else S.Text,
        onClick = {
            vm.rememberSearch()
            when {
                inLibrary != null -> {
                    val i = vm.tracks.indexOf(inLibrary)
                    vm.player.play(vm.tracks, i, PlayContext("songs", "library", "Your Library"))
                }
                r.kind != "track" -> vm.download(r.url)
                else -> vm.player.playPreview(r)
            }
        },
        trailing = {
            when {
                inLibrary != null -> IconBtn(TIcons.MoreVert, "More", { vm.sheet = Sheet.TrackMenu(inLibrary) }, tint = S.Subdued, iconSize = 20.dp)
                requested -> Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { LikeIcon(true, 22.dp) }
                else -> IconBtn(TIcons.DownloadCircle, "Download", { vm.download(r.url) }, tint = S.Subdued)
            }
        },
    ) {
        Art(vm.api.imageUrl(r.thumbnail), Modifier.size(48.dp), if (r.kind == "artist") CircleShape else RoundedCornerShape(4.dp))
    }
}
