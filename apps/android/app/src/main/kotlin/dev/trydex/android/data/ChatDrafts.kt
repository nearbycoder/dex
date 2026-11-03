package dev.trydex.android.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What you've typed in each chat and not sent yet, kept when you switch to another chat and across restarts (on this
 * device only; the web doesn't keep drafts). The chat list shows which chats have one.
 */
class ChatDrafts(context: Context, private val scope: CoroutineScope) {
    private val store = context.applicationContext.getSharedPreferences("dex-drafts", Context.MODE_PRIVATE)
    private val _drafts = MutableStateFlow<Map<String, String>>(emptyMap())
    val drafts: StateFlow<Map<String, String>> = _drafts.asStateFlow()

    init {
        scope.launch(Dispatchers.IO) {
            val saved = store.all.mapNotNull { (id, text) -> (text as? String)?.takeIf { it.isNotBlank() }?.let { id to it } }.toMap()
            // Anything typed before the file was read wins.
            _drafts.value = saved + _drafts.value
        }
    }

    fun get(sessionId: String): String = _drafts.value[sessionId].orEmpty()

    fun set(sessionId: String, text: String) {
        val keep = text.isNotBlank()
        if (keep && _drafts.value[sessionId] == text || !keep && sessionId !in _drafts.value) return
        _drafts.value = if (keep) _drafts.value + (sessionId to text) else _drafts.value - sessionId
        store.edit().apply { if (keep) putString(sessionId, text) else remove(sessionId) }.apply()
    }

    /** On sign-out: drafts belong to the account. */
    fun clear() {
        _drafts.value = emptyMap()
        store.edit().clear().apply()
    }

    /** Drops drafts of chats that no longer exist. */
    fun retain(sessionIds: Set<String>) {
        _drafts.value.keys.filter { it !in sessionIds }.forEach { set(it, "") }
    }
}
