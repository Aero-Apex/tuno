package app.tuno

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

// ---------------------------------------------------------------- Login / start-up

@Composable
fun LoginScreen(vm: TunoViewModel) {
    var server by rememberSaveable { mutableStateOf(vm.server) }
    var password by rememberSaveable { mutableStateOf("") }
    var showServer by rememberSaveable { mutableStateOf(false) }
    val submit = { vm.login(server, password) }
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
            Icon(TIcons.MusicNote, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Tuno", fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
        Text("Your music, your server", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))

        if (showServer) {
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server address") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
        }
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }),
            modifier = Modifier.fillMaxWidth(),
        )
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp)) }
        Spacer(Modifier.height(18.dp))
        Button(onClick = { submit() }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) {
            if (vm.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text("Log in", fontWeight = FontWeight.Bold)
        }
        TextButton(onClick = { showServer = !showServer }) {
            Text(if (showServer) "Hide server address" else "Server: ${server.removePrefix("https://")}  ·  change")
        }
    }
}

@Composable
fun OfflineScreen(vm: TunoViewModel) {
    Column(Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(vm.error ?: "Can't reach the server", style = MaterialTheme.typography.titleMedium)
        Text("Check your connection and try again.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(18.dp))
        Button(onClick = { vm.bootstrap() }) { Text("Try again") }
        TextButton(onClick = { vm.logout() }) { Text("Use another server") }
    }
}

// ---------------------------------------------------------------- Library

private val LIBRARY_TABS = listOf("Songs", "Playlists", "Liked")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(vm: TunoViewModel, pad: PaddingValues) {
    var tab by rememberSaveable { mutableStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("") }
    val visible by remember {
        derivedStateOf {
            val base = if (tab == 2) vm.tracks.filter { it.liked } else vm.tracks
            if (filter.isBlank()) base else base.filter { "${it.title} ${it.artist} ${it.album ?: ""}".contains(filter, ignoreCase = true) }
        }
    }
    Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
        Text("Your Library", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LIBRARY_TABS.forEachIndexed { i, label -> FilterChip(selected = tab == i, onClick = { tab = i }, label = { Text(label) }) }
        }
        if (tab != 1) {
            OutlinedTextField(
                value = filter,
                onValueChange = { filter = it },
                placeholder = { Text("Filter ${if (tab == 2) "liked songs" else "songs"}") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                trailingIcon = { if (filter.isNotEmpty()) IconButton(onClick = { filter = "" }) { Icon(Icons.Default.Clear, "Clear") } },
                singleLine = true,
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
        }
        PullToRefreshBox(isRefreshing = vm.libraryLoading, onRefresh = { vm.refreshLibrary() }, modifier = Modifier.weight(1f)) {
            if (tab == 1) PlaylistList(vm, pad) else TrackList(vm, visible, pad, empty = if (tab == 2) "No liked songs yet" else "No songs yet. Search or paste a link to download one.")
        }
    }
}

@Composable
private fun TrackList(vm: TunoViewModel, tracks: List<Track>, pad: PaddingValues, empty: String, header: (@Composable () -> Unit)? = null) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = pad.calculateBottomPadding() + 8.dp)) {
        if (header != null) item { header() }
        if (tracks.isEmpty() && !vm.libraryLoading) {
            item { Text(empty, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
        }
        items(tracks, key = { it.id }) { t ->
            val index = tracks.indexOf(t)
            TrackRow(
                track = t,
                api = vm.api,
                current = vm.player.trackId == t.id,
                onClick = { vm.player.play(tracks, index) },
                onLike = { vm.toggleLike(t) },
                onDelete = { vm.delete(t) },
            )
        }
    }
}

@Composable
private fun PlaylistList(vm: TunoViewModel, pad: PaddingValues) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = pad.calculateBottomPadding() + 8.dp)) {
        if (vm.playlists.isEmpty() && !vm.libraryLoading) {
            item { Text("No playlists yet. Paste a playlist link to download one.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
        }
        items(vm.playlists, key = { it.id }) { p ->
            Row(
                Modifier.fillMaxWidth().clickable { vm.open(p) }.padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Cover(vm.api.imageUrl(p.cover), 56.dp)
                Column(Modifier.weight(1f)) {
                    Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (p.pending > 0) "${p.pending} downloading" else "Playlist · ${p.count} songs",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
fun PlaylistScreen(vm: TunoViewModel, pad: PaddingValues) {
    val p = vm.openPlaylist ?: return
    Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
        Row(Modifier.padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { vm.open(null) }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { vm.player.play(vm.playlistTracks, 0) }, enabled = vm.playlistTracks.isNotEmpty()) {
                Icon(Icons.Default.PlayArrow, null)
                Text("Play")
            }
            OutlinedButton(onClick = { vm.player.play(vm.playlistTracks.shuffled(), 0, shuffled = false) }, enabled = vm.playlistTracks.isNotEmpty()) {
                Icon(TIcons.Shuffle, null, modifier = Modifier.size(18.dp))
                Text(" Shuffle")
            }
        }
        TrackList(vm, vm.playlistTracks, pad, empty = if (p.pending > 0) "Songs are still downloading…" else "This playlist is empty")
    }
}

// ---------------------------------------------------------------- Search

private val SOURCES = listOf("ytmusic" to "YT Music", "youtube" to "YouTube", "soundcloud" to "SoundCloud", "library" to "Library")

@Composable
fun SearchScreen(vm: TunoViewModel, pad: PaddingValues) {
    var query by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("ytmusic") }
    val isLink = query.trim().let { it.startsWith("http://") || it.startsWith("https://") || it.startsWith("spotify:") }
    val go = {
        if (isLink) {
            vm.download(query.trim())
            query = ""
        } else vm.search(query, source)
    }
    Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
        Text("Search", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 8.dp))
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Songs, artists… or paste a link") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Clear, "Clear") } },
            singleLine = true,
            shape = CircleShape,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { go() }),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        if (isLink) {
            Button(onClick = { go() }, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                Icon(TIcons.Download, null, modifier = Modifier.size(20.dp))
                Text("  Download this link", fontWeight = FontWeight.Bold)
            }
        } else {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SOURCES.forEach { (id, label) ->
                    FilterChip(
                        selected = source == id,
                        onClick = {
                            source = id
                            if (query.isNotBlank()) vm.search(query, id)
                        },
                        label = { Text(label) },
                    )
                }
            }
        }
        Box(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = pad.calculateBottomPadding() + 8.dp)) {
                if (!vm.searching && vm.searchedFor.isNotEmpty() && vm.results.isEmpty()) {
                    item { Text("No results for “${vm.searchedFor}”", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                }
                items(vm.results, key = { it.key }) { r -> ResultRow(vm, r) }
            }
            if (vm.searching) CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 24.dp))
        }
    }
}

