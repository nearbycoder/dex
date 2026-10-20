package dev.trydex.android.ui.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddComment
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.chat.ModelPicker
import dev.trydex.android.ui.chat.mcpStatusColor
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.AgentEditor
import dev.trydex.android.ui.nav.AgentList
import dev.trydex.android.ui.nav.McpEditor
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.Tab
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.client.DexApi
import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.DexState
import kotlinx.coroutines.launch

private const val NEW = "new"

private fun blankAgent(state: DexState) = AgentProfile(
    id = "", icon = "bot", color = "emerald", model = state.settings.defaultModel, thinking = state.settings.defaultThinking,
)

/** Agents just created, until the synced state has them. */
private val createdAgents = mutableMapOf<String, AgentProfile>()

private fun AgentProfile.comparable() = copy(createdAt = 0, updatedAt = 0)

/** Every agent as a card: its model, thinking level, and chats, with Start chat and Edit. */
@Composable
fun AgentListScreen() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val selected = (app.navigator.stack(Tab.Library).getOrNull(2) as? AgentEditor)?.id
    PaneScaffold(
        title = "Agents",
        actions = { InfoTip("Presets for a job: instructions, a model, a thinking level, and MCP servers. Pick one when starting a chat.", "About agents") },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { app.navigator.open(AgentEditor(NEW)) },
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text("New agent") },
                modifier = Modifier.testTag("agent-new"),
            )
        },
        modifier = Modifier.testTag("agent-list"),
    ) { padding ->
        PageColumn(padding) {
            val current = state
            when {
                current == null -> BoneRows(4)
                current.agents.isEmpty() -> EmptyState("No agents yet.", Icons.Rounded.SmartToy, modifier = Modifier.testTag("agent-empty"))
                else -> ProfileGrid(current.agents) { agent ->
                    AgentCard(agent, current.sessions.count { it.agentId == agent.id }, agent.id == selected)
                }
            }
            Box(Modifier.heightIn(min = 56.dp))
        }
    }
}

