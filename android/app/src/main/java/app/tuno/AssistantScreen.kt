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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private val STARTERS = listOf(
    "Make a playlist of my most played songs",
    "Find calm songs in my library and put them in a playlist",
    "Search Spotify for workout playlists",
)

/** Chat with the assistant. It reads your library and proposes playlists and downloads; each one waits for your approval here. */
@Composable
fun AssistantScreen(vm: TunoViewModel) {
    val chat = vm.assistant
    val scope = rememberCoroutineScope()
    val accent = LocalAccent.current
    var input by rememberSaveable { mutableStateOf("") }
    val list = rememberLazyListState()

    LaunchedEffect(Unit) { chat.loadBypass() }
    LaunchedEffect(chat.turns.size, chat.busy) {
        if (chat.turns.isNotEmpty()) list.animateScrollToItem(chat.turns.size - 1)
    }

    fun send(text: String = input) {
        if (chat.busy || text.isBlank()) return
        input = ""
        scope.launch { chat.send(text) }
    }

    Column(Modifier.fillMaxSize()) {
        PageBar("Assistant", { vm.back() })
        Text(
            if (chat.bypass) "Bypass is on, so changes happen straight away." else "Every change waits for your approval.",
            style = T.RowSub,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = list,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (chat.turns.isEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Ask about your music", style = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold), color = S.Text)
                        Text(
                            "It can look through your library, search for songs, and propose playlists and downloads. You approve each change.",
                            style = T.RowSub,
                        )
                        Spacer(Modifier.height(6.dp))
                        STARTERS.forEach { starter ->
                            Box(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(S.Elevated)
                                    .clickable { send(starter) }.padding(horizontal = 16.dp, vertical = 14.dp),
                            ) {
                                Text(starter, fontSize = 15.sp, color = S.Text)
                            }
                        }
                    }
                }
            }
            items(chat.turns) { turn -> TurnView(turn) { card, approve -> scope.launch { chat.decide(card, approve) } } }
            if (chat.busy) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = accent.color, strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("Thinking...", style = T.RowSub)
                    }
                }
            }
            chat.error?.let { err -> item { Text(err, color = S.Error, fontSize = 13.sp) } }
        }

        // The message box sits above the mini player and tab bar.
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = vm.bottomInset()),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).background(S.Elevated).padding(horizontal = 16.dp, vertical = 12.dp)) {
                if (input.isEmpty()) Text("Ask for a playlist or a song", style = T.RowSub)
                BasicTextField(
                    value = input,
                    onValueChange = { input = it },
                    textStyle = TextStyle(color = S.Text, fontSize = 15.sp),
                    cursorBrush = SolidColor(accent.color),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(if (input.isBlank() || chat.busy) S.Pressed else accent.color)
                    .clickable(enabled = input.isNotBlank() && !chat.busy) { send() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(TIcons.ChevronRight, "Send", tint = if (input.isBlank() || chat.busy) S.Subdued else accent.on, modifier = Modifier.size(22.dp))
            }
        }
    }
}

@Composable
private fun TurnView(turn: ChatTurn, decide: (ChangeCard, Boolean) -> Unit) {
    val accent = LocalAccent.current
    if (turn.fromUser) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Text(
                turn.text,
                color = accent.on,
                fontSize = 15.sp,
                modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(accent.color).padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    } else {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                turn.text,
                fontSize = 15.sp,
                color = S.Text,
                modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(S.Elevated).padding(horizontal = 14.dp, vertical = 10.dp),
            )
            turn.notes.forEach { Text(it, style = T.RowSub, modifier = Modifier.padding(start = 6.dp)) }
            turn.changes.forEach { card -> ChangeCardView(card, decide) }
        }
    }
}

@Composable
private fun ChangeCardView(card: ChangeCard, decide: (ChangeCard, Boolean) -> Unit) {
    val accent = LocalAccent.current
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(S.Elevated).padding(14.dp)) {
        Text(card.description, style = T.RowTitle)
        Spacer(Modifier.height(10.dp))
        when (card.status) {
            ChangeStatus.Waiting -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton("Approve", { decide(card, true) }, color = accent.color, textColor = accent.on)
                PillButton("Reject", { decide(card, false) }, filled = false)
            }
            ChangeStatus.Working -> CircularProgressIndicator(Modifier.size(20.dp), color = accent.color, strokeWidth = 2.dp)
            ChangeStatus.Approved -> Text("Done", color = accent.color, fontWeight = FontWeight.Bold)
            ChangeStatus.Rejected -> Text("Rejected", style = T.RowSub)
            ChangeStatus.Failed -> Text(card.message ?: "Couldn't do that", color = S.Error, fontSize = 13.sp)
        }
    }
}
