package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.NotificationsOff
import androidx.compose.material.icons.rounded.Snooze
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.client.ConnectionStatus
import dev.trydex.core.model.DexState
import dev.trydex.core.model.Format
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.Snooze
import dev.trydex.core.model.inboxGroups
import kotlinx.coroutines.delay

@Composable
fun ChatListScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val status by repository.status.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val confirm = rememberConfirm()
    val actions = rememberChatActions(snackbar, confirm)
    var menu by remember { mutableStateOf<SessionMeta?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    val query = rememberTextFieldState()
    // Relative times and snoozes refresh every 30 seconds.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    val selected = (app.navigator.stack(dev.trydex.android.ui.nav.Tab.Chats).getOrNull(1) as? Chat)?.id
    val listState = rememberLazyListState()
    val expandedFab by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 } }
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = {
                    if (searching) {
                        TextField(
                            state = query,
                            placeholder = { Text("Search chats and sidekicks") },
                            lineLimits = androidx.compose.foundation.text.input.TextFieldLineLimits.SingleLine,
                            colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                            modifier = Modifier.fillMaxWidth().testTag("search-chats"),
                        )
                    } else {
                        Text("Chats")
                    }
                },
                actions = {
                    IconButton(onClick = {
                        searching = !searching
                        if (!searching) query.edit { replace(0, length, "") }
                    }) {
                        Icon(if (searching) Icons.Outlined.Close else Icons.Outlined.Search, contentDescription = if (searching) "Close search" else "Search chats")
                    }
                },
                scrollBehavior = scroll,
            )
        },
        floatingActionButton = {
            // On rails the new-chat button lives in the rail.
            if (app.panes < 2) {
                ExtendedFloatingActionButton(
                    onClick = { app.navigator.open(NewChat(nonce = System.nanoTime())) },
                    expanded = expandedFab,
                    icon = { Icon(Icons.Rounded.Edit, contentDescription = null) },
                    text = { Text("New chat") },
                    modifier = Modifier.testTag("new-chat"),
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val current = state
            AnimatedVisibility(status is ConnectionStatus.Connecting || status is ConnectionStatus.Waiting, modifier = Modifier.align(Alignment.TopCenter)) {
                LinearWavyProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = "Connecting to your agent" })
            }
            if (current == null) {
                BoneRows(8)
            } else {
                val needle = query.text.toString().trim().lowercase()
                // A character's conversations live under them, not in the inbox.
                val chats = current.chats
                val sessions = if (needle.isEmpty()) chats else chats.filter { needle in it.title.lowercase() }
                val characters = if (needle.isEmpty()) current.characters else current.characters.filter { needle in it.name.lowercase() }
                val groups = inboxGroups(sessions, now)
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize().testTag("chat-list")) {
                    characterSection(current, characters, selected, now, searching = needle.isNotEmpty())
                    when {
                        chats.isEmpty() -> item { EmptyState("No chats yet. Start one, and Dex will do the work.") }
                        groups.inbox.isEmpty() && needle.isEmpty() -> item { EmptyState("All caught up", Icons.Rounded.DoneAll) }
                        groups.isEmpty -> item { EmptyState("No chats match “$needle”.") }
                    }
                    rows(groups.inbox, current, now, selected, actions) { menu = it }
                    group(
                        "Snoozed", Icons.Rounded.Snooze, groups.snoozed, open = prefs.snoozedOpen || groups.snoozed.any { it.id == selected } || needle.isNotEmpty(),
                        onToggle = { app.graph.preferences.setSnoozedOpen(!prefs.snoozedOpen) },
                    ) { rows(groups.snoozed, current, now, selected, actions, snoozed = true) { menu = it } }
                    group(
                        "Settled", Icons.Rounded.DoneAll, groups.settled, open = prefs.settledOpen || groups.settled.any { it.id == selected } || needle.isNotEmpty(),
                        onToggle = { app.graph.preferences.setSettledOpen(!prefs.settledOpen) },
                    ) { rows(groups.settled, current, now, selected, actions, settled = true) { menu = it } }
                    item { Spacer(Modifier.size(96.dp)) }
                }
            }
        }
    }
    menu?.let { session -> ChatMenuSheet(session, actions, onDismiss = { menu = null }) }
}

private fun LazyListScope.group(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    sessions: List<SessionMeta>,
    open: Boolean,
    onToggle: () -> Unit,
    content: LazyListScope.() -> Unit,
) {
    if (sessions.isEmpty()) return
    item(key = "group-$label") {
        val rotation by animateFloatAsState(if (open) 0f else -90f, label = "chevron")
        ListItem(
            headlineContent = { Text(label, style = MaterialTheme.typography.labelLarge) },
            leadingContent = { Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp)) },
            trailingContent = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${sessions.size}", style = MaterialTheme.typography.labelMedium)
                    Icon(Icons.Rounded.ExpandMore, contentDescription = if (open) "Collapse" else "Expand", modifier = Modifier.rotate(rotation))
                }
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent, headlineColor = MaterialTheme.colorScheme.onSurfaceVariant),
            modifier = Modifier.clickableRow(onToggle).testTag("group-$label"),
        )
    }
    if (open) content()
}

