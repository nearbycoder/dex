package dev.trydex.android.ui.chat

import dev.trydex.core.model.ChatAttachment
import dev.trydex.core.model.attachmentSummary
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.trydex.android.data.DexRepository
import dev.trydex.core.model.Pending
import dev.trydex.core.model.PendingMessage
import dev.trydex.core.model.TranscriptState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One open chat: its live transcript, the messages you just sent (shown at once, before the agent records them), and
 * what you can do to its run and queue. Lives as long as the chat's place in the back stack.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(val sessionId: String, private val repository: DexRepository) : ViewModel() {
    val transcript: StateFlow<TranscriptState> = repository.openChat(sessionId)

    private val _pending = MutableStateFlow<List<PendingMessage>>(emptyList())
    /** Messages sent but not yet recorded by the agent ("Sending"). */
    val pending: StateFlow<List<PendingMessage>> = _pending.asStateFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors

    init {
        viewModelScope.launch {
            transcript.collect { state -> reconcile(state) }
        }
        // Old pending items expire even when nothing else changes; idle when nothing is pending.
        viewModelScope.launch {
            _pending.collectLatest { list ->
                if (list.isEmpty()) return@collectLatest
                val oldest = list.minOf { it.at }
                val wait = (oldest + Pending.TTL_MS + 100 - System.currentTimeMillis()).coerceAtLeast(100)
                delay(wait)
                reconcile(transcript.value)
            }
        }
    }

    private fun reconcile(state: TranscriptState) {
        if (_pending.value.isEmpty()) return
        val now = System.currentTimeMillis()
        _pending.update { current ->
            if (current.isEmpty()) current else Pending.reconcile(current, state.userCount, state.queue.size, now)
        }
    }

    /** Sends a message: it shows at once unless it will queue (the queue panel shows it then). */
    fun send(text: String, attachments: List<ChatAttachment> = emptyList()) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() && attachments.isEmpty()) return
        // Shown until the agent records it; a message of only files shows their names.
        val label = trimmed.ifEmpty { "Attached: ${attachmentSummary(attachments.map { it.name })}" }
        val state = transcript.value
        val willQueue = state.running || state.queue.isNotEmpty()
        var pendingId: Long? = null
        if (!willQueue) {
            _pending.update { current ->
                val next = Pending.add(current, label, state.userCount, System.currentTimeMillis())
                pendingId = next.last().id
                next
            }
        }
        repository.noteSent(sessionId)
        viewModelScope.launch {
            runCatching { repository.api.sendMessage(sessionId, trimmed, attachments) }.onFailure { error ->
                pendingId?.let { id -> _pending.update { list -> list.filter { it.id != id } } }
                _errors.tryEmit(error.message ?: "Couldn't send that.")
            }
        }
    }

    /** Words said on a call: sent marked as spoken, so the reply is written to be read aloud. Throws when it didn't send. */
    suspend fun sendSpoken(text: String) {
        repository.noteSent(sessionId)
        repository.api.sendMessage(sessionId, text, spoken = true)
    }

    fun stop() = act { repository.api.abort(sessionId) }
    fun rename(title: String) = act { repository.api.renameSession(sessionId, title) }
    fun configure(model: String, thinking: dev.trydex.core.model.ThinkingLevel) = act { repository.api.configureSession(sessionId, model = model, thinking = thinking) }
    fun configureMcp(servers: List<String>) = act { repository.api.configureSession(sessionId, mcpServers = servers) }
    fun moveQueued(id: String, index: Int) = act { repository.api.moveQueued(sessionId, id, index) }
    fun removeQueued(id: String) = act { repository.api.removeQueued(sessionId, id) }
    fun steerQueued(id: String) = act { repository.api.steerQueued(sessionId, id) }
    fun editQueued(id: String, text: String, done: () -> Unit) = act {
        repository.api.editQueued(sessionId, id, text)
        done()
    }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch { runCatching { block() }.onFailure { _errors.tryEmit(it.message ?: "That didn't work.") } }
    }

    override fun onCleared() {
        repository.closeChat(sessionId)
    }
}
