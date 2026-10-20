package dev.trydex.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.trydex.android.data.DexRepository
import dev.trydex.core.model.Pending
import dev.trydex.core.model.PendingMessage
import dev.trydex.core.model.TranscriptState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One open chat: its live transcript, the messages you just sent (shown at once, before the agent records them), and
 * what you can do to its run and queue. Lives as long as the chat's place in the back stack.
 */
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
        // Old pending items expire even when nothing else changes.
        viewModelScope.launch {
            while (true) {
                delay(Pending.TTL_MS + 500)
                reconcile(transcript.value)
            }
        }
    }

    private fun reconcile(state: TranscriptState) {
        _pending.value = Pending.reconcile(_pending.value, state.userCount, state.queue.size, System.currentTimeMillis())
    }

    /** Sends a message: it shows at once unless it will queue (the queue panel shows it then). */
    fun send(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        val state = transcript.value
        val willQueue = state.running || state.queue.isNotEmpty()
        if (!willQueue) _pending.value = Pending.add(_pending.value, trimmed, state.userCount, System.currentTimeMillis())
        viewModelScope.launch {
            runCatching { repository.api.sendMessage(sessionId, trimmed) }.onFailure { error ->
                _pending.value = _pending.value.filter { it.text != trimmed }
                _errors.tryEmit(error.message ?: "Couldn't send that.")
            }
        }
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
