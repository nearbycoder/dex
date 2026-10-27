package dev.trydex.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.McpList
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.DexModel
import dev.trydex.core.model.Format
import dev.trydex.core.model.McpServerInfo
import dev.trydex.core.model.McpStatus
import dev.trydex.core.model.ModelProvider
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.clampThinking
import dev.trydex.core.model.formatTokens
import dev.trydex.core.model.supportedThinkingLevels
import kotlinx.coroutines.launch

/** A small toolbar button in the composer. */
@Composable
fun ToolbarButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    content: @Composable () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = if (highlighted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = if (highlighted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.heightIn(min = 36.dp),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            content()
        }
    }
}

/** The model button and the thinking-level menu (ModelPicker on the web). */
@Composable
fun ModelPicker(model: String, thinking: ThinkingLevel, onChange: (String, ThinkingLevel) -> Unit, compact: Boolean = false) {
    val app = LocalApp.current
    val registry = app.graph.models
    val modelsVersion by app.graph.repository.modelsVersion.collectAsStateWithLifecycle()
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    @Suppress("UNUSED_VARIABLE") val redraw = modelsVersion
    val current = registry.find(model)
    var open by remember { mutableStateOf(false) }
    // With more than one subscription connected, the same model can come from several: say which.
    val both = (state?.connectedProviders?.values?.count { it } ?: 0) > 1
    ToolbarButton(onClick = { open = true }, modifier = Modifier.testTag("model-picker")) {
        ModelLogo(model, registry, size = 16.dp)
        Text(current?.name ?: model, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = if (compact) 120.dp else 180.dp))
        if (both && current != null) {
            Text(current.modelProvider.short, style = MaterialTheme.typography.labelSmall, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 4.dp, vertical = 1.dp))
        }
        if (current?.hasVision == true) Icon(Icons.Outlined.Visibility, contentDescription = "Can see images", modifier = Modifier.size(16.dp), tint = DexTheme.colors.success)
        Icon(Icons.Rounded.ExpandMore, contentDescription = null, modifier = Modifier.size(16.dp))
    }
    val levels = supportedThinkingLevels(current)
    if (levels.isNotEmpty()) ThinkingPicker(thinking, levels) { onChange(model, it) }
    if (open) ModelSheet(model, onDismiss = { open = false }) { picked ->
        open = false
        onChange(picked, clampThinking(registry.find(picked), thinking))
    }
}

@Composable
private fun ThinkingPicker(thinking: ThinkingLevel, levels: List<ThinkingLevel>, onChange: (ThinkingLevel) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ToolbarButton(onClick = { open = true }, modifier = Modifier.testTag("thinking-picker")) {
            Icon(Icons.Outlined.Psychology, contentDescription = "Thinking level", modifier = Modifier.size(16.dp))
            Text(thinking.id, style = MaterialTheme.typography.labelLarge)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text("Thinking level", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            levels.forEach { level ->
                DropdownMenuItem(
                    text = { Text(level.id) },
                    onClick = {
                        open = false
                        onChange(level)
                    },
                    trailingIcon = { if (level == thinking) Icon(Icons.Rounded.Check, contentDescription = "Selected") },
                )
            }
        }
    }
}

