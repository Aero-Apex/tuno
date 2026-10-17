package app.tuno

import android.net.Uri
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- Login / start-up

@Composable
fun LoginScreen(vm: TunoViewModel) {
    var server by rememberSaveable { mutableStateOf(vm.server) }
    var password by rememberSaveable { mutableStateOf("") }
    var showServer by rememberSaveable { mutableStateOf(false) }
    var reveal by rememberSaveable { mutableStateOf(false) }
    val submit = { vm.login(server, password) }
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF2A2A2A), S.Black)))) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            Box(Modifier.size(64.dp).clip(CircleShape).background(LocalAccent.current.color), contentAlignment = Alignment.Center) {
                Icon(TIcons.Logo, null, tint = Color.Black, modifier = Modifier.size(46.dp))
            }
            Spacer(Modifier.height(24.dp))
            Text("Millions of songs.\nYour own server.", style = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp, lineHeight = 32.sp), textAlign = TextAlign.Center)
            Spacer(Modifier.height(36.dp))

            if (showServer) {
                FieldLabel("Server address")
                LoginField(server, { server = it }, KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next))
                Spacer(Modifier.height(16.dp))
            }
            FieldLabel("Password")
            LoginField(
                password,
                { password = it },
                KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                KeyboardActions(onGo = { submit() }),
                if (reveal) VisualTransformation.None else PasswordVisualTransformation(),
                trailing = {
                    Text(
                        if (reveal) "Hide" else "Show",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = S.Subdued,
                        modifier = Modifier.clip(CircleShape).clickable { reveal = !reveal }.padding(8.dp),
                    )
                },
            )
            vm.error?.let {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(TIcons.Info, null, tint = S.Error, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(it, color = S.Error, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(28.dp))
            PillButton("Log in", { submit() }, Modifier.fillMaxWidth(0.6f), enabled = !vm.busy && password.isNotEmpty()) {
                if (vm.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.Black)
                else Text("Log in", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (password.isNotEmpty()) Color.Black else S.Muted)
            }
            Spacer(Modifier.height(16.dp))
            PillButton(if (showServer) "Hide server address" else "Server: ${server.removePrefix("https://").removePrefix("http://")}", { showServer = !showServer }, filled = false)
            Spacer(Modifier.height(48.dp))
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
}

@Composable
private fun LoginField(
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardOptions,
    actions: KeyboardActions = KeyboardActions.Default,
    visual: VisualTransformation = VisualTransformation.None,
    trailing: @Composable () -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFF3E3E3E)).padding(start = 14.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
            cursorBrush = SolidColor(Color.White),
            keyboardOptions = keyboard,
            keyboardActions = actions,
            visualTransformation = visual,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

@Composable
fun OfflineScreen(vm: TunoViewModel) {
    Column(
        Modifier.fillMaxSize().background(S.Bg).padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("No connection", style = T.PageTitle)
        Text(vm.error ?: "Can't reach the server", style = T.RowSub.copy(fontSize = 14.sp), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(28.dp))
        PillButton("Try again", { vm.bootstrap() })
        Spacer(Modifier.height(12.dp))
        PillButton("Use another server", { vm.logout() }, filled = false)
    }
}

// ---------------------------------------------------------------- Downloads

/** A readable name for a download, even before the server knows the song's title. */
fun jobTitle(vm: TunoViewModel, j: Job): String {
    j.title?.let { return it }
    j.trackId?.let(vm::track)?.let { return it.title }
    val url = j.url ?: return "Song"
    val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
    val v = uri.getQueryParameter("v")
    val last = uri.pathSegments.lastOrNull()?.takeIf { it.isNotBlank() && it.any(Char::isLetter) }
    return when {
        last != null && !last.all { it.isDigit() } && v == null ->
            last.replace('-', ' ').replace('_', ' ').split(' ').joinToString(" ") { w -> w.replaceFirstChar(Char::uppercase) }
        else -> url.removePrefix("https://").removePrefix("http://").removePrefix("www.")
    }
}

private fun jobSource(j: Job): String {
    val host = j.url?.let { runCatching { Uri.parse(it).host }.getOrNull() }.orEmpty()
    return when {
        "soundcloud" in host -> "SoundCloud"
        "spotify" in host || j.source == "spotify" -> "Spotify"
        "music.youtube" in host -> "YouTube Music"
        "youtu" in host -> "YouTube"
        "bandcamp" in host -> "Bandcamp"
        host.isNotEmpty() -> host.removePrefix("www.")
        else -> j.source?.replaceFirstChar(Char::uppercase) ?: "Search"
    }
}

@Composable
fun DownloadsScreen(vm: TunoViewModel) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Checks the server only while this page is on screen: often while something downloads, rarely otherwise.
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                vm.refreshJobs()
                delay(if (vm.activeJobs() > 0) 2500 else 15_000)
            }
        }
    }
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        PageBar("Downloads", { vm.back() }) {
            Box {
                IconBtn(TIcons.MoreVert, "More options", { menu = true })
                DropdownMenu(menu, { menu = false }, containerColor = S.Elevated) {
                    DropdownMenuItem({ Text("Clear finished") }, { menu = false; vm.clearFinished() })
                    DropdownMenuItem({ Text("Retry failed") }, { menu = false; vm.retryFailed() })
                    DropdownMenuItem({ Text("Cancel all") }, { menu = false; vm.cancelAll() })
                }
            }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            item {
                MediaRow("Download from link", "YouTube, Spotify, SoundCloud and more", { vm.sheet = Sheet.Link() }) {
                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(4.dp)).background(S.Tile), contentAlignment = Alignment.Center) {
                        Icon(TIcons.Link, null, tint = S.Text)
                    }
                }
            }
            if (vm.jobs.isEmpty()) {
                item { EmptyState("Nothing downloading", "Songs you download from a link or a search result show up here.") }
            }
            items(vm.jobs, key = { it.id }) { j -> JobRow(vm, j) }
            item { BottomSpace(vm) }
        }
    }
}

