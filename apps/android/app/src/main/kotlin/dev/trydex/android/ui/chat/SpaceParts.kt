package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Workspaces
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.StopCircle
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.MarkdownOptions
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.library.touched
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.nav.NewSpace
import dev.trydex.android.ui.nav.SpaceSettings
import dev.trydex.android.ui.nav.SpaceThreads
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.SpaceProfile
import dev.trydex.core.model.SpaceUpdate
import dev.trydex.core.model.Spaces
import dev.trydex.core.model.ThreadStatus

/**
 * Spaces, between the sidekicks and the chats: each opens its coordinator's chat (long-press to edit it), and + makes
 * one. With none yet, a single quiet row offers to. While searching, only the ones whose name matches.
 */
fun LazyListScope.spaceSection(state: DexState, spaces: List<SpaceProfile>, selectedChat: String?, now: Long, searching: Boolean) {
    if (searching && spaces.isEmpty()) return
    item(key = "spaces-header") { SectionLabel("Spaces", Modifier.animateItem()) { NewSpaceButton() } }
    if (spaces.isEmpty()) item(key = "spaces-empty") { MakeSpaceRow(Modifier.animateItem()) }
    // Selected while its chat or one of its threads is open beside the list.
    val selectedSpace = state.session(selectedChat ?: "")?.spaceId
    items(spaces, key = { "space-${it.id}" }) { space ->
        val threads = Spaces.threads(space, state.sessions)
        val session = state.session(space.sessionId)
        val pending = state.access.pending
        SpaceRow(
            space, session, Spaces.summary(space, threads, pending),
            live = session?.busy == true || threads.any { it.busy },
            selected = space.id == selectedSpace, now = now, modifier = Modifier.animateItem(),
        )
    }
}

@Composable
private fun NewSpaceButton() {
    val app = LocalApp.current
    IconButton(onClick = { app.navigator.open(NewSpace(nonce = System.nanoTime())) }, modifier = Modifier.size(40.dp).testTag("space-new")) {
        Icon(Icons.Rounded.Add, contentDescription = "New space", tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MakeSpaceRow(modifier: Modifier) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    ListItem(
        headlineContent = { Text("Start a space for work in parallel", color = scheme.onSurfaceVariant) },
        leadingContent = {
            Surface(shape = RoundedCornerShape(12.dp), color = Color.Transparent, border = BorderStroke(1.dp, scheme.outline), modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) }
            }
        },
        colors = ListItemDefaults.colors(containerColor = scheme.surface),
        modifier = modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(24.dp))
            .clickableRow { app.navigator.open(NewSpace(nonce = System.nanoTime())) }.testTag("space-make"),
    )
}

/** A space's face: its icon on a tile (the space has no picture of its own). */
@Composable
fun SpaceIcon(size: Dp, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Box(modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(scheme.secondaryContainer), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Workspaces, contentDescription = null, tint = scheme.onSecondaryContainer, modifier = Modifier.size(size * 0.55f))
    }
}