/** The searchable model menu: All / ClinePass / OpenCode Go / ChatGPT, with badges, grouped by subscription. */
@Composable
private fun ModelSheet(selected: String, onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val registry = app.graph.models
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val query = rememberTextFieldState()
    var tab by remember { mutableStateOf<ModelProvider?>(null) }
    val connected = state?.connectedProviders ?: ModelProvider.entries.associateWith { true }
    val providers = ModelProvider.entries.sortedByDescending { connected[it] == true }
    val needle = query.text.toString().trim().lowercase()
    fun matches(model: DexModel) = (tab == null || model.modelProvider == tab) &&
        (needle.isEmpty() || "${model.name} ${model.modelMaker?.displayName} ${model.modelProvider.displayName}".lowercase().contains(needle))
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("model-sheet")) {
        Column(Modifier.navigationBarsPadding()) {
            OutlinedTextField(
                state = query,
                placeholder = { Text("Search models") },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                lineLimits = androidx.compose.foundation.text.input.TextFieldLineLimits.SingleLine,
                shape = RoundedCornerShape(50),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = tab == null, onClick = { tab = null }, label = { Text("All ${registry.models.size}") })
                providers.forEach { provider ->
                    FilterChip(
                        selected = tab == provider,
                        onClick = { tab = provider },
                        label = { Text("${provider.displayName} ${registry.of(provider).size}") },
                        leadingIcon = if (connected[provider] != true) ({ StatusDot(MaterialTheme.colorScheme.outline, label = "Not connected") }) else null,
                    )
                }
            }
            LazyColumn(Modifier.heightIn(max = 520.dp)) {
                var any = false
                for (provider in providers) {
                    val models = registry.of(provider).filter(::matches)
                    if (models.isEmpty()) continue
                    any = true
                    stickyHeader(key = provider.id) {
                        Row(
                            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 24.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(provider.displayName.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            if (connected[provider] != true) {
                                TextButton(onClick = {
                                    onDismiss()
                                    app.navigator.open(GeneralSettings)
                                }) { Text("Connect in Settings") }
                            }
                        }
                    }
                    items(models, key = { it.id }) { model ->
                        val enabled = connected[provider] == true || model.id == selected
                        ModelRow(model, model.id == selected, enabled) { onSelect(model.id) }
                    }
                }
                if (!any) item {
                    Text(if (needle.isNotEmpty()) "No model matches “$needle”." else "No models.", modifier = Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp)) {
                Text("Text-only models can't see images or VM screenshots. Pick a Vision model for those.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val updatedAt = state?.models?.updatedAt ?: 0
                if (updatedAt > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("List checked with the providers ${Format.timeAgo(updatedAt)}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        IconButton(onClick = {
                            refreshing = true
                            scope.launch {
                                runCatching { app.graph.repository.api.refreshModelList() }
                                refreshing = false
                            }
                        }, enabled = !refreshing) {
                            if (refreshing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.Refresh, contentDescription = "Check for new and retired models now")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModelRow(model: DexModel, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val app = LocalApp.current
    val levels = supportedThinkingLevels(model)
    ListItem(
        headlineContent = { Text(model.name) },
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(model.modelMaker?.displayName ?: model.maker, style = MaterialTheme.typography.bodySmall)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (model.hasVision) Badge(Icons.Outlined.Visibility, "Vision", DexTheme.colors.success) else Badge(Icons.Outlined.TextFields, "Text only", null)
                    Badge(null, "${formatTokens(model.contextWindow)} context", null)
                    if (levels.isNotEmpty()) Badge(Icons.Outlined.Psychology, if (ThinkingLevel.Off in levels) "thinking optional" else "always thinks", null)
                    if (model.free) Badge(null, "Free", DexTheme.colors.info)
                    if (model.trainsOnData) Badge(null, "Trains on data", DexTheme.colors.warning)
                }
            }
        },
        leadingContent = { ModelLogo(model.id, app.graph.models, size = 24.dp) },
        trailingContent = { if (selected) Icon(Icons.Rounded.Check, contentDescription = "Selected", tint = MaterialTheme.colorScheme.primary) },
        colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent),
        modifier = Modifier.then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 8.dp).clip(RoundedCornerShape(16.dp))
            .then(if (!enabled) Modifier.background(Color.Transparent) else Modifier).testTag("model-${model.id}"),
    )
}

@Composable
private fun Badge(icon: androidx.compose.ui.graphics.vector.ImageVector?, text: String, tint: Color?) {
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(12.dp), tint = tint ?: MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.labelSmall, color = tint ?: MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

fun mcpStatusColor(status: McpStatus, colors: dev.trydex.android.ui.theme.DexColors, scheme: androidx.compose.material3.ColorScheme) = when (status) {
    McpStatus.Ready -> colors.success
    McpStatus.Authenticating -> colors.warning
    McpStatus.Failed -> scheme.error
    McpStatus.Disconnected -> scheme.outline
    else -> colors.warning
}

/** The chat's MCP servers (McpPicker on the web): a checkbox sheet that stays open while you pick. */
@Composable
fun McpPicker(servers: List<McpServerInfo>, selected: List<String>, onChange: (List<String>) -> Unit) {
    val app = LocalApp.current
    var open by remember { mutableStateOf(false) }
    val attached = servers.filter { it.id in selected }
    val attention = attached.any { it.status.needsAttention }
    val haptics = haptics()
    ToolbarButton(onClick = { open = true }, highlighted = attached.isNotEmpty(), modifier = Modifier.testTag("mcp-picker")) {
        Icon(Icons.Outlined.Extension, contentDescription = if (attached.isEmpty()) "MCP servers" else "MCP servers: ${attached.size}", modifier = Modifier.size(16.dp))
        Text(
            when (attached.size) {
                0 -> "MCP"
                1 -> attached.single().name
                else -> "${attached.size} MCP"
            },
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 100.dp),
        )
        if (attention) StatusDot(DexTheme.colors.warning)
    }
    if (open) {
        val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { open = false }, sheetState = sheet) {
            Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) {
                Text("MCP servers for this chat", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                if (servers.isEmpty()) {
                    Text("No MCP servers yet. Connect one to give Dex its tools.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                }
                servers.forEach { server ->
                    val checked = server.id in selected
                    ListItem(
                        headlineContent = { Text(server.name) },
                        supportingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusDot(mcpStatusColor(server.status, DexTheme.colors, MaterialTheme.colorScheme), pulsing = server.status.pending, label = server.status.label)
                                Text(if (server.status == McpStatus.Ready) "${server.tools.size} tools" else server.status.label)
                            }
                        },
                        leadingContent = { Checkbox(checked = checked, onCheckedChange = null) },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.clickable {
                            haptics.toggle(!checked)
                            onChange(if (checked) selected - server.id else selected + server.id)
                        },
                    )
                }
                TextButton(onClick = {
                    open = false
                    app.navigator.open(McpList)
                }, modifier = Modifier.padding(horizontal = 12.dp)) {
                    Icon(Icons.Rounded.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Manage MCP servers", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}