@Composable
private fun JobRow(vm: TunoViewModel, j: Job) {
    val accent = LocalAccent.current
    val status = when (j.status) {
        "running" -> "Downloading • ${j.progress.toInt()}%"
        "queued" -> "Waiting"
        "done" -> "Downloaded"
        "canceled" -> "Canceled"
        else -> j.error ?: "Failed"
    }
    val done = j.status == "done"
    Row(
        Modifier.fillMaxWidth().clickable(enabled = done && j.trackId != null) {
            vm.track(j.trackId!!)?.let { t -> vm.player.play(listOf(t), 0) }
        }.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(56.dp)) {
            Art(j.thumbnail?.let(vm.api::imageUrl) ?: j.trackId?.let(vm::track)?.cover?.let(vm.api::imageUrl), Modifier.size(56.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(jobTitle(vm, j), style = T.RowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                if (done) {
                    Icon(TIcons.DownloadCircle, null, tint = accent.color, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(5.dp))
                }
                Text(
                    listOfNotNull(j.artist ?: jobSource(j), status).joinToString(" • "),
                    style = T.RowSub,
                    color = if (j.status == "error") S.Error else S.Subdued,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (j.status == "running") {
                LinearProgressIndicator(
                    progress = { (j.progress / 100).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.padding(top = 8.dp, end = 8.dp).fillMaxWidth().height(3.dp).clip(CircleShape),
                    color = accent.color,
                    trackColor = S.Pressed,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        }
        when (j.status) {
            "running", "queued" -> IconBtn(TIcons.Close, "Cancel", { vm.cancelJob(j) }, tint = S.Subdued, iconSize = 18.dp)
            "error", "canceled" -> IconBtn(TIcons.Refresh, "Retry", { vm.retryJob(j) }, tint = S.Subdued, iconSize = 20.dp)
            else -> Spacer(Modifier.width(8.dp))
        }
    }
}

// ---------------------------------------------------------------- Settings

@Composable
fun SettingsScreen(vm: TunoViewModel) {
    val user = vm.user ?: return
    var cacheText by remember { mutableStateOf(formatBytes(vm.cacheBytes())) }
    val accent = LocalAccent.current
    Column(Modifier.fillMaxSize()) {
        PageBar("Settings", { vm.back() })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(user.name, 56.dp)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(user.name, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(if (user.isAdmin) "Owner" else "Member", style = T.RowSub)
                }
            }

            SettingsHeading("Storage")
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Your music on the server", style = T.RowTitle)
                Text("${formatBytes(vm.used)} of ${formatBytes(user.quotaBytes)} used • ${songs(vm.tracks.size)}", style = T.RowSub, modifier = Modifier.padding(top = 2.dp))
                LinearProgressIndicator(
                    progress = { (vm.used.toFloat() / user.quotaBytes.coerceAtLeast(1)).coerceIn(0f, 1f) },
                    modifier = Modifier.padding(top = 10.dp).fillMaxWidth().height(4.dp).clip(CircleShape),
                    color = accent.color,
                    trackColor = S.Pressed,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
            SettingRow("Cache on this phone", "$cacheText of songs kept for replaying without data") {
                PillButton("Clear cache", { vm.clearCaches(); cacheText = formatBytes(vm.cacheBytes()) }, filled = false)
            }
            SettingsHeading("Downloads")
            SettingRow("Download queue", "${vm.activeJobs()} downloading", onClick = { vm.navigate(Route.Downloads) }) {
                Icon(TIcons.ChevronRight, null, tint = S.Subdued, modifier = Modifier.size(18.dp))
            }

            UpdateSettings(vm)

            AssistantSettings(vm)

            SettingsHeading("About")
            SettingRow("Server", vm.server)

            SettingsHeading("Account")
            SettingRow("Signed in", "You are logged in as ${user.name}.")
            Spacer(Modifier.height(24.dp))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { PillButton("Log out", { vm.logout() }) }
            BottomSpace(vm)
        }
    }
}

@Composable
private fun UpdateSettings(vm: TunoViewModel) {
    val ctx = LocalContext.current
    val u = vm.updates
    val accent = LocalAccent.current
    SettingsHeading("Updates")
    SettingRow(
        "Update automatically",
        "Download new versions in the background and install them when no music is playing.",
        onClick = { u.enableAuto(!u.auto) },
    ) {
        Switch(
            checked = u.auto,
            onCheckedChange = { u.enableAuto(it) },
            colors = SwitchDefaults.colors(
                checkedTrackColor = accent.color,
                checkedThumbColor = accent.on,
                uncheckedTrackColor = S.Pressed,
                uncheckedThumbColor = S.Subdued,
                uncheckedBorderColor = S.Pressed,
            ),
        )
    }
    val state = u.state
    val status = when (state) {
        UpdateState.Idle -> "Tuno ${BuildConfig.VERSION_NAME}"
        UpdateState.Checking -> "Checking for updates..."
        UpdateState.UpToDate -> "Tuno ${BuildConfig.VERSION_NAME} is up to date"
        is UpdateState.Downloading -> "Downloading ${state.info.version} - ${(state.progress * 100).toInt()}%"
        is UpdateState.Ready -> "${state.info.version} is ready to install"
        is UpdateState.NeedsPermission -> "${state.info.version} is ready. Allow Tuno to install updates first."
        is UpdateState.Installing -> "Installing ${state.info.version}..."
        is UpdateState.NeedsConfirm -> "Confirm the update on the next screen"
        is UpdateState.Failed -> state.message
    }
    SettingRow("Version", status) {
        when (state) {
            is UpdateState.Ready -> PillButton("Install now", { u.install() }, filled = false)
            is UpdateState.NeedsPermission -> PillButton("Allow", { ctx.startActivity(u.permissionIntent()) }, filled = false)
            is UpdateState.NeedsConfirm -> PillButton("Continue", { u.onResumed(ctx) }, filled = false)
            UpdateState.Checking, is UpdateState.Downloading, is UpdateState.Installing ->
                CircularProgressIndicator(Modifier.size(22.dp), color = accent.color, strokeWidth = 2.dp)
            else -> PillButton("Check now", { u.checkForUpdate(manual = true) }, filled = false)
        }
    }
}

@Composable
private fun AssistantSettings(vm: TunoViewModel) {
    val chat = vm.assistant
    val scope = rememberCoroutineScope()
    val accent = LocalAccent.current
    val setBypass = { on: Boolean ->
        scope.launch {
            val problem = chat.setBypass(on)
            if (problem != null) vm.message = problem
        }
    }
    SettingsHeading("Assistant")
    SettingRow("Ask the assistant", "Find songs, make playlists and download music. You approve each change.", onClick = { vm.navigate(Route.Assistant) }) {
        Icon(TIcons.ChevronRight, null, tint = S.Subdued, modifier = Modifier.size(18.dp))
    }
    SettingRow(
        "Bypass permissions",
        "Let the assistant make changes straight away, without asking. Off by default.",
        onClick = { setBypass(!chat.bypass) },
    ) {
        Switch(
            checked = chat.bypass,
            onCheckedChange = { setBypass(it) },
            colors = SwitchDefaults.colors(
                checkedTrackColor = accent.color,
                checkedThumbColor = accent.on,
                uncheckedTrackColor = S.Pressed,
                uncheckedThumbColor = S.Subdued,
                uncheckedBorderColor = S.Pressed,
            ),
        )
    }
}

@Composable
private fun SettingsHeading(text: String) {
    Text(text, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 28.dp, bottom = 4.dp))
}

@Composable
private fun SettingRow(title: String, subtitle: String, onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = T.RowTitle)
            Text(subtitle, style = T.RowSub, modifier = Modifier.padding(top = 2.dp))
        }
        Spacer(Modifier.width(12.dp))
        trailing()
    }
}