private fun LazyListScope.rows(
    sessions: List<SessionMeta>,
    state: DexState,
    now: Long,
    selected: String?,
    actions: ChatActions,
    snoozed: Boolean = false,
    settled: Boolean = false,
    onMenu: (SessionMeta) -> Unit,
) {
    items(sessions, key = { it.id }) { session ->
        SwipeableChatRow(session, state, now, session.id == selected, actions, snoozed, settled, onMenu, Modifier.animateItem())
    }
}

/** A chat row: swipe right to settle (or back to the inbox), left to snooze, long-press for its menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SwipeableChatRow(
    session: SessionMeta,
    state: DexState,
    now: Long,
    selected: Boolean,
    actions: ChatActions,
    snoozed: Boolean,
    settled: Boolean,
    onMenu: (SessionMeta) -> Unit,
    modifier: Modifier,
) {
    val app = LocalApp.current
    val haptics = haptics()
    val swipe = rememberSwipeToDismissBoxState()
    var snoozeSheet by remember { mutableStateOf(false) }
    LaunchedEffect(swipe.currentValue) {
        when (swipe.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> {
                haptics.confirm()
                actions.settle(session, !settled)
                swipe.snapTo(SwipeToDismissBoxValue.Settled)
            }
            SwipeToDismissBoxValue.EndToStart -> {
                haptics.confirm()
                snoozeSheet = true
                swipe.snapTo(SwipeToDismissBoxValue.Settled)
            }
            SwipeToDismissBoxValue.Settled -> Unit
        }
    }
    SwipeToDismissBox(
        state = swipe,
        modifier = modifier,
        backgroundContent = {
            val toStart = swipe.dismissDirection == SwipeToDismissBoxValue.EndToStart
            // Nothing behind the row until it moves.
            if (swipe.dismissDirection == SwipeToDismissBoxValue.Settled) return@SwipeToDismissBox
            val colors = DexTheme.colors
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(28.dp)).background(if (toStart) colors.infoContainer else colors.successContainer).padding(horizontal = 24.dp),
                contentAlignment = if (toStart) Alignment.CenterEnd else Alignment.CenterStart,
            ) {
                Icon(
                    if (toStart) Icons.Outlined.Alarm else Icons.Rounded.DoneAll,
                    contentDescription = if (toStart) "Snooze" else if (settled) "Move to inbox" else "Settle",
                    tint = if (toStart) colors.onInfoContainer else colors.onSuccessContainer,
                )
            }
        },
    ) {
        ChatRow(
            session, state, now, selected, snoozed, settled,
            modifier = Modifier.combinedClickable(
                onClick = { app.navigator.open(Chat(session.id)) },
                onLongClick = {
                    haptics.longPress()
                    onMenu(session)
                },
                onLongClickLabel = "Chat options",
            ),
        )
    }
    if (snoozeSheet) SnoozeSheet(session, actions) { snoozeSheet = false }
}

@Composable
fun ChatRow(session: SessionMeta, state: DexState, now: Long, selected: Boolean, snoozed: Boolean, settled: Boolean, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val agent = state.agent(session.agentId)
    val project = state.project(session.projectId)
    val model = app.graph.models.find(session.model)?.name ?: session.model
    val naming = session.id in Naming.ids
    ListItem(
        modifier = modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(24.dp)).testTag("chat-${session.id}"),
        headlineContent = {
            Text(
                session.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = if (naming) Modifier.alpha(0.5f) else Modifier,
                color = if (settled) MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified,
            )
        },
        supportingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val label = when {
                    project != null -> project.name + (agent?.let { " · ${it.name}" } ?: "")
                    agent != null -> "${agent.name} · $model"
                    else -> model
                }
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (session.muted) Icon(Icons.Rounded.NotificationsOff, contentDescription = "Muted", modifier = Modifier.size(14.dp))
            }
        },
        leadingContent = {
            when {
                project != null -> AgentAvatar(project.icon, project.color, 40.dp, project.image)
                agent != null -> AgentAvatar(agent.icon, agent.color, 40.dp)
                else -> Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                    ModelLogo(session.model, app.graph.models, size = 22.dp)
                }
            }
        },
        trailingContent = {
            when {
                session.busy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusDot(DexTheme.colors.success, pulsing = true)
                    Text("working", style = MaterialTheme.typography.labelMedium, color = DexTheme.colors.success)
                }
                snoozed && session.snoozedUntil != null -> Text(Snooze.untilLabel(session.snoozedUntil!!, now), style = MaterialTheme.typography.labelMedium, color = DexTheme.colors.info)
                else -> Text(Format.timeAgo(session.updatedAt, now), style = MaterialTheme.typography.labelMedium)
            }
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface),
    )
}

@Composable
private fun SnoozeSheet(session: SessionMeta, actions: ChatActions, onDismiss: () -> Unit) {
    val sheet = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val now = System.currentTimeMillis()
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Text("Snooze “${session.title}” until", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        for (option in Snooze.options(now)) {
            ListItem(
                headlineContent = { Text(option.label) },
                trailingContent = { Text(Snooze.whenLabel(option.at, now)) },
                leadingContent = { Icon(Icons.Outlined.Alarm, contentDescription = null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickableRow {
                    actions.snooze(session, option.at)
                    onDismiss()
                },
            )
        }
        Spacer(Modifier.size(24.dp).width(1.dp))
    }
}
