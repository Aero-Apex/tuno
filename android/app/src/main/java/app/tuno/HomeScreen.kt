package app.tuno

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val HOME_FILTERS = listOf("All", "Music", "Playlists")

/** One tile of the 2-column shortcut grid at the top of Home. */
private class Shortcut(val key: String, val title: String, val contextId: String, val onClick: () -> Unit, val image: @Composable (Modifier) -> Unit)

@Composable
fun HomeScreen(vm: TunoViewModel) {
    var filter by rememberSaveable { mutableIntStateOf(0) }
    val list = rememberLazyListState()
    val scrolled by remember { derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 8 } }
    val api = vm.api
    // Rows keep their order while you're looking at them (playing a card shouldn't make it jump to the front).
    val recentlyPlayed = remember(vm.libraryVersion) { vm.recentlyPlayed }
    val recentlyAdded = remember(vm.libraryVersion) { vm.recentlyAdded }
    val onRepeat = remember(vm.libraryVersion) { vm.onRepeat }
    val artists = remember(vm.libraryVersion) { vm.artists }
    val tint = rememberArtColor(api.imageUrl((recentlyPlayed.firstOrNull() ?: recentlyAdded.firstOrNull())?.cover), S.Bg)

    val shortcuts = buildList {
        if (filter != 1) add(Shortcut("liked", "Liked Songs", "liked", { vm.navigate(Route.Liked) }) { LikedArt(it, 0.dp) })
        if (filter != 1) vm.playlists.sortedByDescending { it.updatedAt }.take(if (filter == 2) 7 else 3).forEach { p ->
            add(Shortcut("p${p.id}", p.name, "playlist:${p.id}", { vm.navigate(Route.PlaylistPage(p.id)) }) { PlaylistArt(p, api, it, 0.dp) })
        }
        if (filter != 2) {
            val recent = recentlyPlayed.ifEmpty { recentlyAdded }
            recent.take(8).forEachIndexed { i, t ->
                add(Shortcut("t${t.id}", t.title, "track:${t.id}", { vm.player.play(recent, i, PlayContext("recent", "recent", "Recently played")) }) {
                    Art(api.imageUrl(t.cover), it, RoundedCornerShape(0.dp))
                })
            }
        }
    }.distinctBy { it.key }.take(8)

    Box(Modifier.fillMaxSize()) {
        // Spotify's soft color wash behind the top of Home.
        Box(Modifier.fillMaxWidth().height(340.dp).background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.55f), S.Bg))))
        LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 0.dp)) {
            item { Spacer(Modifier.statusBarsPadding().height(64.dp)) }

            if (vm.loadedOnce && vm.tracks.isEmpty() && vm.playlists.isEmpty()) {
                item {
                    EmptyState("Your library is empty", "Search for songs or paste a link from YouTube, Spotify or SoundCloud to start listening.") {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Gap8) {
                            PillButton("Search for music", { vm.selectTab(Tab.Search) })
                            PillButton("Download from link", { vm.sheet = Sheet.Link() }, filled = false)
                        }
                    }
                }
            }

            if (shortcuts.isNotEmpty()) item {
                Column(Modifier.padding(horizontal = 16.dp).padding(top = 4.dp), verticalArrangement = Gap8) {
                    shortcuts.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Gap8) {
                            row.forEach { s ->
                                val current = vm.player.hasItem && (vm.player.isContext(s.contextId) || s.contextId == "track:${vm.player.trackId}")
                                ShortcutTile(s, current, vm.player.playing, Modifier.weight(1f))
                            }
                        }
                    }
                }
            }

            if (filter != 2) {
                trackCarousel(vm, "Jump back in", recentlyPlayed, PlayContext("recent", "recent", "Recently played"), big = true)
                trackCarousel(vm, "Recently added", recentlyAdded, PlayContext("added", "recent", "Recently added"))
                trackCarousel(vm, "On repeat", onRepeat, PlayContext("repeat", "recent", "On repeat"))
            }
            if (filter != 1 && vm.playlists.isNotEmpty()) {
                item { SectionTitle("Your playlists") }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(vm.playlists, key = { it.id }) { p ->
                            CarouselCard(p.name, "Playlist • ${vm.user?.name ?: "You"}", 150.dp, { vm.navigate(Route.PlaylistPage(p.id)) }) {
                                PlaylistArt(p, api, it)
                            }
                        }
                    }
                }
            }
            if (filter != 2) {
                val mixes = artists.filter { it.count >= 2 }.sortedByDescending { it.plays * 4 + it.count }.take(6)
                if (mixes.isNotEmpty()) {
                    item { SectionTitle("Made for ${vm.user?.name ?: "you"}") }
                    item {
                        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            items(mixes, key = { "mix" + it.name }) { a ->
                                val names = vm.artistTracks(a.name).flatMap { it.artists }.distinct().take(3).joinToString(", ")
                                CarouselCard("${a.name} Mix", names, 150.dp, { vm.navigate(Route.ArtistPage(a.name)) }) { MixArt(api.imageUrl(a.cover), "${a.name} Mix", it) }
                            }
                        }
                    }
                }
                val top = artists.sortedWith(compareByDescending<ArtistInfo> { it.plays }.thenByDescending { it.count }).take(10)
                if (top.isNotEmpty()) {
                    item { SectionTitle("Your top artists") }
                    item {
                        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            items(top, key = { "a" + it.name }) { a ->
                                CarouselCard(a.name, "Artist", 130.dp, { vm.navigate(Route.ArtistPage(a.name)) }, circle = true) {
                                    Art(api.imageUrl(a.cover), it, CircleShape, TIcons.Person)
                                }
                            }
                        }
                    }
                }
            }
            item { BottomSpace(vm) }
        }

        // Header: avatar and filter chips, turning solid once the page scrolls (like Spotify).
        Column(Modifier.fillMaxWidth().background(if (scrolled) S.Bg else Color.Transparent)) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Row(
                Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Gap8,
            ) {
                Avatar(vm.user?.name ?: "?", 34.dp) { vm.drawerOpen = true }
                Spacer(Modifier.width(4.dp))
                HOME_FILTERS.forEachIndexed { i, label -> Chip(label, filter == i) { filter = if (filter == i && i != 0) 0 else i } }
            }
        }
    }
}

