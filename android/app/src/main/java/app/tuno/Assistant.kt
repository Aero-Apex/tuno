package app.tuno

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException

/** A change the assistant proposed, as the server describes it. */
data class PendingChange(val id: String, val description: String)

/** What one request to the assistant returns: its reply, changes waiting for approval, and changes made already. */
data class AssistantReply(val reply: String, val pending: List<PendingChange>, val done: List<String>)

enum class ChangeStatus { Waiting, Working, Approved, Rejected, Failed }

/** A proposed change on screen. Its status moves as the person approves or rejects it. */
class ChangeCard(val id: String, val description: String) {
    var status by mutableStateOf(ChangeStatus.Waiting)
    var message by mutableStateOf<String?>(null)
}

class ChatTurn(val fromUser: Boolean, val text: String, val changes: List<ChangeCard> = emptyList(), val notes: List<String> = emptyList())

/** The conversation with the assistant. It lives as long as the app, so leaving the screen keeps the chat. */
class AssistantChat(private val api: Api) {
    val turns = mutableStateListOf<ChatTurn>()

    var busy by mutableStateOf(false)
        private set
    var bypass by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    suspend fun loadBypass() {
        bypass = runCatching { api.assistantBypass() }.getOrDefault(bypass)
    }

    /** Returns a message to show when the change didn't go through, or null when it did. */
    suspend fun setBypass(on: Boolean): String? = try {
        api.setAssistantBypass(on)
        bypass = on
        null
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        e.message ?: "Couldn't change that"
    }

    suspend fun send(text: String) {
        val message = text.trim()
        if (message.isEmpty() || busy) return
        turns.add(ChatTurn(fromUser = true, text = message))
        busy = true
        error = null
        try {
            val history = turns.map { (if (it.fromUser) "user" else "assistant") to it.text }
            val reply = api.assistantChat(history)
            turns.add(
                ChatTurn(
                    fromUser = false,
                    text = reply.reply,
                    changes = reply.pending.map { ChangeCard(it.id, it.description) },
                    notes = reply.done.map { "Done: $it" },
                ),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "Couldn't reach the assistant"
        } finally {
            busy = false
        }
    }

    suspend fun decide(card: ChangeCard, approve: Boolean) {
        card.status = ChangeStatus.Working
        try {
            if (approve) {
                api.approveChange(card.id)
                card.status = ChangeStatus.Approved
            } else {
                api.rejectChange(card.id)
                card.status = ChangeStatus.Rejected
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            card.status = ChangeStatus.Failed
            card.message = e.message ?: "Couldn't do that"
        }
    }
}
