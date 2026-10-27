package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.AgentEditor
import dev.trydex.android.ui.nav.AgentList
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.nav.ProjectList
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.DexState
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.clampThinking
import kotlinx.coroutines.launch

private fun connected(state: DexState) = state.connectedProviders

/** "New" in the agent catalog: a fresh agent or project. */
private const val NEW = "new"

/**
 * A new chat: pick an agent and a project (or neither), a model and MCP servers, and write the first message. The
 * chat is made when you send it.
 */
@Composable
fun NewChatScreen(route: NewChat) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val registry = app.graph.models
    val state by repository.state.collectAsStateWithLifecycle()
    val connectedNow by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val haptics = haptics()

    var model by rememberSaveable(route.nonce) { mutableStateOf(dev.trydex.core.model.DEFAULT_MODEL_ID) }
    var thinking by rememberSaveable(route.nonce) { mutableStateOf(ThinkingLevel.Low) }
    var agentId by rememberSaveable(route.nonce) { mutableStateOf<String?>(null) }
    var projectId by rememberSaveable(route.nonce) { mutableStateOf<String?>(null) }
    var mcpChoice by rememberSaveable(route.nonce) { mutableStateOf<List<String>?>(null) }
    var draft by remember(route.nonce) { mutableStateOf<Draft?>(null) }
    var error by remember(route.nonce) { mutableStateOf<String?>(null) }
    var starting by remember(route.nonce) { mutableStateOf(false) }

    val current = state
    val agents = current?.agents.orEmpty()
    val projects = current?.projects.orEmpty()
    val agent = agents.firstOrNull { it.id == agentId }
    val project = projects.firstOrNull { it.id == projectId }
    val mcp = mcpChoice ?: current?.mcp.orEmpty().filter { it.defaultOn }.map { it.id }

    // With no agent, the model follows Settings.
    LaunchedEffect(current?.settings?.defaultModel, current?.settings?.defaultThinking, current?.cline?.connected, current?.opencode?.connected, current?.chatgpt?.connected, agentId) {
        val s = current ?: return@LaunchedEffect
        if (agentId == null) {
            model = registry.usableModel(s.settings.defaultModel, connected(s))
            thinking = s.settings.defaultThinking
        }
    }

    fun pick(next: AgentProfile?) {
        val s = current ?: return
        haptics.tap()
        if (next == null || next.id == agentId) {
            agentId = null
            mcpChoice = null
            model = registry.usableModel(s.settings.defaultModel, connected(s))
            thinking = s.settings.defaultThinking
            return
        }
        agentId = next.id
        mcpChoice = next.mcpServers
        model = registry.usableModel(next.model, connected(s))
        thinking = clampThinking(registry.find(model), next.thinking)
        draft = Draft(next.starter, System.nanoTime())
    }

    fun pickProject(next: ProjectProfile?) {
        haptics.tap()
        if (next == null || next.id == projectId) {
            projectId = null
            return
        }
        projectId = next.id
        if (next.starter.isNotEmpty() && agent?.starter.isNullOrEmpty()) draft = Draft(next.starter, System.nanoTime())
    }

    // Preselections from links (?agent=, ?project=), applied once the state has them.
    LaunchedEffect(route.agentId, agents.size) {
        val wanted = route.agentId ?: return@LaunchedEffect
        if (agentId != wanted) agents.firstOrNull { it.id == wanted }?.let(::pick)
    }
    LaunchedEffect(route.projectId, projects.size) {
        val wanted = route.projectId ?: return@LaunchedEffect
        if (projectId != wanted) projects.firstOrNull { it.id == wanted }?.let(::pickProject)
    }

    fun start(text: String, attachments: List<dev.trydex.core.model.ChatAttachment>) {
        if (starting) return
        error = null
        starting = true
        scope.launch {
            runCatching {
                val session = repository.api.createSession(model, thinking, agentId, mcp, projectId)
                repository.api.sendMessage(session.id, text, attachments)
                session
            }.onSuccess { session ->
                app.navigator.replace(Chat(session.id))
            }.onFailure {
                error = it.message ?: "Couldn't start the chat."
            }
            starting = false
        }
    }

    Scaffold(
        topBar = { CompactTopBar(title = { Text("New chat") }) },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal),
        modifier = Modifier.testTag("new-chat-screen"),
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val wide = maxWidth >= 560.dp
                val short = LocalWindowInfo.current.containerSize.height < 1000
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Bottom,
                ) {
                    Spacer(Modifier.weight(1f))
                    Column(Modifier.widthIn(max = 672.dp).fillMaxWidth().padding(top = 24.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        Text(
                            when {
                                agent != null && project != null -> "What should ${agent.name} do in ${project.name}?"
                                agent != null -> "What should ${agent.name} do?"
                                project != null -> "What should Dex do in ${project.name}?"
                                else -> "What should Dex do?"
                            },
                            style = if (short) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.headlineMedium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().semantics { heading() }.testTag("new-chat-headline"),
                        )
                        if (current != null && !current.anyProviderConnected) {
                            Surface(
                                onClick = { app.navigator.open(GeneralSettings) },
                                shape = RoundedCornerShape(20.dp),
                                color = DexTheme.colors.warningContainer,
                                contentColor = DexTheme.colors.onWarningContainer,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.Key, contentDescription = null)
                                    Text("Connect ClinePass, OpenCode Go, or ChatGPT in Settings so Dex can think.", style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                        if (current == null) {
                            BoneRows(4)
                        } else {
                            if (projects.isNotEmpty()) {
                                Section("Projects", onManage = { app.navigator.open(ProjectList) }) {
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        projects.forEach { p ->
                                            FilterChip(
                                                selected = p.id == projectId,
                                                onClick = { pickProject(p) },
                                                label = {
                                                    Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
                                                    Text(" ${p.repos.size} ${if (p.repos.size == 1) "repo" else "repos"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                },
                                                leadingIcon = { AgentAvatar(p.icon, p.color, size = 22.dp, image = p.image) },
                                                modifier = Modifier.heightIn(min = 40.dp).testTag("project-${p.id}"),
                                            )
                                        }
                                        FilterChip(
                                            selected = false,
                                            onClick = { app.navigator.open(ProjectEditor(NEW)) },
                                            label = { Text("New project") },
                                            leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) },
                                            modifier = Modifier.heightIn(min = 40.dp),
                                        )
                                    }
                                }
                            }
                            Section("Agents", onManage = { app.navigator.open(AgentList) }) {
                                val columns = if (wide) 3 else 2
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    (agents.map<AgentProfile, AgentProfile?> { it } + listOf(null)).chunked(columns).forEachIndexed { row, chunk ->
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            chunk.forEachIndexed { column, item ->
                                                val index = row * columns + column
                                                var shown by remember { mutableStateOf(false) }
                                                LaunchedEffect(Unit) { shown = true }
                                                Box(Modifier.weight(1f)) {
                                                    androidx.compose.animation.AnimatedVisibility(shown, enter = fadeIn(tween(220, delayMillis = minOf(index, 12) * 35)) + slideInVertically(tween(220, delayMillis = minOf(index, 12) * 35)) { it / 4 }) {
                                                        if (item == null) NewAgentCard() else AgentCard(item, item.id == agentId) { pick(item) }
                                                    }
                                                }
                                            }
                                            repeat(columns - chunk.size) { Spacer(Modifier.weight(1f)) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)).padding(horizontal = 12.dp).padding(bottom = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.widthIn(max = 672.dp).fillMaxWidth()) {
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp, start = 8.dp).testTag("new-chat-error")) }
                    Composer(
                        onSend = ::start,
                        enabled = connectedNow && !starting,
                        autoFocus = true,
                        draft = draft,
                        placeholder = agent?.let { "Ask ${it.name}…" } ?: "Ask Dex to do anything…",
                        header = if (agent == null && project == null) null else ({
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                project?.let { p ->
                                    InputChip(
                                        selected = false, onClick = {},
                                        label = { Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        avatar = { AgentAvatar(p.icon, p.color, size = 20.dp, image = p.image) },
                                        trailingIcon = { Icon(Icons.Rounded.Close, contentDescription = "No project", modifier = Modifier.size(InputChipDefaults.IconSize).clickable { pickProject(null) }) },
                                    )
                                }
                                agent?.let { a ->
                                    InputChip(
                                        selected = false, onClick = {},
                                        label = { Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        avatar = { AgentAvatar(a.icon, a.color, size = 20.dp) },
                                        trailingIcon = { Icon(Icons.Rounded.Close, contentDescription = "Use no agent", modifier = Modifier.size(InputChipDefaults.IconSize).clickable { pick(null) }) },
                                    )
                                }
                            }
                        }),
                        toolbar = {
                            ModelPicker(model, thinking, onChange = { m, t -> model = m; thinking = t })
                            McpPicker(current?.mcp.orEmpty(), mcp, onChange = { mcpChoice = it })
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, onManage: () -> Unit, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            TextButton(onClick = onManage) {
                Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Manage", modifier = Modifier.padding(start = 6.dp))
            }
        }
        content()
    }
}

@Composable
private fun AgentCard(agent: AgentProfile, selected: Boolean, onClick: () -> Unit) {
    val app = LocalApp.current
    OutlinedCard(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
        colors = androidx.compose.material3.CardDefaults.outlinedCardColors(containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f) else MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp).testTag("agent-${agent.id}"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AgentAvatar(agent.icon, agent.color, size = 32.dp)
            Text(agent.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(agent.description.ifEmpty { "Custom agent" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                ModelLogo(agent.model, app.graph.models, size = 12.dp)
                Text(app.graph.models.find(agent.model)?.name ?: agent.model, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun NewAgentCard() {
    val app = LocalApp.current
    OutlinedCard(
        onClick = { app.navigator.open(AgentEditor(NEW)) },
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.size(32.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, contentDescription = null) }
            }
            Text("New agent", style = MaterialTheme.typography.titleSmall)
        }
    }
}
