package dev.trydex.android.ui.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalPip
import dev.trydex.android.ui.PipSource
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.machine.VmPreview
import dev.trydex.android.ui.nav.AgentEditor
import dev.trydex.android.ui.nav.ChatMachine
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.android.ui.ComposeRequests
import dev.trydex.android.ui.settings.AskForNotificationsOnce
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.SidekickNotify
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus

/** A chat: its transcript, live as the agent works, and the composer, queue, and pickers below it. */
@Composable
fun ChatScreen(id: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val model: ChatViewModel = viewModel(key = "chat-$id") { ChatViewModel(id, repository) }
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val transcript by model.transcript.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val confirm = rememberConfirm()
    val actions = rememberChatActions(snackbar, confirm)
    LaunchedEffect(model) { model.errors.collect { snackbar.showSnackbar(it) } }

    val session = state?.sessions?.firstOrNull { it.id == id }
    // A character's conversation: their face and name in the header, their greeting first, no inbox triage.
    val character = state?.character(session?.characterId)
    val vm = if (state?.vmConfigured == true) state?.vms?.firstOrNull { it.key == id } else null
    if (state != null && session == null) {
        Scaffold(topBar = { CompactTopBar(title = {}) }) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) { EmptyState("This chat no longer exists.") }
        }
        return
    }

    // A running VM can keep playing in Android's picture-in-picture window when you leave the app.
    val pip = LocalPip.current
    val pipSource = vm?.takeIf { it.status == VmStatus.Running }?.let { PipSource(it.key, session?.title ?: "VM desktop") }
    DisposableEffect(pipSource) {
        pipSource?.let(pip::offer)
        onDispose { pipSource?.let(pip::withdraw) }
    }

    var menu by remember { mutableStateOf(false) }
    var renaming by rememberSaveable { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    val composer = rememberTextFieldState()
    var draft by remember { mutableStateOf<Draft?>(null) }

    // On screen: presence tells the agent (it marks the chat read and skips notifying about it), and its notification
    // goes away. Marking it read here too is the backup for an agent that missed the presence.
    val context = androidx.compose.ui.platform.LocalContext.current
    DisposableEffect(id) {
        repository.setOnScreen(id, true)
        dev.trydex.android.notifications.Notifier.clear(context, id)
        onDispose { repository.setOnScreen(id, false) }
    }
    val unread = session?.unread == true
    LaunchedEffect(id, unread, connected) {
        if (unread && connected) {
            dev.trydex.android.notifications.Notifier.clear(context, id)
            runCatching { repository.api.markSessionRead(id) }
        }
    }
    // A widget's Message or a notification's Reply: the keyboard comes up, keeping what's typed.
    LaunchedEffect(id) {
        ComposeRequests.requests.collect { target ->
            if (target == id && ComposeRequests.take(id)) draft = Draft(composer.text.toString(), System.nanoTime())
        }
    }
    // The first sidekick you open is when the app asks whether it may notify you.
    AskForNotificationsOnce(character?.id)

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection).testTag("chat-screen"),
        topBar = {
            ChatTopBar(
                session = session,
                character = character,
                running = transcript.running,
                vm = vm,
                onRename = { renaming = true },
                onMenu = { menu = true },
                actions = actions,
                scroll = scroll,
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (transcript.loaded) {
                        MessageList(
                            sessionId = id,
                            transcript = transcript,
                            pending = pending,
                            onSend = model::send,
                            character = character,
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                        )
                    } else {
                        ChatSkeleton()
                    }
                }
                Column(
                    Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)).padding(horizontal = 12.dp).padding(bottom = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
                        if (session != null && state != null) ProviderWarning(session, state!!)
                        if (character != null && character.sessionId != id) EarlierConversationNote(character)
                        QueuePanel(transcript.queue, transcript.queueHeld, transcript.running, remember(id) { queueActions(id, app) })
                        Composer(
                            onSend = model::send,
                            onStop = model::stop,
                            running = transcript.running,
                            enabled = connected,
                            autoFocus = false,
                            draft = draft,
                            state = composer,
                            placeholder = if (transcript.running) "Queue a follow-up…" else "Message ${character?.name ?: "Dex"}, or / for skills…",
                            toolbar = {
                                if (session != null) {
                                    ModelPicker(session.model, session.thinking, onChange = { picked, thinking ->
                                        model.configure(picked, thinking)
                                    }, compact = app.panes > 1)
                                    McpPicker(state?.mcp.orEmpty(), session.mcpServers, onChange = { model.configureMcp(it) })
                                }
                            },
                        )
                    }
                }
            }
            if (vm != null && (vm.status == VmStatus.Running || vm.status == VmStatus.Starting)) {
                VmPreview(vm, session?.title ?: "VM desktop")
            }
        }
    }

    if (menu && session != null) ChatMenuSheet(session, actions, onDismiss = { menu = false }, showMute = true, character = character)
    if (renaming && session != null) RenameDialog(session, onDismiss = { renaming = false }) { title -> model.rename(title) }
}

