package app.tuno

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Everything a playlist-like page needs (playlist, Liked Songs, artist, album, all songs). */
private class Collection(
    val ctx: PlayContext,
    val title: String,
    val kindLabel: String,
    val tracks: List<Track>,
    val coverUrl: String?,
    val loading: Boolean = false,
    val playlist: Playlist? = null,
    val artistHeader: Boolean = false,
    val numbered: Boolean = false,
    val description: String? = null,
    val image: @Composable (Modifier) -> Unit,
)

@Composable
fun CollectionScreen(vm: TunoViewModel, route: Route) {
    val api = vm.api
    val c = when (route) {
        is Route.PlaylistPage -> {
            val p = vm.playlists.firstOrNull { it.id == route.id } ?: Playlist(route.id, "Playlist", 0, null, 0)
            val t = vm.playlistTracks[route.id]
            Collection(
                PlayContext("playlist:${p.id}", "playlist", p.name), p.name, "Playlist", t.orEmpty(),
                coverUrl = api.imageUrl(p.cover ?: p.covers.firstOrNull()), loading = t == null, playlist = p,
                description = p.description ?: if (p.pending > 0) "Downloading ${songs(p.pending)}…" else null,
            ) { PlaylistArt(p, api, it) }
        }
        Route.Liked -> Collection(PlayContext("liked", "playlist", "Liked Songs"), "Liked Songs", "Playlist", vm.liked, null) { LikedArt(it) }
        Route.Recents -> Collection(
            PlayContext("recents", "recent", "Listening history"), "Listening history", "Recently played", vm.recentlyPlayed,
            api.imageUrl(vm.recentlyPlayed.firstOrNull()?.cover),
        ) { Art(api.imageUrl(vm.recentlyPlayed.firstOrNull()?.cover), it, placeholder = TIcons.Clock) }
        Route.AllSongs -> Collection(PlayContext("songs", "library", "Your Library"), "All songs", "Playlist", vm.tracks, null) { LikedArt(it) }
        is Route.ArtistPage -> {
            val tracks = vm.artistTracks(route.name).sortedWith(compareByDescending<Track> { it.playCount }.thenByDescending { it.addedAt })
            val cover = tracks.firstOrNull { it.mainArtist.equals(route.name, true) && it.cover != null }?.cover ?: tracks.firstOrNull()?.cover
            Collection(PlayContext("artist:${route.name}", "artist", route.name), route.name, "Artist", tracks, api.imageUrl(cover), artistHeader = true, numbered = true) {
                Art(api.imageUrl(cover), it, RoundedCornerShape(0.dp), TIcons.Person)
            }
        }
        is Route.AlbumPage -> {
            val tracks = vm.albumTracks(route.name)
            val cover = tracks.firstOrNull { it.cover != null }?.cover
            Collection(
                PlayContext("album:${route.name}", "album", route.name), route.name, "Album • ${tracks.firstOrNull()?.mainArtist.orEmpty()}", tracks,
                api.imageUrl(cover), numbered = true,
            ) { Art(api.imageUrl(cover), it) }
        }
        else -> return
    }
    CollectionPage(vm, c)
}

