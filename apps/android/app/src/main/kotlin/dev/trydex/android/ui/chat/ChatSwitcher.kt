package dev.trydex.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.SessionMeta

/** The chats worth switching to: working ones, ones with something you haven't seen, then the latest others. */
data class ActiveChats(val working: List<SessionMeta>, val unread: List<SessionMeta>, val recent: List<SessionMeta>) {
    val attention: Int get() = working.size + unread.size

    companion object {
        fun of(state: DexState, excluding: String?, recent: Int = 6): ActiveChats {
            val others = state.sessions.filter { it.id != excluding }
            val working = others.filter { it.busy }.sortedByDescending { it.updatedAt }
            val unread = others.filter { it.unread && !it.busy }.sortedByDescending { it.updatedAt }
            val rest = others.filter { !it.busy && !it.unread && it.settledAt == null && it.characterId == null }.sortedByDescending { it.updatedAt }.take(recent)
            return ActiveChats(working, unread, rest)
        }
    }
}

/**
 * The chat switcher's button, for a chat on a phone where the list isn't beside it: a badge counts the other chats
 * that are working or have something new, green while any is working.
 */
@Composable
fun ChatSwitcherButton(currentId: String) {
    val app = LocalApp.current
    val haptics = haptics()
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    var open by remember { mutableStateOf(false) }
    val active = state?.let { ActiveChats.of(it, currentId, recent = 0) }
    val count = active?.attention ?: 0
    IconButton(
        onClick = { haptics.tap(); open = true },
        modifier = Modifier.testTag("chat-switcher").semantics {
            contentDescription = buildString {
                append("Switch chats")
                if (active != null && active.working.isNotEmpty()) append(", ${active.working.size} working")
                if (active != null && active.unread.isNotEmpty()) append(", ${active.unread.size} unread")
            }
        },
    ) {
        BadgedBox(badge = {
            if (count > 0) Badge(containerColor = if (active!!.working.isNotEmpty()) DexTheme.colors.success else MaterialTheme.colorScheme.primary) { Text("$count") }
        }) {
            Icon(Icons.Rounded.Forum, contentDescription = null)
        }
    }
    if (open) ChatSwitcherSheet(currentId, onDismiss = { open = false })
}

/** Jump to another chat in one tap, or start a new one, without going back to the list. */
@Composable
fun ChatSwitcherSheet(currentId: String?, onDismiss: () -> Unit) {
    val app = LocalApp.current
    val haptics = haptics()
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val drafts by app.graph.drafts.drafts.collectAsStateWithLifecycle()
    val sheet = rememberModalBottomSheetState()
    val current = state ?: return
    val active = remember(current, currentId) { ActiveChats.of(current, currentId) }
    val now = System.currentTimeMillis()
    fun go(id: String) {
        haptics.tap()
        onDismiss()
        app.navigator.open(Chat(id))
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("chat-switcher-sheet")) {
        LazyColumn(Modifier.fillMaxWidth()) {
            item(key = "new") {
                Button(
                    onClick = {
                        haptics.confirm()
                        onDismiss()
                        app.navigator.open(NewChat(nonce = System.nanoTime()))
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp).height(52.dp).testTag("switcher-new-chat"),
                ) {
                    Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("New chat", modifier = Modifier.padding(start = 8.dp))
                }
            }
            section("Working", active.working, current, now, drafts, ::go)
            section("Waiting for you", active.unread, current, now, drafts, ::go)
            section("Recent", active.recent, current, now, drafts, ::go)
            if (active.working.isEmpty() && active.unread.isEmpty() && active.recent.isEmpty()) {
                item(key = "empty") {
                    Text("No other chats yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
                }
            }
            item(key = "end") { Spacer(Modifier.height(16.dp)) }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.section(
    title: String,
    sessions: List<SessionMeta>,
    state: DexState,
    now: Long,
    drafts: Map<String, String>,
    onPick: (String) -> Unit,
) {
    if (sessions.isEmpty()) return
    item(key = "head-$title", contentType = "head") {
        Text(
            title.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 4.dp),
        )
    }
    items(sessions, key = { "$title-${it.id}" }, contentType = { "chat" }) { session ->
        SwitcherRow(session, state, now, drafts[session.id], onClick = { onPick(session.id) })
    }
}

@Composable
private fun SwitcherRow(session: SessionMeta, state: DexState, now: Long, draft: String?, onClick: () -> Unit) {
    val app = LocalApp.current
    val character = state.character(session.characterId)
    val agent = state.agent(session.agentId)
    val project = state.project(session.projectId)
    ListItem(
        headlineContent = {
            Text(character?.name ?: session.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (session.unread) FontWeight.SemiBold else null)
        },
        supportingContent = {
            when {
                session.busy -> Text(if (character != null) "typing…" else "working…", color = DexTheme.colors.success, maxLines = 1)
                draft != null -> Text("Draft: ${draft.lineSequence().first()}", color = MaterialTheme.colorScheme.error, maxLines = 1, overflow = TextOverflow.Ellipsis)
                session.unread && !session.lastReply.isNullOrBlank() -> Text(session.lastReply!!, maxLines = 1, overflow = TextOverflow.Ellipsis)
                else -> Text((project?.name ?: agent?.name)?.let { "$it · " }.orEmpty() + Format.timeAgo(session.updatedAt, now), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        leadingContent = {
            when {
                character != null -> CharacterAvatar(character, size = 36.dp)
                project != null -> AgentAvatar(project.icon, project.color, 36.dp, project.image)
                agent != null -> AgentAvatar(agent.icon, agent.color, 36.dp)
                else -> Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                    ModelLogo(session.model, app.graph.models, size = 20.dp, modifier = Modifier.clearAndSetSemantics {})
                }
            }
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    session.busy -> StatusDot(DexTheme.colors.success, pulsing = true)
                    session.unread -> UnreadDot()
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickableRow(onClick).testTag("switch-${session.id}"),
    )
}
