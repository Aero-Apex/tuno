package app.tuno

import android.Manifest
import android.graphics.Color
import androidx.activity.SystemBarStyle
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    private val vm: TunoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is always dark: light status/navigation bar icons.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            // Android 13+ asks before an app may show the playback notification (lock-screen controls).
            val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= 33) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            TunoTheme(vm.colors) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { Root(vm) }
            }
        }
    }
}

@Composable
private fun Root(vm: TunoViewModel) {
    when (vm.session) {
        Session.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        Session.SignedOut -> LoginScreen(vm)
        Session.Offline -> OfflineScreen(vm)
        Session.SignedIn -> Home(vm)
    }
}

private data class NavItem(val label: String, val icon: @Composable () -> Unit)

@Composable
private fun Home(vm: TunoViewModel) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var playerOpen by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val items = listOf(
        NavItem("Library") { Icon(TIcons.Library, null) },
        NavItem("Search") { Icon(Icons.Default.Search, null) },
        NavItem("Downloads") { Icon(TIcons.Download, null) },
        NavItem("Account") { Icon(Icons.Default.Person, null) },
    )

    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.showSnackbar(it)
            vm.message = null
        }
    }
    // Back closes an open playlist first.
    BackHandler(enabled = vm.openPlaylist != null && !playerOpen) { vm.open(null) }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                Column {
                    MiniPlayer(vm, onOpen = { playerOpen = true })
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                        items.forEachIndexed { i, item ->
                            NavigationBarItem(
                                selected = tab == i,
                                onClick = {
                                    // Tapping Library again goes back from an open playlist.
                                    if (tab == i && i == 0) vm.open(null)
                                    tab = i
                                },
                                icon = { item.icon() },
                                label = { Text(item.label) },
                                alwaysShowLabel = false,
                            )
                        }
                    }
                }
            },
        ) { pad: PaddingValues ->
            Box(Modifier.fillMaxSize().padding(bottom = pad.calculateBottomPadding())) {
                val top = PaddingValues(top = pad.calculateTopPadding())
                when (tab) {
                    0 -> if (vm.openPlaylist != null) PlaylistScreen(vm, top) else LibraryScreen(vm, top)
                    1 -> SearchScreen(vm, top)
                    2 -> DownloadsScreen(vm, top)
                    else -> AccountScreen(vm, top)
                }
            }
        }
        if (playerOpen && vm.player.hasItem) FullPlayer(vm, onClose = { playerOpen = false })
    }
}
