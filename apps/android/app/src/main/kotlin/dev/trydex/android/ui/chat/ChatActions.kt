package dev.trydex.android.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material.icons.rounded.AlarmOff
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.ConfirmState
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.CharacterPage
import dev.trydex.android.ui.nav.Chat
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.InboxState
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.Snooze
import dev.trydex.core.model.inboxState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Chats whose titles are being rewritten right now (they pulse while it runs). */
object Naming {
    val ids = androidx.compose.runtime.mutableStateListOf<String>()
}

/** What you can do to a chat from its menu, its swipes, and its header, with errors shown in a snackbar. */
@Stable
class ChatActions(private val scope: CoroutineScope, private val snackbar: SnackbarHostState, private val confirm: ConfirmState, private val app: dev.trydex.android.ui.AppContext) {
    private val api get() = app.graph.repository.api

    private fun run(block: suspend () -> Unit) {
        scope.launch {
            runCatching { block() }.onFailure { snackbar.showSnackbar(it.message ?: "That didn't work.") }
        }
    }

    fun settle(session: SessionMeta, settled: Boolean) = run {
        api.settle(session.id, settled)
        if (settled) {
            val result = snackbar.showSnackbar("Settled “${session.title.take(40)}”", actionLabel = "Undo", withDismissAction = false)
            if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) api.settle(session.id, false)
        }
    }

    fun snooze(session: SessionMeta, until: Long?) = run {
        api.snooze(session.id, until)
        if (until != null) snackbar.showSnackbar("Snoozed ${Snooze.untilLabel(until)}")
    }

    fun mute(session: SessionMeta) = run { api.setSessionMuted(session.id, !session.muted) }

    fun regenerateTitle(session: SessionMeta) {
        if (session.id in Naming.ids) return
        Naming.ids += session.id
        scope.launch {
            runCatching { api.regenerateSessionTitle(session.id) }
                .onFailure { snackbar.showSnackbar("Couldn't regenerate the title: ${it.message}") }
            Naming.ids -= session.id
        }
    }

    /** Start over: a new conversation with the character (same memory); this one stays on their page. */
    fun restartCharacter(character: CharacterProfile) {
        confirm.ask(
            "Start over with ${character.name}?",
            "A new conversation. They keep their memory, and this one stays on their page.",
            confirm = "Start over",
            destructive = false,
        ) {
            run {
                val next = api.restartCharacter(character.id)
                app.navigator.open(Chat(next.sessionId))
            }
        }
    }

    fun delete(session: SessionMeta) {
        confirm.ask("Delete “${session.title}”?", "Its VM and its files go with it.") {
            run {
                api.deleteSession(session.id)
                app.navigator.close(Chat(session.id))
            }
        }
    }
}

@Composable
fun rememberChatActions(snackbar: SnackbarHostState, confirm: ConfirmState): ChatActions {
    val scope = rememberCoroutineScope()
    val app = LocalApp.current
    return remember(scope, snackbar, confirm, app) { ChatActions(scope, snackbar, confirm, app) }
}

/** The chat's menu as a bottom sheet (long press on a row, or ⋯ in its header). */
@Composable
fun ChatMenuSheet(session: SessionMeta, actions: ChatActions, onDismiss: () -> Unit, showMute: Boolean = false, character: CharacterProfile? = null) {
    val app = LocalApp.current
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val haptics = haptics()
    val now = System.currentTimeMillis()
    val state = inboxState(session, now)
    var picking by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("chat-menu")) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(session.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            val item = @Composable { icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, detail: String?, color: Color?, onClick: () -> Unit ->
                ListItem(
                    headlineContent = { Text(label, color = color ?: Color.Unspecified) },
                    supportingContent = detail?.let { { Text(it) } },
                    leadingContent = { Icon(icon, contentDescription = null, tint = color ?: MaterialTheme.colorScheme.onSurfaceVariant) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickableRow {
                        haptics.tap()
                        onClick()
                        onDismiss()
                    },
                )
            }
            if (character != null) {
                // A character's conversation isn't in the inbox: no settling or snoozing, and its title is their name.
                item(Icons.Outlined.Face, "About ${character.name}", "Their profile, memory, and conversations", null) {
                    app.navigator.open(CharacterPage(character.id, session.id))
                }
                item(Icons.Rounded.RestartAlt, "Start over", "A new conversation; they keep their memory", null) { actions.restartCharacter(character) }
                item(if (session.muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff, if (session.muted) "Unmute notifications" else "Mute notifications", null, null) { actions.mute(session) }
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                item(Icons.Outlined.DeleteOutline, "Delete", null, MaterialTheme.colorScheme.error) { actions.delete(session) }
            } else if (!picking) {
                item(Icons.Outlined.AutoAwesome, "Regenerate title", "A fast model names it from its messages", null) { actions.regenerateTitle(session) }
                if (state == InboxState.Settled) item(Icons.Outlined.Inbox, "Move to inbox", null, null) { actions.settle(session, false) }
                else item(Icons.Rounded.DoneAll, "Settle", "Done for now; it comes back when something new happens", null) { actions.settle(session, true) }
                if (state == InboxState.Snoozed) item(Icons.Rounded.AlarmOff, "Unsnooze", session.snoozedUntil?.let { "(${Snooze.untilLabel(it)})" }, null) { actions.snooze(session, null) }
                ListItem(
                    headlineContent = { Text("Snooze…") },
                    supportingContent = { Text("Hide it until later; it comes back with a notification") },
                    leadingContent = { Icon(Icons.Outlined.Snooze, contentDescription = null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickableRow { picking = true },
                )
                if (showMute) item(if (session.muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff, if (session.muted) "Unmute notifications" else "Mute notifications", null, null) { actions.mute(session) }
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                item(Icons.Outlined.DeleteOutline, "Delete", null, MaterialTheme.colorScheme.error) { actions.delete(session) }
            } else {
                Text("Snooze until", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                for (option in Snooze.options(now)) {
                    item(Icons.Outlined.Snooze, option.label, Snooze.whenLabel(option.at, now), null) { actions.snooze(session, option.at) }
                }
            }
        }
    }
}

/** A full-width tap target for list rows. */
fun Modifier.clickableRow(onClick: () -> Unit) = this.clickable(onClick = onClick)