/** A row of song cards. The first row on Home uses Spotify's bigger "Recommended for today" cards with a small label. */
private fun androidx.compose.foundation.lazy.LazyListScope.trackCarousel(vm: TunoViewModel, title: String, tracks: List<Track>, ctx: PlayContext, big: Boolean = false) {
    if (tracks.isEmpty()) return
    item(key = "h-$title") { SectionTitle(title) }
    item(key = "r-$title") {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(if (big) 16.dp else 14.dp)) {
            items(tracks.size, key = { tracks[it].id }) { i ->
                val t = tracks[i]
                CarouselCard(t.title, t.artist, if (big) 164.dp else 150.dp, { vm.player.play(tracks, i, ctx) }, kicker = if (big) "Song" else null) {
                    Art(vm.api.imageUrl(t.cover), it)
                }
            }
        }
    }
}

@Composable
private fun ShortcutTile(s: Shortcut, current: Boolean, playing: Boolean, modifier: Modifier) {
    Row(
        modifier.height(56.dp).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.1f)).clickable(onClick = s.onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        s.image(Modifier.size(56.dp))
        Text(
            s.title,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            lineHeight = 16.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = S.Text,
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
        )
        if (current) {
            Equalizer(playing, Modifier.padding(end = 10.dp).size(12.dp))
        }
    }
}

/** Spotify's "Mix" covers: the artist picture with a colored band and the mix name along the bottom. */
@Composable
private fun MixArt(url: String?, label: String, modifier: Modifier) {
    val color = rememberArtColor(url, S.Elevated)
    Box(modifier.clip(RoundedCornerShape(4.dp))) {
        Art(url, Modifier.fillMaxSize(), RoundedCornerShape(0.dp))
        Box(Modifier.align(Alignment.TopStart).padding(8.dp).size(18.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) {
            Text("T", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
        Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(30.dp).background(color.copy(alpha = 0.92f)), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(5.dp).fillMaxHeight().background(color.darken(0.35f)))
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 8.dp))
        }
    }
}