private fun queueActions(sessionId: String, app: dev.trydex.android.ui.AppContext) = object : QueueActions {
    private val api get() = app.graph.repository.api
    override suspend fun move(id: String, index: Int) = api.moveQueued(sessionId, id, index)
    override suspend fun remove(id: String) = api.removeQueued(sessionId, id)
    override suspend fun edit(id: String, text: String) = api.editQueued(sessionId, id, text)
    override suspend fun steer(id: String) = api.steerQueued(sessionId, id)
}

/** The chat's provider isn't connected, so it can't answer: say so, with the way to fix it. */
@Composable
private fun ProviderWarning(session: SessionMeta, state: dev.trydex.core.model.DexState) {
    val app = LocalApp.current
    val provider = app.graph.models.providerOf(session.model)
    val connected = state.connectedProviders[provider] == true
    if (connected) return
    Surface(
        onClick = { app.navigator.open(GeneralSettings) },
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        color = DexTheme.colors.warningContainer,
        contentColor = DexTheme.colors.onWarningContainer,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("provider-warning"),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Connect ${provider.displayName} to get answers, or pick another model", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ChatTopBar(
    session: SessionMeta?,
    character: CharacterProfile?,
    running: Boolean,
    vm: VmInfo?,
    onRename: () -> Unit,
    onMenu: () -> Unit,
    actions: ChatActions,
    scroll: androidx.compose.material3.TopAppBarScrollBehavior,
) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val haptics = haptics()
    val agent = session?.agentId?.let { id -> state?.agents?.firstOrNull { it.id == id } }
    val project = session?.projectId?.let { id -> state?.projects?.firstOrNull { it.id == id } }
    val naming = session != null && session.id in Naming.ids
    // A phone-width pane keeps room for the title: the machine as an icon, mute in the menu.
    val window = androidx.compose.ui.platform.LocalWindowInfo.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    val narrow = with(density) { window.containerSize.width.toDp() } / maxOf(1, app.panes) < 600.dp
    CompactTopBar(
        scrollBehavior = scroll,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                project?.let {
                    IconButton(onClick = { app.navigator.open(ProjectEditor(it.id)) }, modifier = Modifier.size(32.dp)) {
                        AgentAvatar(it.icon, it.color, size = 28.dp, image = it.image, modifier = Modifier.semantics { contentDescription = "${it.name} project" })
                    }
                }
                agent?.let {
                    IconButton(onClick = { app.navigator.open(AgentEditor(it.id)) }, modifier = Modifier.size(32.dp)) {
                        AgentAvatar(it.icon, it.color, size = 28.dp, modifier = Modifier.semantics { contentDescription = "${it.name} agent" })
                    }
                }
                if (session == null) {
                    dev.trydex.android.ui.components.Bone(width = 176.dp, height = 18.dp)
                } else if (character != null) {
                    CharacterChatTitle(character, session, running)
                } else {
                    val pulse by rememberInfiniteTransition(label = "naming").animateFloat(1f, 0.4f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "pulse")
                    TextButton(onClick = onRename, modifier = Modifier.testTag("chat-title"), contentPadding = PaddingValues(horizontal = 4.dp)) {
                        Text(
                            session.title,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.alpha(if (naming) pulse else 1f).semantics { if (naming) contentDescription = "Writing a new title…" },
                        )
                    }
                }
            }
        },
        actions = {
            if (vm != null) {
                val starting = vm.settingUp || vm.status == VmStatus.Starting
                val dot = @Composable {
                    StatusDot(
                        when {
                            starting -> DexTheme.colors.warning
                            vm.running -> DexTheme.colors.success
                            else -> MaterialTheme.colorScheme.outline
                        },
                        pulsing = starting, size = 6.dp,
                    )
                }
                val describe = Modifier.testTag("vm-chip").semantics { contentDescription = "Watch or take over this chat's VM" }
                if (narrow) {
                    IconButton(onClick = { app.navigator.open(ChatMachine(vm.key)) }, modifier = describe) {
                        Box {
                            Icon(Icons.Outlined.Monitor, contentDescription = null)
                            Box(Modifier.align(Alignment.TopEnd)) { dot() }
                        }
                    }
                } else {
                    AssistChip(
                        onClick = { app.navigator.open(ChatMachine(vm.key)) },
                        label = { Text(if (vm.settingUp) "Setting up" else "Machine") },
                        leadingIcon = {
                            Box {
                                Icon(Icons.Outlined.Monitor, contentDescription = null, modifier = Modifier.size(AssistChipDefaults.IconSize))
                                Box(Modifier.align(Alignment.TopEnd)) { dot() }
                            }
                        },
                        modifier = Modifier.padding(end = 4.dp).then(describe),
                    )
                }
            }
            if (session != null && character != null) {
                // A sidekick's notifications: every message, or off (their page has "when they reach out" too).
                val notify = character.notifyLevel
                IconToggleButton(
                    checked = notify != SidekickNotify.Off,
                    onCheckedChange = { on -> haptics.toggle(on); actions.setNotify(character, if (on) SidekickNotify.All else SidekickNotify.Off) },
                    modifier = Modifier.testTag("character-notify"),
                ) {
                    Icon(
                        if (notify == SidekickNotify.Off) Icons.Outlined.NotificationsOff else Icons.Outlined.Notifications,
                        contentDescription = when (notify) {
                            SidekickNotify.Off -> "Notifications from ${character.name} are off. Tap to turn them on."
                            SidekickNotify.All -> "Notifying you of every message from ${character.name}. Tap to turn off."
                            SidekickNotify.Reachouts -> "Notifying you when ${character.name} reaches out. Tap to turn off."
                        },
                        tint = if (notify == SidekickNotify.Off) DexTheme.colors.warning else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (session != null && character == null && !narrow) {
                IconToggleButton(checked = session.muted, onCheckedChange = { haptics.toggle(it); actions.mute(session) }, modifier = Modifier.testTag("mute")) {
                    Icon(
                        if (session.muted) Icons.Outlined.NotificationsOff else Icons.Outlined.Notifications,
                        contentDescription = if (session.muted) "Notifications muted for this chat. Tap to unmute." else "Mute notifications for this chat",
                        tint = if (session.muted) DexTheme.colors.warning else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (session != null && character != null) {
                IconButton(onClick = { actions.restartCharacter(character) }, modifier = Modifier.testTag("character-start-over")) {
                    Icon(Icons.Rounded.RestartAlt, contentDescription = "Start a new conversation with ${character.name}", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (session != null && character == null) {
                val settled = session.settledAt != null
                IconToggleButton(checked = settled, onCheckedChange = { haptics.toggle(it); actions.settle(session, it) }, modifier = Modifier.testTag("settle")) {
                    Icon(
                        Icons.Rounded.DoneAll,
                        contentDescription = if (settled) "Settled. Tap to move it back to the inbox." else "Settle: done for now",
                        tint = if (settled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (session != null) {
                IconButton(onClick = onMenu, modifier = Modifier.testTag("chat-options")) { Icon(Icons.Rounded.MoreVert, contentDescription = "Chat options") }
            }
        },
    )
}

@Composable
private fun RenameDialog(session: SessionMeta, onDismiss: () -> Unit, onRename: (String) -> Unit) {
    val text = rememberTextFieldState(session.title)
    LaunchedEffect(Unit) { text.setTextAndPlaceCursorAtEnd(session.title) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename chat") },
        text = {
            OutlinedTextField(
                state = text,
                lineLimits = TextFieldLineLimits.SingleLine,
                modifier = Modifier.fillMaxWidth().testTag("rename-input"),
            )
        },
        confirmButton = {
            TextButton(onClick = {
                onRename(text.text.toString())
                onDismiss()
            }, modifier = Modifier.testTag("rename-save")) { Text("Rename") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** The chat's skeleton: a few message-shaped bones while its transcript loads. */
@Composable
fun ChatSkeleton() {
    Column(Modifier.fillMaxSize().padding(16.dp).testTag("chat-skeleton"), verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.Bottom)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            dev.trydex.android.ui.components.Bone(width = 200.dp, height = 40.dp)
        }
        BoneRows(4)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            dev.trydex.android.ui.components.Bone(width = 140.dp, height = 40.dp)
        }
        BoneRows(3)
    }
}
