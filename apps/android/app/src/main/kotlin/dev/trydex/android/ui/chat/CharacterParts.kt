package dev.trydex.android.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.background
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.library.conversationDate
import dev.trydex.android.ui.library.touched
import dev.trydex.android.ui.nav.CharacterPage
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.NewCharacter
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.SessionMeta

/**
 * Characters, pinned above the chats: each opens their conversation (long-press for their page), and + makes one. With
 * none yet, a single quiet row offers to. While searching, only the ones whose name matches.
 */
fun LazyListScope.characterSection(state: DexState, characters: List<CharacterProfile>, selectedChat: String?, now: Long, searching: Boolean) {
    if (searching && characters.isEmpty()) return
    item(key = "characters-header") { SectionLabel("Sidekicks", Modifier.animateItem()) { NewCharacterButton() } }
    if (characters.isEmpty()) item(key = "characters-empty") { MakeCharacterRow(Modifier.animateItem()) }
    val selectedCharacter = state.session(selectedChat ?: "")?.characterId
    items(characters, key = { "character-${it.id}" }) { character ->
        CharacterRow(character, state.session(character.sessionId), character.id == selectedCharacter, now, Modifier.animateItem())
    }
    item(key = "chats-header") { SectionLabel("Chats", Modifier.animateItem()) }
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier, action: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 8.dp).then(modifier), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f).padding(vertical = 12.dp))
        action()
    }
}

@Composable
private fun NewCharacterButton() {
    val app = LocalApp.current
    IconButton(onClick = { app.navigator.open(NewCharacter(nonce = System.nanoTime())) }, modifier = Modifier.size(40.dp).testTag("character-new")) {
        Icon(Icons.Rounded.Add, contentDescription = "New sidekick", tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MakeCharacterRow(modifier: Modifier) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    ListItem(
        headlineContent = { Text("Make a sidekick to talk to", color = scheme.onSurfaceVariant) },
        leadingContent = {
            Surface(shape = CircleShape, color = Color.Transparent, border = BorderStroke(1.dp, scheme.outline), modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) }
            }
        },
        colors = ListItemDefaults.colors(containerColor = scheme.surface),
        modifier = modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(24.dp))
            .clickableRow { app.navigator.open(NewCharacter(nonce = System.nanoTime())) }.testTag("character-make"),
    )
}

/** A character in the chat list: their face, name, and tagline, or "typing…" while they answer. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CharacterRow(character: CharacterProfile, session: SessionMeta?, selected: Boolean, now: Long, modifier: Modifier) {
    val app = LocalApp.current
    val haptics = haptics()
    val scheme = MaterialTheme.colorScheme
    val busy = session?.busy == true
    // Something they said that you haven't seen (not while it's open beside the list): their words, bold, and a dot.
    val unread = session?.unread == true && !selected
    ListItem(
        modifier = modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(24.dp))
            .combinedClickable(
                onClick = { app.navigator.open(Chat(character.sessionId)) },
                onLongClick = {
                    haptics.longPress()
                    app.navigator.open(CharacterPage(character.id, character.sessionId))
                },
                onLongClickLabel = "About ${character.name}",
            )
            .testTag("character-${character.id}")
            .semantics { if (unread) stateDescription = "Unread" },
        headlineContent = { Text(character.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread) FontWeight.Bold else null) },
        supportingContent = {
            val words = session?.lastReply?.takeIf { unread && it.isNotBlank() }
            Text(
                when {
                    busy -> "typing…"
                    words != null -> words
                    else -> character.tagline.ifEmpty { "Say hi" }
                },
                color = if (busy) scheme.primary else if (unread) scheme.onSurface else Color.Unspecified,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        leadingContent = {
            Box {
                CharacterAvatar(character, size = 40.dp)
                if (busy) Box(Modifier.align(Alignment.BottomEnd)) { StatusDot(scheme.primary, pulsing = true, size = 10.dp) }
            }
        },
        trailingContent = {
            if (session != null && !busy && unread) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(Format.timeAgo(session.repliedAt ?: session.updatedAt, now), style = MaterialTheme.typography.labelMedium, color = scheme.primary, fontWeight = FontWeight.SemiBold)
                    UnreadDot(Modifier.testTag("unread-${session.id}"))
                }
            } else if (session != null && !busy && session.touched()) Text(Format.timeAgo(session.updatedAt, now), style = MaterialTheme.typography.labelMedium)
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) scheme.secondaryContainer else scheme.surface),
    )
}

/** The unread marker on a chat or sidekick row. */
@Composable
fun UnreadDot(modifier: Modifier = Modifier) {
    Box(modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).semantics { contentDescription = "Unread" })
}

/** A character's conversation's title: their face and name, and their tagline, "typing…", or which conversation. */
@Composable
fun CharacterChatTitle(character: CharacterProfile, session: SessionMeta, running: Boolean) {
    val app = LocalApp.current
    val earlier = character.sessionId != session.id
    Surface(
        onClick = { app.navigator.open(CharacterPage(character.id, session.id)) },
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent,
        modifier = Modifier.semantics { contentDescription = "About ${character.name}" }.testTag("character-title"),
    ) {
        Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CharacterAvatar(character, size = 32.dp)
            Column {
                Text(character.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val line = when {
                    running -> "typing…"
                    earlier -> "Earlier conversation · ${conversationDate(session.createdAt)}"
                    else -> character.tagline
                }
                if (line.isNotEmpty()) {
                    Text(
                        line,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Above the composer in a conversation from before Start over: the way to the current one. */
@Composable
fun EarlierConversationNote(character: CharacterProfile) {
    val app = LocalApp.current
    Surface(
        onClick = { app.navigator.open(Chat(character.sessionId)) },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("character-earlier"),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.History, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("An earlier conversation with ${character.name}.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(0.01f))
            Text("Go to the current one", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** Their greeting, as their first message at the top of the conversation. */
@Composable
fun CharacterGreeting(character: CharacterProfile) {
    Row(Modifier.fillMaxWidth().testTag("character-greeting"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        CharacterAvatar(character, size = 28.dp, modifier = Modifier.semantics { contentDescription = character.name })
        SelectionContainer(Modifier.weight(1f).padding(top = 3.dp)) {
            Text(character.greeting, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