@Composable
private fun CollectionPage(vm: TunoViewModel, c: Collection) {
    val list = rememberLazyListState()
    val density = LocalDensity.current
    val accent = LocalAccent.current
    val base = if (c.ctx.id == "liked") Color(0xFF5038A0) else rememberArtColor(c.coverUrl)
    val headerPx = with(density) { (if (c.artistHeader) 300.dp else 320.dp).toPx() }
    // 0 at the top of the page, 1 once the header has scrolled away (the top bar becomes solid).
    val collapse by remember { derivedStateOf { if (list.firstVisibleItemIndex > 0) 1f else (list.firstVisibleItemScrollOffset / headerPx).coerceIn(0f, 1f) } }
    val thisPlaying = vm.player.hasItem && vm.player.isContext(c.ctx.id)
    val total = c.tracks.sumOf { it.duration ?: 0.0 }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            item(key = "header") {
                Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(base, base.darken(0.55f).copy(alpha = 0.6f), S.Bg)))) {
                    if (c.artistHeader) {
                        Box(Modifier.fillMaxWidth().height(300.dp)) {
                            c.image(Modifier.fillMaxSize().graphicsLayer { alpha = 1f - collapse * 0.8f })
                            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.75f))))
                            Text(
                                c.title,
                                style = TextStyle(fontSize = 44.sp, fontWeight = FontWeight.Black, letterSpacing = (-1.2).sp, lineHeight = 46.sp),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.align(Alignment.BottomStart).padding(16.dp),
                            )
                        }
                    } else {
                        Spacer(Modifier.statusBarsPadding().height(56.dp))
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            c.image(
                                Modifier.size(236.dp).graphicsLayer {
                                    val s = 1f - collapse * 0.25f
                                    scaleX = s
                                    scaleY = s
                                    alpha = 1f - collapse
                                }.shadow(24.dp, RoundedCornerShape(4.dp)),
                            )
                        }
                        Spacer(Modifier.height(20.dp))
                        Text(c.title, style = T.Big, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    c.description?.let { Text(it, style = T.RowSub, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) }
                    if (!c.artistHeader && c.ctx.kind == "playlist") {
                        Row(Modifier.padding(start = 16.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(vm.user?.name ?: "?", 22.dp)
                            Spacer(Modifier.width(8.dp))
                            Text(vm.user?.name ?: "You", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Text(
                        listOf(
                            if (c.artistHeader) "${songs(c.tracks.size)} in your library" else c.kindLabel,
                            if (!c.artistHeader && c.tracks.isNotEmpty()) "${songs(c.tracks.size)}, ${formatTotal(total)}" else null,
                        ).filterNotNull().joinToString(" • "),
                        style = T.RowSub,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp),
                    )
                    // Actions: menu on the left; shuffle and the big play button on the right.
                    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (c.playlist != null) {
                            IconBtn(TIcons.Plus, "Add songs", { vm.selectTab(Tab.Search) }, tint = S.Subdued)
                            IconBtn(TIcons.MoreVert, "More options", { vm.sheet = Sheet.PlaylistMenu(c.playlist) }, tint = S.Subdued)
                        } else if (c.tracks.isNotEmpty()) {
                            IconBtn(TIcons.Plus, "Add to playlist", { vm.sheet = Sheet.AddTo(c.tracks) }, tint = S.Subdued)
                        }
                        Spacer(Modifier.weight(1f))
                        IconBtn(
                            TIcons.Shuffle,
                            "Shuffle",
                            { if (thisPlaying) vm.player.toggleShuffle() else vm.player.play(c.tracks, 0, c.ctx, shuffled = true) },
                            tint = if (thisPlaying && vm.player.shuffle) accent.color else S.Subdued,
                            iconSize = 26.dp,
                            enabled = c.tracks.isNotEmpty(),
                        )
                        Spacer(Modifier.width(8.dp))
                        PlayButton(thisPlaying && vm.player.playing, 56.dp, enabled = c.tracks.isNotEmpty()) { vm.player.playContext(c.tracks, c.ctx) }
                    }
                }
            }

            if (c.loading) {
                item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = S.Subdued, strokeWidth = 3.dp) } }
            } else if (c.tracks.isEmpty()) {
                item {
                    when {
                        c.ctx.id == "liked" -> EmptyState("Songs you like will appear here", "Save songs by tapping the plus icon.")
                        c.playlist != null && c.playlist.pending > 0 -> EmptyState("Downloading…", "Songs show up here as soon as they're ready.")
                        c.playlist != null -> EmptyState("Let's start building your playlist", "Find songs in Search and add them with the ⋮ menu.") {
                            PillButton("Add to this playlist", { vm.selectTab(Tab.Search) })
                        }
                        else -> EmptyState("Nothing here yet", "")
                    }
                }
            }

            c.tracks.forEachIndexed { i, t ->
                item(key = "t${t.id}-$i") {
                    val current = vm.player.trackId == t.id && vm.player.hasItem
                    if (c.numbered) {
                        NumberedRow(vm, i, t, current) { vm.player.play(c.tracks, i, c.ctx) }
                    } else {
                        TrackRow(
                            t, vm.api,
                            current = current,
                            playing = vm.player.playing,
                            onClick = { vm.player.play(c.tracks, i, c.ctx, shuffled = false) },
                            onMore = { vm.sheet = Sheet.TrackMenu(t, c.playlist?.id) },
                        )
                    }
                }
            }
            if (c.tracks.isNotEmpty() && !c.loading) {
                item { Text(songs(c.tracks.size) + " • " + formatTotal(total), style = T.RowSub, modifier = Modifier.padding(16.dp)) }
            }
            item { BottomSpace(vm) }
        }

        // Top bar: back button, then a solid bar with the title once the header is scrolled away.
        Box(Modifier.fillMaxWidth().background(base.darken(0.35f).copy(alpha = collapse))) {
            Row(Modifier.statusBarsPadding().height(56.dp).fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(TIcons.Back, "Back", { vm.back() })
                Text(
                    c.title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(end = 12.dp).graphicsLayer { alpha = ((collapse - 0.6f) / 0.4f).coerceIn(0f, 1f) },
                )
            }
        }
    }
}

/** Album and artist pages number their songs (an equalizer replaces the number of the song that is playing). */
@Composable
private fun NumberedRow(vm: TunoViewModel, i: Int, t: Track, current: Boolean, onClick: () -> Unit) {
    val accent = LocalAccent.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterStart) {
            if (current) Equalizer(vm.player.playing, Modifier.size(13.dp))
            else Text("${i + 1}", style = T.RowSub.copy(fontSize = 15.sp))
        }
        Cover(vm.api.imageUrl(t.cover), 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, style = T.RowTitle, color = if (current) accent.color else S.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (t.playCount > 0) "${t.artist} • ${t.playCount} play${if (t.playCount == 1) "" else "s"}" else t.artist,
                style = T.RowSub,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        IconBtn(TIcons.MoreVert, "More options for ${t.title}", { vm.sheet = Sheet.TrackMenu(t) }, tint = S.Subdued, iconSize = 20.dp)
    }
}
