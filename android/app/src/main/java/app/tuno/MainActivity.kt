package app.tuno

import android.Manifest
import android.content.Intent
import android.graphics.Color as AColor
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect

class MainActivity : ComponentActivity() {
    private val vm: TunoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is always dark: light status/navigation bar icons, content drawn behind both bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AColor.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        takeSharedLink(intent)
        setContent {
            // Android 13+ asks before an app may show the playback notification (lock-screen controls).
            val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= 33) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            TunoTheme(vm.colors) {
                Box(Modifier.fillMaxSize().background(S.Bg)) { Root(vm) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeSharedLink(intent)
    }

    /** "Share → Tuno" from YouTube, Spotify, SoundCloud…: opens the download sheet with that link. */
    private fun takeSharedLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        vm.pendingLink = Regex("""https?://\S+""").find(text)?.value ?: return
    }
}

@Composable
private fun Root(vm: TunoViewModel) {
    when (vm.session) {
        Session.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(LocalAccent.current.color), contentAlignment = Alignment.Center) {
                Icon(TIcons.Logo, null, tint = Color.Black, modifier = Modifier.size(52.dp))
            }
        }
        Session.SignedOut -> LoginScreen(vm)
        Session.Offline -> OfflineScreen(vm)
        Session.SignedIn -> App(vm)
    }
}

@Composable
private fun App(vm: TunoViewModel) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val pages = rememberSaveableStateHolder()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(vm.drawerOpen) { if (vm.drawerOpen) drawer.open() else drawer.close() }
    LaunchedEffect(drawer.isOpen) { if (!drawer.isOpen) vm.drawerOpen = false }
    LifecycleResumeEffect(Unit) {
        vm.onResume()
        onPauseOrDispose { vm.foreground = false }
    }
    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.currentSnackbarData?.dismiss()
            snackbar.showSnackbar(it)
            vm.message = null
        }
    }
    LaunchedEffect(vm.pendingLink) {
        vm.pendingLink?.let {
            vm.sheet = Sheet.Link(it)
            vm.pendingLink = null
        }
    }
    BackHandler(enabled = vm.canGoBack()) { vm.back() }
    BackHandler(enabled = vm.drawerOpen) { vm.drawerOpen = false }

    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = drawer.isOpen,
        scrimColor = Color.Black.copy(alpha = 0.6f),
        drawerContent = { ProfileDrawer(vm) },
    ) {
        Box(Modifier.fillMaxSize().background(S.Bg)) {
            AnimatedContent(
                targetState = vm.tab to vm.route,
                transitionSpec = { fadeIn(tween(160)) togetherWith fadeOut(tween(110)) },
                label = "page",
            ) { (tab, route) ->
                pages.SaveableStateProvider("$tab/$route") {
                    when (route) {
                        null -> when (tab) {
                            Tab.Home -> HomeScreen(vm)
                            Tab.Search -> SearchScreen(vm)
                            Tab.Library -> LibraryScreen(vm)
                        }
                        Route.Downloads -> DownloadsScreen(vm)
                        Route.Settings -> SettingsScreen(vm)
                        else -> CollectionScreen(vm, route)
                    }
                }
            }

            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                SnackbarHost(snackbar) { data ->
                    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Text(
                            data.visuals.message,
                            color = Color.Black,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color.White).padding(horizontal = 16.dp, vertical = 14.dp),
                        )
                    }
                }
                // Spotify's fade to black behind the mini player and the tab bar.
                Column(
                    Modifier.fillMaxWidth().background(
                        Brush.verticalGradient(0f to Color.Transparent, 0.3f to Color.Black.copy(alpha = 0.82f), 0.55f to Color.Black.copy(alpha = 0.96f), 1f to Color.Black),
                    ),
                ) {
                    Spacer(Modifier.height(if (vm.player.hasItem) 16.dp else 24.dp))
                    MiniPlayer(vm) { vm.playerOpen = true }
                    TabBar(vm)
                }
            }

            AnimatedVisibility(
                visible = vm.playerOpen && vm.player.hasItem,
                enter = slideInVertically(tween(300)) { it },
                exit = slideOutVertically(tween(240)) { it },
            ) {
                NowPlaying(vm) { vm.playerOpen = false }
            }
            Sheets(vm)
        }
    }
}

@Composable
private fun TabBar(vm: TunoViewModel) {
    Row(Modifier.fillMaxWidth().navigationBarsPadding().height(NAV_HEIGHT.dp)) {
        TabItem("Home", if (vm.tab == Tab.Home) TIcons.HomeFilled else TIcons.Home, vm.tab == Tab.Home) { vm.selectTab(Tab.Home) }
        TabItem("Search", if (vm.tab == Tab.Search) TIcons.SearchBold else TIcons.Search, vm.tab == Tab.Search) { vm.selectTab(Tab.Search) }
        TabItem("Your Library", if (vm.tab == Tab.Library) TIcons.LibraryFilled else TIcons.Library, vm.tab == Tab.Library) { vm.selectTab(Tab.Library) }
        TabItem("Create", TIcons.Plus, false) { vm.sheet = Sheet.Create }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxHeight().clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Icon(icon, label, tint = if (selected) S.Text else S.Subdued, modifier = Modifier.size(26.dp))
        Text(label, fontSize = 10.sp, color = if (selected) S.Text else S.Subdued, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.padding(top = 4.dp))
    }
}

/** Spotify's profile drawer (tap your avatar). */
@Composable
private fun ProfileDrawer(vm: TunoViewModel) {
    val name = vm.user?.name ?: ""
    ModalDrawerSheet(
        drawerContainerColor = Color(0xFF1F1F1F),
        drawerShape = RectangleShape,
        modifier = Modifier.width(310.dp),
        windowInsets = androidx.compose.foundation.layout.WindowInsets(0),
    ) {
        Column(Modifier.statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().clickable { vm.navigate(Route.Settings) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(name, 48.dp)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(name, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text("View account", style = T.RowSub)
                }
            }
            HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
            Spacer(Modifier.height(8.dp))
            val active = vm.activeJobs()
            DrawerItem(TIcons.Download, "Downloads", if (active > 0) "$active" else null) { vm.navigate(Route.Downloads) }
            DrawerItem(TIcons.Clock, "Listening history") { vm.navigate(Route.Recents) }
            DrawerItem(TIcons.Link, "Download from link") { vm.drawerOpen = false; vm.sheet = Sheet.Link() }
            DrawerItem(TIcons.Settings, "Settings and privacy") { vm.navigate(Route.Settings) }
            DrawerItem(TIcons.Logout, "Log out") { vm.logout() }
        }
    }
}

@Composable
private fun DrawerItem(icon: ImageVector, text: String, badge: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = S.Text, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(18.dp))
        Text(text, fontSize = 16.sp, modifier = Modifier.weight(1f))
        if (badge != null) {
            Box(Modifier.clip(CircleShape).background(LocalAccent.current.color).padding(horizontal = 8.dp, vertical = 2.dp)) {
                Text(badge, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = LocalAccent.current.on)
            }
        }
    }
}