/** A space in the chat list: its name, how its threads are doing, and a live dot while any of it works. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SpaceRow(space: SpaceProfile, session: SessionMeta?, summary: String, live: Boolean, selected: Boolean, now: Long, modifier: Modifier) {
    val app = LocalApp.current
    val haptics = haptics()
    val scheme = MaterialTheme.colorScheme
    // The coordinator said something you haven't seen (not while it's open beside the list).
    val unread = session?.unread == true && !selected
    ListItem(
        modifier = modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(24.dp))
            .combinedClickable(
                onClick = { app.navigator.open(Chat(space.sessionId)) },
                onLongClick = {
                    haptics.longPress()
                    app.navigator.open(SpaceSettings(space.id, space.sessionId))
                },
                onLongClickLabel = "Edit ${space.name}",
            )
            .testTag("space-${space.id}")
            .semantics { if (unread) stateDescription = "Unread" },
        headlineContent = { Text(space.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread) FontWeight.Bold else null) },
        supportingContent = {
            Text(summary, color = if (unread) scheme.onSurface else Color.Unspecified, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("space-summary-${space.id}"))
        },
        leadingContent = {
            Box {
                SpaceIcon(40.dp)
                if (live) Box(Modifier.align(Alignment.BottomEnd)) { StatusDot(DexTheme.colors.success, pulsing = true, size = 10.dp, label = "Working") }
            }
        },
        trailingContent = {
            if (session != null && unread) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(Format.timeAgo(session.repliedAt ?: session.updatedAt, now), style = MaterialTheme.typography.labelMedium, color = scheme.primary, fontWeight = FontWeight.SemiBold)
                    UnreadDot(Modifier.testTag("unread-${session.id}"))
                }
            } else if (session != null && session.touched()) Text(Format.timeAgo(session.updatedAt, now), style = MaterialTheme.typography.labelMedium)
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) scheme.secondaryContainer else scheme.surface),
    )
}

/** A space's chat's title: its icon and name, and its goal or "working…"; tapping it edits the space. */
@Composable
fun SpaceChatTitle(space: SpaceProfile, running: Boolean) {
    val app = LocalApp.current
    Surface(
        onClick = { app.navigator.open(SpaceSettings(space.id, space.sessionId)) },
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent,
        modifier = Modifier.semantics { contentDescription = "Edit ${space.name}" }.testTag("space-title"),
    ) {
        Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SpaceIcon(32.dp)
            Column {
                Text(space.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val line = if (running) "working…" else space.goal.trim().lineSequence().first()
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

/**
 * The way to a space's threads from its chat's bar: a chip on a wide bar, an icon on a narrow one, with how many there
 * are (amber while any needs you, a green dot while any works).
 */
@Composable
fun SpaceThreadsButton(space: SpaceProfile, threads: List<SessionMeta>, state: DexState, narrow: Boolean) {
    val app = LocalApp.current
    val needsYou = threads.count { Spaces.threadStatus(it, state.access.pending) == ThreadStatus.NeedsYou }
    val working = threads.any { it.busy }
    val open = { app.navigator.open(SpaceThreads(space.id, space.sessionId)) }
    val describe = Modifier.testTag("space-threads").semantics {
        contentDescription = "Threads: ${threads.size}" + (if (needsYou > 0) ", $needsYou need you" else "") + (if (working) ", working" else "")
    }
    val badge = @Composable {
        when {
            needsYou > 0 -> Badge(containerColor = DexTheme.colors.warning, contentColor = MaterialTheme.colorScheme.surface) { Text("$needsYou") }
            threads.isNotEmpty() -> Badge(containerColor = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer) { Text("${threads.size}") }
        }
    }
    if (narrow) {
        IconButton(onClick = open, modifier = describe) {
            BadgedBox(badge = { badge() }) {
                Box {
                    Icon(Icons.Outlined.AccountTree, contentDescription = null)
                    if (working) Box(Modifier.align(Alignment.TopStart)) { StatusDot(DexTheme.colors.success, pulsing = true, size = 6.dp) }
                }
            }
        }
    } else {
        AssistChip(
            onClick = open,
            label = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Threads")
                    badge()
                }
            },
            leadingIcon = {
                Box {
                    Icon(Icons.Outlined.AccountTree, contentDescription = null, modifier = Modifier.size(AssistChipDefaults.IconSize))
                    if (working) Box(Modifier.align(Alignment.TopEnd)) { StatusDot(DexTheme.colors.success, pulsing = true, size = 6.dp) }
                }
            },
            modifier = Modifier.padding(end = 4.dp).then(describe),
        )
    }
}

/** Above the composer in a thread: which space it works for, and the way back to it. */
@Composable
fun InSpaceNote(space: SpaceProfile) {
    val app = LocalApp.current
    Surface(
        onClick = { app.navigator.open(Chat(space.sessionId)) },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("thread-space"),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.Workspaces, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("In space ${space.name}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(0.01f))
            Text("Back to the space", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** A thread's status: a dot (pulsing while it works) and its label, colored by what it asks of you. */
@Composable
fun ThreadStatusChip(status: ThreadStatus, modifier: Modifier = Modifier) {
    val color = threadStatusColor(status)
    Row(modifier.semantics { contentDescription = status.label }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        StatusDot(color, pulsing = status == ThreadStatus.Working)
        Text(status.label, style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
    }
}

@Composable
fun threadStatusColor(status: ThreadStatus): Color = when (status) {
    ThreadStatus.NeedsYou -> DexTheme.colors.warning
    ThreadStatus.Working -> DexTheme.colors.success
    ThreadStatus.Failed -> MaterialTheme.colorScheme.error
    ThreadStatus.Done -> MaterialTheme.colorScheme.primary
    ThreadStatus.New -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** A thread the coordinator started, live: its title, status, and latest words; tapping opens it. */
@Composable
fun ThreadCard(id: String, title: String) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val session = state?.session(id)
    val status = session?.let { Spaces.threadStatus(it, state?.access?.pending.orEmpty()) }
    Surface(
        onClick = { app.navigator.open(Chat(id)) },
        enabled = session != null,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().testTag("thread-card-$id"),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Outlined.AccountTree, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(session?.title ?: title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (status != null) ThreadStatusChip(status) else Text("Deleted", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            session?.lastReply?.takeIf { it.isNotBlank() }?.let { words ->
                Text(words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 28.dp))
            }
        }
    }
}

/** What the coordinator heard from its threads, as small event rows rather than your words. */
@Composable
fun SpaceUpdateRows(updates: List<SpaceUpdate>) {
    Column(Modifier.fillMaxWidth().testTag("space-updates"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        updates.forEach { SpaceUpdateRow(it) }
    }
}

/** “✓ “Title” finished”: opens the thread; its final reply folds out below. */
@Composable
private fun SpaceUpdateRow(update: SpaceUpdate) {
    val app = LocalApp.current
    val openUrl = LocalOpenInBrowser.current
    var open by rememberSaveable(update.threadId, update.body) { mutableStateOf(false) }
    val rotation by animateFloatAsState(if (open) 0f else -90f, label = "chevron")
    val (icon, color) = when (update.outcome) {
        SpaceUpdate.Outcome.Finished -> Icons.Rounded.CheckCircle to DexTheme.colors.success
        SpaceUpdate.Outcome.Failed -> Icons.Rounded.ErrorOutline to MaterialTheme.colorScheme.error
        SpaceUpdate.Outcome.Stopped -> Icons.Rounded.StopCircle to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth().testTag("space-update-${update.threadId}")) {
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Surface(onClick = {
                    // A VM helper's report (vm_agents) names its VM, not a chat.
                    if (update.threadId.startsWith("vm:")) app.navigator.open(Machine(update.threadId.removePrefix("vm:"))) else app.navigator.open(Chat(update.threadId))
                }, color = Color.Transparent, shape = RoundedCornerShape(16.dp), modifier = Modifier.weight(1f)) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
                        Text("“${update.title}” ${update.outcome.id}", style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (update.body.isNotBlank()) {
                    IconButton(onClick = { open = !open }, modifier = Modifier.testTag("space-update-toggle-${update.threadId}")) {
                        Icon(Icons.Rounded.ExpandMore, contentDescription = if (open) "Hide its reply" else "Show its reply", modifier = Modifier.rotate(rotation))
                    }
                }
            }
            AnimatedVisibility(open) {
                Box(Modifier.padding(start = 38.dp, end = 16.dp, bottom = 12.dp)) {
                    Markdown(update.body, options = MarkdownOptions(textStyle = MaterialTheme.typography.bodyMedium), onLink = openUrl)
                }
            }
        }
    }
}

/** A space's thread row in its Threads panel: title, status, latest words, and when it last moved. */
@Composable
fun ThreadRow(session: SessionMeta, status: ThreadStatus, now: Long) {
    val app = LocalApp.current
    ListItem(
        headlineContent = { Text(session.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = session.lastReply?.takeIf { it.isNotBlank() }?.let { words -> { Text(words, maxLines = 2, overflow = TextOverflow.Ellipsis) } },
        trailingContent = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                ThreadStatusChip(status)
                Text(Format.timeAgo(session.updatedAt, now), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(20.dp)).clickableRow { app.navigator.open(Chat(session.id)) }.testTag("thread-${session.id}"),
    )
}
