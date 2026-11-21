package dev.trydex.android.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
            if (saved.isNotEmpty()) _drafts.update { saved + it }
        }
    }

    fun get(sessionId: String): String = _drafts.value[sessionId].orEmpty()

    fun set(sessionId: String, text: String) {
        val keep = text.isNotBlank()
        var changed = false
        _drafts.update { current ->
            if (keep && current[sessionId] == text || !keep && sessionId !in current) {
                changed = false
                current
            } else {
                changed = true
                if (keep) current + (sessionId to text) else current - sessionId
            }
        }
        if (changed) {
            store.edit().apply { if (keep) putString(sessionId, text) else remove(sessionId) }.apply()
        }
    }

    /** On sign-out: drafts belong to the account. */
    fun clear() {
        _drafts.value = emptyMap()
        store.edit().clear().apply()
    }

    /** Drops drafts of chats that no longer exist. */
    fun retain(sessionIds: Set<String>) {
        var dropped = emptyList<String>()
        _drafts.update { current ->
            val stale = current.keys.filter { it !in sessionIds }
            dropped = stale
            if (stale.isEmpty()) current else current - stale.toSet()
        }
        if (dropped.isNotEmpty()) {
            store.edit().apply { dropped.forEach(::remove) }.apply()
        }
    }
}