@Composable
private fun ResultRow(vm: TunoViewModel, r: SearchResult) {
    val inLibrary = r.trackId != null
    Row(
        Modifier.fillMaxWidth()
            .clickable {
                when {
                    r.kind != "track" -> vm.download(r.url)
                    inLibrary -> vm.tracks.indexOfFirst { it.id == r.trackId }.takeIf { it >= 0 }?.let { vm.player.play(vm.tracks, it) }
                    else -> vm.player.playPreview(r)
                }
            }
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(vm.api.imageUrl(r.thumbnail), 48.dp)
        Column(Modifier.weight(1f)) {
            Text(r.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            Text(
                listOfNotNull(r.artist.ifBlank { null }, if (r.kind != "track") r.kind else null, formatSeconds(r.duration).ifEmpty { null }).joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (inLibrary) Text("In library", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
        else IconButton(onClick = { vm.download(r.url) }) { Icon(TIcons.Download, "Download") }
    }
}

// ---------------------------------------------------------------- Downloads

@Composable
fun DownloadsScreen(vm: TunoViewModel, pad: PaddingValues) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Only checks the server while this screen is visible, quickly while something is downloading.
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                vm.refreshJobs()
                delay(if (vm.activeJobs() > 0) 2500 else 15_000)
            }
        }
    }
    Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Downloads", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.clearFinished() }) { Text("Clear finished") }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = pad.calculateBottomPadding() + 8.dp)) {
            if (vm.jobs.isEmpty()) {
                item { Text("Nothing downloading. Paste a link or tap the download icon on a search result.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
            }
            items(vm.jobs, key = { it.id }) { j ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(j.title ?: j.url ?: "Song", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                            val sub = when (j.status) {
                                "running" -> "Downloading ${j.progress.toInt()}%"
                                "queued" -> "Waiting"
                                "done" -> "Done"
                                "canceled" -> "Canceled"
                                else -> j.error ?: "Failed"
                            }
                            Text(
                                listOfNotNull(j.artist, sub).joinToString(" · "),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                color = if (j.status == "error") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        when (j.status) {
                            "running", "queued" -> IconButton(onClick = { vm.cancelJob(j) }) { Icon(Icons.Default.Close, "Cancel") }
                            "error", "canceled" -> IconButton(onClick = { vm.retryJob(j) }) { Icon(Icons.Default.Refresh, "Retry") }
                        }
                    }
                    if (j.status == "running") LinearProgressIndicator(progress = { (j.progress / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Account

@Composable
fun AccountScreen(vm: TunoViewModel, pad: PaddingValues) {
    val user = vm.user ?: return
    var cacheText by remember { mutableStateOf(formatBytes(vm.cacheBytes())) }
    Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Account", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                Text(user.name.take(1).uppercase(), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
            Column {
                Text(user.name, style = MaterialTheme.typography.titleMedium)
                Text(if (user.isAdmin) "Admin" else "Member", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column {
            Text("Storage on the server", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(progress = { (vm.used.toFloat() / user.quotaBytes.coerceAtLeast(1)).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            Text("${formatBytes(vm.used)} of ${formatBytes(user.quotaBytes)} · ${vm.tracks.size} songs", modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyMedium)
        }
        Column {
            Text("Server", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(vm.server)
        }
        Column {
            Text("On this phone", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("$cacheText of songs kept for replaying without data")
            TextButton(onClick = { vm.clearCaches(); cacheText = formatBytes(vm.cacheBytes()) }) { Text("Clear") }
        }
        Spacer(Modifier.weight(1f))
        OutlinedButton(onClick = { vm.logout() }, modifier = Modifier.fillMaxWidth()) { Text("Log out") }
        Text("Tuno for Android 1.0", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}
