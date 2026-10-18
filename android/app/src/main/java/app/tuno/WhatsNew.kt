package app.tuno

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** One thing that changed in a release. */
data class ChangeItem(val title: String, val text: String? = null)

data class ChangeSection(val heading: String, val items: List<ChangeItem>)

data class ChangeEntry(val title: String, val sections: List<ChangeSection>)

/** What changed in each Android release. Shown once after the app updates. Keep it in step with the release notes. */
val ANDROID_CHANGELOG: Map<String, ChangeEntry> = mapOf(
    "1.1.6" to ChangeEntry(
        title = "What is new",
        sections = listOf(
            ChangeSection(
                "New",
                listOf(ChangeItem("What is new", "After an update, Tuno shows what changed.")),
            ),
            ChangeSection(
                "Changed",
                listOf(ChangeItem("Lighter in the background", "Download progress is checked less often while the app is in the background.")),
            ),
        ),
    ),
)

/** Shows what changed, once after each update. */
@Composable
fun WhatsNewDialog() {
    val prefs = (LocalContext.current.applicationContext as TunoApp).prefs
    val version = BuildConfig.VERSION_NAME
    val entry = ANDROID_CHANGELOG[version]
    var open by remember { mutableStateOf(entry != null && prefs.seenVersion != version) }
    if (!open || entry == null) return

    val accent = LocalAccent.current
    val close = {
        prefs.seenVersion = version
        open = false
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(S.Bg).statusBarsPadding().padding(horizontal = 20.dp, vertical = 16.dp)) {
            Text("New in $version", color = accent.color, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(entry.title, style = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.ExtraBold), color = S.Text)
            Column(Modifier.weight(1f).padding(top = 8.dp).verticalScroll(rememberScrollState())) {
                entry.sections.forEach { section ->
                    Spacer(Modifier.height(16.dp))
                    Text(
                        section.heading.uppercase(),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = S.Subdued,
                    )
                    section.items.forEach { item ->
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.Top) {
                            Box(Modifier.padding(top = 7.dp).size(6.dp).clip(CircleShape).background(accent.color))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(item.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = S.Text)
                                item.text?.let { Text(it, style = T.RowSub, modifier = Modifier.padding(top = 2.dp)) }
                            }
                        }
                    }
                }
            }
            PillButton("Got it", close, Modifier.fillMaxWidth(), color = accent.color, textColor = accent.on)
        }
    }
}