@Composable
private fun AgentCard(agent: AgentProfile, chats: Int, selected: Boolean) {
    val app = LocalApp.current
    val scheme = MaterialTheme.colorScheme
    val models = app.graph.models
    OutlinedCard(
        onClick = { app.navigator.open(AgentEditor(agent.id)) },
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant),
        colors = CardDefaults.outlinedCardColors(containerColor = if (selected) scheme.secondaryContainer.copy(alpha = 0.5f) else scheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().testTag("agent-row-${agent.id}"),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                AgentAvatar(agent.icon, agent.color, size = 40.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(agent.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(agent.description.ifEmpty { "Custom agent" }, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ModelLogo(agent.model, models, size = 14.dp)
                    MetaText(models.find(agent.model)?.name ?: agent.model, Modifier.widthIn(max = 200.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Outlined.Psychology, contentDescription = null, modifier = Modifier.size(14.dp), tint = scheme.outline)
                    MetaText("thinking ${agent.thinking.id}")
                }
                MetaText("$chats chat${if (chats == 1) "" else "s"}")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = { app.navigator.open(NewChat(agentId = agent.id, nonce = System.nanoTime())) },
                    modifier = Modifier.weight(1f).testTag("agent-start-${agent.id}"),
                ) {
                    Icon(Icons.Rounded.AddComment, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Start chat", modifier = Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { app.navigator.open(AgentEditor(agent.id)) }) {
                    Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Edit", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

/** An agent's editor; [id] is "new" for an agent that doesn't exist yet. */
@Composable
fun AgentEditorScreen(id: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val haptics = haptics()
    val isNew = id == NEW

    var edited by rememberSaveable(id, stateSaver = draftSaver(AgentProfile.serializer())) { mutableStateOf<AgentProfile?>(null) }
    var saved by rememberSaveable(id) { mutableStateOf(id in createdAgents) }
    var saving by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }

    val current = state
    val existing = current?.agent(id) ?: createdAgents[id]
    LaunchedEffect(current?.agent(id)) { if (current?.agent(id) != null) createdAgents.remove(id) }
    val base = when {
        current == null -> null
        isNew -> blankAgent(current)
        else -> existing
    }
    val draft = edited ?: base
    val dirty = edited != null && (base == null || edited!!.comparable() != base.comparable())

    fun update(change: (AgentProfile) -> AgentProfile) {
        val from = draft ?: return
        edited = change(from)
        saved = false
    }

    fun save() {
        val value = draft ?: return
        if (saving || value.name.isBlank()) return
        saving = true
        error = null
        scope.launch {
            attempt { repository.api.saveAgent(DexApi.agentDraft(value)) }
                .onSuccess { result ->
                    haptics.confirm()
                    if (isNew) {
                        createdAgents[result.id] = result
                        app.navigator.replace(AgentEditor(result.id))
                    } else {
                        edited = result
                        saved = true
                    }
                }
                .onFailure {
                    haptics.reject()
                    error = it.message ?: "Couldn't save the agent."
                }
            saving = false
        }
    }

    PaneScaffold(
        title = draft?.name?.takeIf { it.isNotBlank() } ?: if (isNew) "New agent" else "Untitled",
        subtitle = draft?.description?.takeIf { it.isNotBlank() } ?: "Describe what this agent is for",
        modifier = Modifier.testTag("agent-editor"),
        bottomBar = {
            if (draft != null) {
                ProfileSaveBar(
                    label = when {
                        isNew -> "Create agent"
                        saved && !dirty -> "Saved"
                        else -> "Save"
                    },
                    enabled = !saving && draft.name.isNotBlank() && (isNew || dirty),
                    saving = saving,
                    saved = saved && !dirty && !isNew,
                    saveTag = "agent-save",
                    onSave = ::save,
                    onStartChat = if (isNew) null else ({ app.navigator.open(NewChat(agentId = id, nonce = System.nanoTime())) }),
                    onDelete = if (isNew) null else ({
                        confirm.ask("Delete “${draft.name}”?", "Its chats stay, as plain chats.") {
                            scope.launch {
                                attempt { repository.api.deleteAgent(id) }
                                    .onSuccess {
                                        createdAgents.remove(id)
                                        app.navigator.close(AgentEditor(id))
                                    }
                                    .onFailure { error = it.message ?: "Couldn't delete the agent." }
                            }
                        }
                    }),
                )
            }
        },
    ) { padding ->
        PageColumn(padding, Modifier.consumeWindowInsets(padding).imePadding()) {
            when {
                current == null -> BoneRows(6)
                draft == null -> ProfileMissing("This agent no longer exists.", "Back to agents") { app.navigator.open(AgentList) }
                else -> AgentForm(draft, current, ::update)
            }
            error?.let { ErrorText(it, Modifier.testTag("agent-error")) }
        }
    }
}

@Composable
private fun AgentForm(draft: AgentProfile, state: DexState, onChange: ((AgentProfile) -> AgentProfile) -> Unit) {
    val app = LocalApp.current
    val haptics = haptics()
    SectionCard {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            AgentAvatar(draft.icon, draft.color, size = 56.dp)
            OutlinedTextField(
                value = draft.name,
                onValueChange = { v -> onChange { it.copy(name = v.take(60)) } },
                label = { Text("Name") },
                placeholder = { Text("PR Reviewer") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.weight(1f).testTag("agent-name"),
            )
        }
        OutlinedTextField(
            value = draft.description,
            onValueChange = { v -> onChange { it.copy(description = v.take(200)) } },
            label = { Text("Description") },
            placeholder = { Text("Reviews pull requests for bugs") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().testTag("agent-description"),
        )
    }

    SectionCard {
        ProfileField("Icon") { ProfileIconGrid(draft.icon) { key -> onChange { it.copy(icon = key) } } }
        ProfileField("Color") { ProfileColorPicker(draft.color) { key -> onChange { it.copy(color = key) } } }
    }

    SectionCard {
        ProfileField("Model and thinking", "New chats with this agent start with these; you can still change them per chat.") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ModelPicker(draft.model, draft.thinking, onChange = { model, thinking -> onChange { it.copy(model = model, thinking = thinking) } })
            }
        }
        ProfileField("MCP servers", "Attached to new chats with this agent; you can still change them per chat.") {
            if (state.mcp.isEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("No MCP servers yet. ", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { app.navigator.open(McpEditor("new")) }) { Text("Connect one") }
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.mcp.forEach { server ->
                        val on = server.id in draft.mcpServers
                        FilterChip(
                            selected = on,
                            onClick = {
                                haptics.toggle(!on)
                                onChange { a -> a.copy(mcpServers = if (on) a.mcpServers - server.id else a.mcpServers + server.id) }
                            },
                            label = {
                                Text(server.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
                                Box(Modifier.padding(start = 6.dp)) {
                                    StatusDot(mcpStatusColor(server.status, DexTheme.colors, MaterialTheme.colorScheme), pulsing = server.status.pending, label = server.status.label)
                                }
                            },
                            leadingIcon = {
                                Icon(if (on) Icons.Rounded.Check else Icons.Rounded.Extension, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize))
                            },
                            modifier = Modifier.heightIn(min = 40.dp).testTag("agent-mcp-${server.id}"),
                        )
                    }
                }
            }
        }
    }

    SectionCard {
        ProfileField("Instructions", "The agent's role and workflow, added to the system prompt of its chats. Edits apply to existing chats too.") {
            OutlinedTextField(
                value = draft.instructions,
                onValueChange = { v -> onChange { it.copy(instructions = v.take(20_000)) } },
                placeholder = { Text("You review pull requests like a careful senior engineer.\n1. …", style = MonoStyle) },
                textStyle = MonoStyle,
                minLines = 10,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Instructions" }.testTag("agent-instructions"),
            )
        }
        ProfileField("Starter prompt", "Prefilled in the message box when you pick this agent.") {
            OutlinedTextField(
                value = draft.starter,
                onValueChange = { v -> onChange { it.copy(starter = v.take(2_000)) } },
                placeholder = { Text("Review https://github.com/OWNER/REPO/pull/") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Starter prompt" }.testTag("agent-starter"),
            )
        }
    }
}
