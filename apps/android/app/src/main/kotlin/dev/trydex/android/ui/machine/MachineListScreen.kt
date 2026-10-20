package dev.trydex.android.ui.machine

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.ConfirmState
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Format
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus
import dev.trydex.core.model.Vms
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A VM status's dot colour (VM_STATUS). */
@Composable
fun vmStatusColor(status: VmStatus) = when (status) {
    VmStatus.Starting, VmStatus.Stopping -> DexTheme.colors.warning
    VmStatus.Running -> DexTheme.colors.success
    VmStatus.Error -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.outline
}

@Composable
fun VmStatusDot(status: VmStatus) {
    StatusDot(vmStatusColor(status), pulsing = status == VmStatus.Starting || status == VmStatus.Stopping, label = Vms.statusLabel(status))
}

/** `now`, ticking every [period] so relative times stay fresh. */
@Composable
fun rememberTicker(period: Long = 15_000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(period) {
        while (true) {
            delay(period)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/** Every VM: start, stop, delete leftovers, and set the defaults for new ones. */
@Composable
fun MachineListScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val now = rememberTicker()
    var refreshing by remember { mutableStateOf(false) }
    fun refresh() {
        val vms = state?.vms.orEmpty()
        refreshing = true
        scope.launch {
            vms.map { vm -> launch { runCatching { repository.api.vmRefresh(vm.key) } } }.forEach { it.join() }
            refreshing = false
        }
    }
    // Statuses may have changed while the page was closed (boat stops idle VMs).
    LaunchedEffect(connected, state == null) { if (connected && state != null) refresh() }
    val vms = state?.vms.orEmpty().sortedWith(Vms.byRecentUse)
    val running = vms.count { it.running }

    PaneScaffold(
        title = "Machines",
        back = false,
        subtitle = if (vms.isNotEmpty()) "$running running · ${vms.size} total" else null,
        actions = {
            InfoTip("Each chat gets its own VM the first time Dex needs one; project chats get theirs right away, with the repos cloned. A VM stops when idle, keeps its disk while stopped, and is deleted with its chat.", "About machines")
            val spin by rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(900)), label = "spin")
            IconButton(onClick = ::refresh, enabled = !refreshing) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Refresh", modifier = if (refreshing) Modifier.rotate(spin) else Modifier)
            }
        },
        modifier = Modifier.testTag("machines"),
    ) { padding ->
        PageColumn(padding, maxWidth = 896) {
            val current = state
            when {
                current == null -> BoneRows(6)
                !current.vmConfigured -> Text("No VM provider is configured. Set the BOAT_API_KEY secret to give Dex boat.dev cloud VMs.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> {
                    if (vms.isEmpty()) EmptyState("No VMs yet.", Icons.Outlined.Monitor)
                    BoxWithConstraints {
                        val columns = if (maxWidth >= 600.dp) 2 else 1
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            vms.chunked(columns).forEach { row ->
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    row.forEach { vm -> Box(Modifier.weight(1f)) { MachineCard(vm, now, confirm) } }
                                    if (row.size < columns) Box(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                    VmDefaults()
                }
            }
        }
    }
}

@Composable
private fun MachineCard(vm: VmInfo, now: Long, confirm: ConfirmState) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val current = state ?: return
    val label = Vms.label(current, vm.key)
    val badge = label.project?.let { Triple(it.icon, it.color, it.image) } ?: label.agent?.let { Triple(it.icon, it.color, null) }
    val session = current.sessions.firstOrNull { it.id == vm.key }
    val canStart = vm.status == VmStatus.Stopped || vm.status == VmStatus.Error || vm.status == VmStatus.None
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun act(name: String, block: suspend () -> Unit) {
        busy = name
        error = null
        scope.launch {
            runCatching { block() }.onFailure { error = it.message }
            busy = null
        }
    }
    ElevatedCard(onClick = { app.navigator.open(Machine(vm.key)) }, shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth().testTag("machine-${vm.key}")) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (badge != null) AgentAvatar(badge.first, badge.second, size = 40.dp, image = badge.third)
            else Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Monitor, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    label.subtitle ?: listOfNotNull(label.project?.name, label.agent?.name).joinToString(" · ").ifEmpty { "Chat" },
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    VmStatusDot(vm.status)
                    Text(Vms.statusLabel(vm.status), style = MaterialTheme.typography.bodySmall)
                    vm.size?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                    val detail = if (vm.running) Vms.idleText(vm, current.settings.vmMinutes, now) else vm.lastActiveAt?.let { "used ${Format.timeAgo(it, now)}" }
                    detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                SetupLine(vm)
            }
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (vm.running) ActionButton("Stop", Icons.Rounded.Stop, busy == "stop", busy == null) { act("stop") { app.graph.repository.api.vmStop(vm.key) } }
            if (canStart) ActionButton(if (vm.status == VmStatus.Stopped) "Resume" else "Start", Icons.Rounded.PlayArrow, busy == "start", busy == null) { act("start") { app.graph.repository.api.vmStart(vm.key) } }
            Box(Modifier.weight(1f))
            if (session == null) {
                ActionButton("Delete", Icons.Outlined.DeleteOutline, busy == "delete", busy == null, danger = true) {
                    confirm.ask("Delete “${label.title}”?", "Everything on its disk is deleted. This cannot be undone.") { act("delete") { app.graph.repository.api.vmDestroy(vm.key) } }
                }
            } else {
                ActionButton("Open chat", Icons.AutoMirrored.Outlined.Chat, false, true) { app.navigator.open(Chat(session.id)) }
            }
        }
        (error ?: vm.error)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) }
    }
}

/** Setting up (with its step), or where setup failed. */
@Composable
fun SetupLine(vm: VmInfo) {
    when (vm.setup.status) {
        "running" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = DexTheme.colors.info)
            Text("Setting up: ${vm.setup.step ?: "preparing"}", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.info, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        "error" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.Build, contentDescription = null, modifier = Modifier.size(12.dp), tint = DexTheme.colors.warning)
            Text("Setup failed" + (vm.setup.step?.let { " at $it" } ?: ""), style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun ActionButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, busy: Boolean, enabled: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.testTag("vm-$label")) {
        if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        else Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = if (danger) MaterialTheme.colorScheme.error else androidx.compose.material3.LocalContentColor.current)
        Text(label, modifier = Modifier.padding(start = 6.dp), color = if (danger) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
    }
}

/** Size and idle time for new VMs. */
@Composable
private fun VmDefaults() {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val settings = state?.settings ?: return
    val scope = rememberCoroutineScope()
    fun update(patch: kotlinx.serialization.json.JsonObject) = scope.launch { runCatching { app.graph.repository.api.updateSettings(patch) } }
    SectionCard(title = "VM defaults", info = "For new VMs. Projects can pick their own size.") {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Dropdown("Size", Vms.SIZES.firstOrNull { it.first == settings.vmSize }?.second ?: settings.vmSize, Vms.SIZES.map { it.second }) { index ->
                update(buildJsonObject { put("vmSize", Vms.SIZES[index].first) })
            }
            Dropdown("Stop when idle for", "${settings.vmMinutes} min", Vms.IDLE_MINUTES.map { "$it min" }) { index ->
                update(buildJsonObject { put("vmMinutes", Vms.IDLE_MINUTES[index]) })
            }
        }
    }
}

/** A read-only field that opens a menu of options. */
@Composable
fun Dropdown(label: String, value: String, options: List<String>, modifier: Modifier = Modifier, enabled: Boolean = true, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.exposedDropdownSize()) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(text = { Text(option) }, onClick = {
                    open = false
                    onPick(index)
                }, contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding)
            }
        }
    }
}
