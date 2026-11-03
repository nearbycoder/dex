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
import androidx.compose.material.icons.outlined.CalendarMonth
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
import androidx.compose.material3.FilterChipDefaults
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
import androidx.compose.runtime.compositionLocalOf
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import dev.trydex.core.model.ReleasedWithin
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.clampThinking
import dev.trydex.core.model.formatTokens
import dev.trydex.core.model.isNewModel
import dev.trydex.core.model.newestFirst
import dev.trydex.core.model.releaseLabel
import dev.trydex.core.model.supportedThinkingLevels
import kotlinx.coroutines.launch

/**
 * How far the composer's chips step down to fit its width (the composer raises it while they overflow): 1 drops the
 * provider badge and the vision eye, 2 counts MCP servers instead of naming them, 3 drops the model's chevron, 4
 * shortens thinking to its first letter, and 5 leaves the model as its logo, its name shortening along the way.
 * Labels for TalkBack stay whole.
 */
val LocalChipFit = compositionLocalOf { 0 }
const val CHIP_FIT_STEPS = 5

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
        // Neutral in every theme (the send button carries the accent); a highlighted one is outlined, darker text.
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = if (highlighted) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        border = if (highlighted) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
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
    val fit = LocalChipFit.current
    val label = listOfNotNull(
        "Model: ${current?.name ?: model}",
        current?.modelProvider?.displayName?.takeIf { both },
        "sees images".takeIf { current?.hasVision == true },
    ).joinToString(", ")
    ToolbarButton(onClick = { open = true }, modifier = Modifier.testTag("model-picker").semantics(mergeDescendants = true) { contentDescription = label }) {
        ModelLogo(model, registry, size = 16.dp)
        if (fit < 5) {
            val max = when (fit) {
                0, 1 -> if (compact) 120.dp else 180.dp
                2 -> 120.dp
                3 -> 96.dp
                else -> 64.dp
            }
            Text(current?.name ?: model, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = max))
        }
        if (both && current != null && fit < 1) {
            Text(current.modelProvider.short, style = MaterialTheme.typography.labelSmall, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 4.dp, vertical = 1.dp))
        }
        if (current?.hasVision == true && fit < 1) Icon(Icons.Outlined.Visibility, contentDescription = null, modifier = Modifier.size(16.dp))
        if (fit < 3) Icon(Icons.Rounded.ExpandMore, contentDescription = null, modifier = Modifier.size(16.dp))
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
        val fit = LocalChipFit.current
        ToolbarButton(onClick = { open = true }, modifier = Modifier.testTag("thinking-picker").semantics(mergeDescendants = true) { contentDescription = "Thinking level: ${thinking.id}" }) {
            Icon(Icons.Outlined.Psychology, contentDescription = null, modifier = Modifier.size(16.dp))
            // Narrow, the first letter says the level (o, m, l, h, x); the menu has the words.
            Text(if (fit >= 4) thinking.id.take(1).uppercase() else thinking.id, style = MaterialTheme.typography.labelLarge)
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

/**
 * The searchable model menu: All / ClinePass / OpenCode Go / ChatGPT / Command Code, with badges, grouped by
 * subscription; or, with Newest on (remembered on this device), every subscription's models by release date, newest
 * first, which a "released within" filter narrows.
 */
@Composable
private fun ModelSheet(selected: String, onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val registry = app.graph.models
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val query = rememberTextFieldState()
    var tab by remember { mutableStateOf<ModelProvider?>(null) }
    val newest = prefs.modelsNewest
    var within by remember { mutableStateOf(ReleasedWithin.AnyTime) }
    val now = remember { System.currentTimeMillis() }
    val connected = state?.connectedProviders ?: ModelProvider.entries.associateWith { true }
    val providers = ModelProvider.entries.sortedByDescending { connected[it] == true }
    val needle = query.text.toString().trim().lowercase()
    // Every word of the search must be in the name, maker, subscription, or badges ("free vision").
    val words = needle.split(Regex("\\s+")).filter { it.isNotEmpty() }
    fun matches(model: DexModel): Boolean {
        if (tab != null && model.modelProvider != tab) return false
        if (newest && !within.includes(model, now)) return false
        if (words.isEmpty()) return true
        val levels = supportedThinkingLevels(model)
        val badges = listOfNotNull(
            if (model.hasVision) "vision" else "text only",
            if (levels.isEmpty()) null else if (ThinkingLevel.Off in levels) "thinking optional" else "always thinks",
            "free".takeIf { model.free },
            "trains on data".takeIf { model.trainsOnData },
            "new".takeIf { isNewModel(model, now) },
        )
        val text = "${model.name} ${model.modelMaker?.displayName} ${model.modelProvider.displayName} ${badges.joinToString(" ")}".lowercase()
        return words.all { it in text }
    }
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("model-sheet")) {
        Column(Modifier.navigationBarsPadding()) {
            val freshChip = FilterChipDefaults.filterChipColors(
                selectedContainerColor = DexTheme.colors.freshContainer,
                selectedLabelColor = DexTheme.colors.onFreshContainer,
                selectedLeadingIconColor = DexTheme.colors.onFreshContainer,
            )
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    state = query,
                    placeholder = { Text("Search models") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    lineLimits = androidx.compose.foundation.text.input.TextFieldLineLimits.SingleLine,
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.weight(1f),
                )
                FilterChip(
                    selected = newest,
                    onClick = {
                        app.graph.preferences.setModelsNewest(!newest)
                        within = ReleasedWithin.AnyTime
                    },
                    label = { Text("Newest") },
                    leadingIcon = { Icon(Icons.Outlined.CalendarMonth, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) },
                    colors = freshChip,
                    modifier = Modifier.testTag("model-newest").semantics { contentDescription = if (newest) "Newest first, on" else "Newest first" },
                )
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = tab == null, onClick = { tab = null }, label = { Text("All ${registry.models.size}") })
                providers.forEach { provider ->
                    FilterChip(
                        selected = tab == provider,
                        onClick = { tab = provider },
                        label = { Text("${provider.displayName} ${registry.of(provider).size}") },
                        leadingIcon = if (connected[provider] != true) ({ StatusDot(MaterialTheme.colorScheme.outline, label = "Not connected") }) else null,
                        modifier = Modifier.testTag("model-tab-${provider.id}"),
                    )
                }
            }
            // While Newest is on: only what came out within some days.
            if (newest) {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReleasedWithin.entries.forEach { choice ->
                        FilterChip(
                            selected = within == choice,
                            onClick = { within = choice },
                            label = { Text(choice.label) },
                            colors = freshChip,
                            modifier = Modifier.testTag("model-within-${choice.days}"),
                        )
                    }
                }
            }
            LazyColumn(Modifier.heightIn(max = 520.dp)) {
                var any = false
                if (newest) for ((period, models) in newestFirst(registry.models.filter(::matches), connected, now)) {
                    any = true
                    stickyHeader(key = "period-${period.name}") {
                        Text(
                            period.label.uppercase(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 24.dp, vertical = 12.dp),
                        )
                    }
                    items(models, key = { it.id }) { model ->
                        val enabled = connected[model.modelProvider] == true || model.id == selected
                        ModelRow(model, model.id == selected, enabled, now, newest = true) { onSelect(model.id) }
                    }
                }
                if (!newest) for (provider in providers) {
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
                        ModelRow(model, model.id == selected, enabled, now, newest = false) { onSelect(model.id) }
                    }
                }
                // A subscription that lists models only once connected (Command Code: its plan decides them) has none yet.
                val unlisted = tab?.takeIf { connected[it] != true && registry.of(it).isEmpty() }
                if (!any && unlisted != null && needle.isEmpty()) item {
                    Column(Modifier.padding(24.dp).testTag("model-sheet-unlisted"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Connect ${unlisted.displayName} in Settings to see the models your plan covers.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = {
                            onDismiss()
                            app.navigator.open(GeneralSettings)
                        }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp)) { Text("Connect in Settings") }
                    }
                } else if (!any) item {
                    Text(
                        when {
                            needle.isNotEmpty() -> "No model matches “$needle”."
                            newest && within != ReleasedWithin.AnyTime -> "Nothing new in that time."
                            else -> "No models."
                        },
                        modifier = Modifier.padding(24.dp).testTag("model-sheet-empty"),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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

/**
 * A model in the menu: its name with when it came out at the end of the line, then its maker and badges. In the
 * Newest list the line also says which subscription it's on, and the maker is left to the logo.
 */
@Composable
private fun ModelRow(model: DexModel, selected: Boolean, enabled: Boolean, now: Long, newest: Boolean, onClick: () -> Unit) {
    val app = LocalApp.current
    val levels = supportedThinkingLevels(model)
    val released = releaseLabel(model, now)
    val meta = listOfNotNull(model.modelProvider.short.takeIf { newest }, released).joinToString(" · ")
    ListItem(
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(model.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (meta.isNotEmpty()) Text(
                    meta,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.semantics { contentDescription = listOfNotNull(model.modelProvider.displayName.takeIf { newest }, released?.let { "released $it" }).joinToString(", ") },
                )
            }
        },
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!newest) Text(model.modelMaker?.displayName ?: model.maker, style = MaterialTheme.typography.bodySmall)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (isNewModel(model, now)) Badge(null, "New", DexTheme.colors.onFreshContainer, DexTheme.colors.freshContainer)
                    if (model.hasVision) Badge(Icons.Outlined.Visibility, "Vision", MaterialTheme.colorScheme.primary) else Badge(Icons.Outlined.TextFields, "Text only", null)
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
private fun Badge(icon: androidx.compose.ui.graphics.vector.ImageVector?, text: String, tint: Color?, container: Color? = null) {
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(container ?: MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 6.dp, vertical = 2.dp),
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
        val fit = LocalChipFit.current
        Icon(
            Icons.Outlined.Extension,
            contentDescription = if (attached.isEmpty()) "MCP servers" else "MCP servers: ${attached.joinToString { it.name }}",
            modifier = Modifier.size(16.dp),
        )
        if (fit < 2 || attached.isNotEmpty()) Text(
            when {
                fit >= 2 -> "${attached.size}"
                attached.isEmpty() -> "MCP"
                attached.size == 1 -> attached.single().name
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
