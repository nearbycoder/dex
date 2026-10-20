package dev.trydex.android.ui.machine

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalInPip
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.LocalPip
import dev.trydex.android.ui.PipSource
import dev.trydex.android.ui.components.AgentAvatar
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.components.rememberConfirm
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.MachineList
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Format
import dev.trydex.core.model.ServerMessage
import dev.trydex.core.model.VmActivity
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus
import dev.trydex.core.model.Vms
import kotlinx.coroutines.launch

private const val MAX_OUTPUT = 64_000

/** A VM's activity log, live: commands Dex and you run, their output as it streams, and lifecycle events. */
@Composable
fun rememberVmActivity(key: String): List<VmActivity>? {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val items = remember(key) { mutableStateListOf<VmActivity>() }
    var loaded by remember(key) { mutableStateOf(false) }
    LaunchedEffect(key, connected) {
        if (!connected) return@LaunchedEffect
        runCatching { repository.api.vmActivity(key, 150) }.onSuccess {
            items.clear()
            items.addAll(it)
            loaded = true
        }
    }
    LaunchedEffect(key) {
        repository.messages.collect { message ->
            when (message) {
                is ServerMessage.VmActivityUpdate -> if (message.vmKey == key) {
                    val index = items.indexOfFirst { it.id == message.activity.id }
                    if (index == -1) {
                        items.add(message.activity)
                        while (items.size > 300) items.removeAt(0)
                    } else items[index] = message.activity
                }
                is ServerMessage.VmOutput -> if (message.vmKey == key) {
                    val index = items.indexOfFirst { it.id == message.id }
                    if (index != -1) items[index] = items[index].let { it.copy(output = (it.output + message.data).takeLast(MAX_OUTPUT)) }
                }
                else -> Unit
            }
        }
    }
    return if (loaded) items else null
}

/**
 * One VM: its live desktop (watch, or take control), what's running on it, a command line, and ports to open. Wide
 * windows put the desktop and the log side by side; a half-folded phone (tabletop) keeps the desktop above the fold.
 */
@Composable
fun MachineScreen(key: String, beside: Boolean = false) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val confirm = rememberConfirm()
    val now = rememberTicker()
    val current = state
    val known = current != null && (current.vms.any { it.key == key } || current.sessions.any { it.id == key })
    val vm = if (known) current!!.vms.firstOrNull { it.key == key } ?: VmInfo(key) else null
    val label = current?.let { Vms.label(it, key) }

    var busy by remember(key) { mutableStateOf<String?>(null) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var portUrl by remember(key) { mutableStateOf<String?>(null) }
    fun act(name: String, block: suspend () -> Unit) {
        busy = name
        error = null
        scope.launch {
            runCatching { block() }.onFailure { error = it.message }
            busy = null
        }
    }
    LaunchedEffect(key, connected) {
        portUrl = null
        error = null
        if (connected && current?.vms?.any { it.key == key } == true) runCatching { repository.api.vmRefresh(key) }
    }

    // The desktop can keep playing in picture-in-picture when you leave the app.
    val pip = LocalPip.current
    val pipSource = vm?.takeIf { it.running }?.let { PipSource(it.key, label?.title ?: "VM desktop") }
    androidx.compose.runtime.DisposableEffect(pipSource) {
        pipSource?.let(pip::offer)
        onDispose { pipSource?.let(pip::withdraw) }
    }

    Scaffold(
        topBar = {
            CompactTopBar(
                title = {
                    Column {
                        Text(label?.title ?: "Machine", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        if (vm != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            VmStatusDot(vm.status)
                            Text(
                                listOfNotNull(Vms.statusLabel(vm.status), vm.size, if (vm.running) Vms.idleText(vm, current!!.settings.vmMinutes, now) else null).joinToString(" · "),
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                actions = {
                    if (vm != null) {
                        val canStart = vm.status == VmStatus.None || vm.status == VmStatus.Stopped || vm.status == VmStatus.Error
                        if (canStart) IconButton(onClick = { act("start") { repository.api.vmStart(key) } }, enabled = busy == null, modifier = Modifier.testTag("vm-start")) {
                            if (busy == "start") CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.PlayArrow, contentDescription = if (vm.status == VmStatus.Stopped) "Resume" else "Start")
                        }
                        if (vm.running) IconButton(onClick = { act("stop") { repository.api.vmStop(key) } }, enabled = busy == null, modifier = Modifier.testTag("vm-stop")) {
                            if (busy == "stop") CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.Stop, contentDescription = "Stop")
                        }
                        if (vm.id != null) IconButton(onClick = {
                            confirm.ask("Delete the VM of “${label?.title}”?", "Everything on its disk is deleted. This cannot be undone.") { act("delete") { repository.api.vmDestroy(key) } }
                        }, enabled = busy == null) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete the VM and its disk") }
                        IconButton(onClick = { act("refresh") { repository.api.vmRefresh(key) } }, modifier = Modifier.testTag("vm-refresh")) {
                            Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
                        }
                    }
                },
            )
        },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        modifier = Modifier.testTag("machine-screen"),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                current == null -> Column(Modifier.padding(16.dp)) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16 / 9f).clip(RoundedCornerShape(20.dp)).background(Color.Black))
                    BoneRows(8, Modifier.padding(top = 16.dp))
                }
                !current.vmConfigured -> EmptyState("No VM provider is configured. Set the BOAT_API_KEY secret to give Dex boat.dev cloud VMs.")
                vm == null -> EmptyState("This VM no longer exists.", Icons.Outlined.Monitor) {
                    TextButton(onClick = { app.navigator.open(MachineList) }) { Text("See all machines") }
                }
                else -> {
                    val mode = DesktopMode.saved(prefs.desktopMode)
                    val desktop = rememberDesktopUrl(key, mode, vm.running)
                    val activity = rememberVmActivity(key)
                    val posture = currentWindowAdaptiveInfo().windowPosture
                    val tabletop = posture.isTabletop
                    val hinge = posture.hingeList.firstOrNull()?.bounds
                    val header: @Composable ColumnScope.() -> Unit = {
                        TitleRow(vm, label!!)
                        Banners(vm, error, busy) { act("setup") { repository.api.vmRerunSetup(key) } }
                    }
                    val desktopPanel = @Composable { modifier: Modifier, ratio: Boolean -> DesktopPanel(vm, mode, desktop, modifier, ratio) }
                    val activityPanel = @Composable { modifier: Modifier ->
                        ActivityPanel(vm, activity, connected, busy == "run", modifier) { command -> act("run") { repository.api.vmRun(key, command) } }
                    }
                    val portPanel = @Composable {
                        PortPanel(portUrl, busy == "port") { port -> act("port") { portUrl = repository.api.vmExposePort(key, port, false) } }
                    }
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        when {
                            // Half-folded: the desktop above the fold, the log and command line below it.
                            tabletop -> TabletopSplit(
                                hinge,
                                top = { desktopPanel(it, false) },
                                bottom = { activityPanel(it) },
                            )
                            maxWidth >= 840.dp && !beside -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                header()
                                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.height(560.dp)) {
                                    desktopPanel(Modifier.weight(3f).fillMaxHeight(), false)
                                    activityPanel(Modifier.weight(2f).fillMaxHeight())
                                }
                                Box(Modifier.widthIn(max = 480.dp)) { portPanel() }
                            }
                            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                header()
                                desktopPanel(Modifier.fillMaxWidth(), true)
                                activityPanel(Modifier.fillMaxWidth().height(448.dp))
                                portPanel()
                                Spacer(Modifier.height(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Half folded on a table: [top] fills the screen above the hinge, [bottom] the part below it. */
@Composable
private fun TabletopSplit(hinge: androidx.compose.ui.geometry.Rect?, top: @Composable (Modifier) -> Unit, bottom: @Composable (Modifier) -> Unit) {
    var origin by remember { mutableStateOf<Float?>(null) }
    val density = androidx.compose.ui.platform.LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize().onGloballyPositioned { origin = it.positionInWindow().y }) {
        val total = constraints.maxHeight.toFloat()
        val start = origin
        val above = if (hinge != null && start != null) (hinge.top - start).coerceIn(0f, total) else total / 2
        val below = if (hinge != null && start != null) (hinge.bottom - start).coerceIn(above, total) else above
        Column(Modifier.fillMaxSize()) {
            top(Modifier.height(with(density) { above.toDp() }).fillMaxWidth().padding(8.dp))
            Spacer(Modifier.height(with(density) { (below - above).toDp() }))
            bottom(Modifier.weight(1f).fillMaxWidth().padding(8.dp))
        }
    }
}

@Composable
private fun TitleRow(vm: VmInfo, label: Vms.Label) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val session = state?.sessions?.firstOrNull { it.id == vm.key }
    val scope = rememberCoroutineScope()
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        label.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        label.project?.let { project ->
            TextButton(onClick = { app.navigator.open(ProjectEditor(project.id)) }) {
                AgentAvatar(project.icon, project.color, size = 18.dp, image = project.image)
                Text(project.name, modifier = Modifier.padding(start = 6.dp))
            }
        }
        if (session != null) {
            TextButton(onClick = { app.navigator.open(Chat(session.id)) }, modifier = Modifier.testTag("open-chat")) {
                Icon(Icons.AutoMirrored.Outlined.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Open chat", modifier = Modifier.padding(start = 6.dp))
            }
            if (session.busy) {
                FilledTonalButton(onClick = { scope.launch { runCatching { app.graph.repository.api.abort(session.id) } } }, modifier = Modifier.testTag("stop-dex")) {
                    Icon(Icons.Rounded.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Stop Dex", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun Banners(vm: VmInfo, error: String?, busy: String?, onRerun: () -> Unit) {
    if (vm.setup.status == "running") Banner("Setting up: ${vm.setup.step ?: "preparing"}…", tone = Tone.Info)
    if (vm.setup.status == "error") {
        Banner(
            "Setup failed" + (vm.setup.step?.let { " at “$it”" } ?: "") + (vm.setup.error?.let { ": $it" } ?: ""),
            tone = Tone.Warning,
            action = {
                TextButton(onClick = onRerun, enabled = busy == null) {
                    if (busy == "setup") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Re-run setup", modifier = Modifier.padding(start = 6.dp))
                }
            },
        )
    }
    (error ?: vm.error)?.let { Banner(it, tone = Tone.Error) }
}

/** A titled card on the machine page. */
@Composable
private fun Panel(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, actions: @Composable () -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = modifier) {
        Column {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp).weight(1f))
                actions()
            }
            content()
        }
    }
}

@Composable
private fun DesktopPanel(vm: VmInfo, mode: DesktopMode, desktop: DesktopUrl, modifier: Modifier, ratio: Boolean) {
    val app = LocalApp.current
    val openInBrowser = LocalOpenInBrowser.current
    val inPip = LocalInPip.current
    var control by rememberSaveable(vm.key) { mutableStateOf(false) }
    if (!vm.running && control) control = false
    KeepAwake(vm.key, vm.running && control)
    Panel("Desktop", Icons.Outlined.Monitor, modifier, actions = {
        if (vm.running) {
            ToggleButton(checked = control, onCheckedChange = { control = it }, modifier = Modifier.testTag("take-control")) {
                Icon(if (control) Icons.Outlined.PanTool else Icons.Outlined.Visibility, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(if (control) "You have control" else "Take control", modifier = Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelLarge)
            }
            if (desktop.loading) CircularProgressIndicator(Modifier.padding(horizontal = 8.dp).size(20.dp), strokeWidth = 2.dp)
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.testTag("desktop-menu")) { Icon(Icons.Rounded.MoreVert, contentDescription = "Desktop options") }
                androidx.compose.material3.DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text("Reconnect") },
                        leadingIcon = { Icon(Icons.Rounded.Refresh, contentDescription = null) },
                        onClick = { menu = false; desktop.reload() },
                    )
                    desktop.url?.let { url ->
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("Open in the browser") },
                            leadingIcon = { Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null) },
                            onClick = { menu = false; openInBrowser(desktopAddress(url, app.graph.repository.session.value, watch = false)) },
                        )
                    }
                    androidx.compose.material3.HorizontalDivider()
                    Text("Streaming mode", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    DesktopMode.entries.forEach { option ->
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text(option.label) },
                            onClick = { menu = false; app.graph.preferences.setDesktopMode(option.id) },
                            trailingIcon = { if (option == mode) Icon(Icons.Rounded.Check, contentDescription = "Selected") },
                        )
                    }
                }
            }
        }
    }) {
        val url = desktop.url
        Box(
            Modifier.fillMaxWidth().then(if (ratio) Modifier.aspectRatio(16 / 9f) else Modifier.weight(1f, fill = true).heightIn(min = 120.dp))
                .padding(start = 8.dp, end = 8.dp, bottom = 8.dp).clip(RoundedCornerShape(16.dp)).background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            if (vm.running && url != null && !inPip) {
                DesktopWebView(url, desktop.generation, control = control, modifier = Modifier.fillMaxSize(), onWatchTap = { control = true })
                if (!control) {
                    Surface(shape = RoundedCornerShape(50), color = Color.Black.copy(alpha = 0.7f), contentColor = Color.White, modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp)) {
                        Text("Watching · tap to take control", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(24.dp)) {
                    if (desktop.loading) CircularProgressIndicator(color = Color.White.copy(alpha = 0.7f)) else Icon(Icons.Outlined.Monitor, contentDescription = null, tint = Color.White.copy(alpha = 0.5f))
                    Text(
                        when {
                            inPip -> "Playing in picture-in-picture"
                            !vm.running -> "The desktop appears here while the VM is running."
                            else -> desktop.error ?: if (mode == DesktopMode.Selkies) "Starting the desktop stream… (the first time on a VM takes about 30 seconds)" else "Connecting to the desktop…"
                        },
                        style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.7f),
                    )
                    if (mode == DesktopMode.Stream && vm.running) Text("If the stream stays on “Connecting”, switch to Selkies or noVNC.", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.5f))
                }
            }
        }
    }
}

@Composable
private fun ActivityPanel(vm: VmInfo, items: List<VmActivity>?, connected: Boolean, running: Boolean, modifier: Modifier, onRun: (String) -> Unit) {
    var command by rememberSaveable(vm.key) { mutableStateOf("") }
    val list = rememberLazyListState()
    // The newest at the bottom, in view; a frame later, so it never lands in the middle of a layout pass.
    LaunchedEffect(items?.size) {
        if (items.isNullOrEmpty()) return@LaunchedEffect
        androidx.compose.runtime.withFrameNanos { }
        list.scrollToItem(items.lastIndex)
    }
    Panel("Activity", Icons.Outlined.Terminal, modifier) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                items == null -> BoneRows(6, Modifier.padding(16.dp))
                items.isEmpty() -> Text("No activity yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
                else -> LazyColumn(state = list, modifier = Modifier.fillMaxSize().testTag("vm-activity")) {
                    items(items, key = { it.id }) { item -> ActivityItem(item, last = item.id == items.last().id) }
                }
            }
        }
        OutlinedTextField(
            value = command,
            onValueChange = { command = it },
            enabled = connected,
            singleLine = true,
            prefix = { Text("$ ", fontFamily = FontFamily.Monospace, color = DexTheme.colors.info) },
            placeholder = { Text(if (vm.running) "Run a command" else "Run a command (starts the VM)", fontFamily = FontFamily.Monospace) },
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            trailingIcon = { if (running) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
            keyboardActions = KeyboardActions(onSend = {
                val value = command.trim()
                if (value.isNotEmpty()) {
                    command = ""
                    onRun(value)
                }
            }),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().padding(8.dp).testTag("vm-command"),
        )
    }
}

@Composable
private fun ActivityItem(item: VmActivity, last: Boolean) {
    var open by rememberSaveable(item.id) { mutableStateOf(last) }
    if (item.status == "running" && !open) open = true
    val hasOutput = item.output.isNotBlank()
    val rotation by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(enabled = hasOutput) { open = !open }.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp).rotate(rotation), tint = if (hasOutput) MaterialTheme.colorScheme.outline else Color.Transparent)
            ActorBadge(item.actor)
            Text(
                item.title,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = if (item.kind == "lifecycle" || item.kind == "screenshot") FontFamily.Default else FontFamily.Monospace),
                color = if (item.kind == "lifecycle" || item.kind == "screenshot") MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            when (item.status) {
                "running" -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                "error" -> Text(item.exitCode?.let { "exit $it" } ?: "failed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                else -> Text(Format.timeAgo(item.at), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            }
        }
        AnimatedVisibility(open && hasOutput) {
            Box(
                Modifier.fillMaxWidth().padding(start = 32.dp, end = 12.dp, bottom = 8.dp).heightIn(max = 288.dp).clip(RoundedCornerShape(12.dp))
                    .background(DexTheme.colors.codeBackground).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()),
            ) {
                Text(
                    item.output,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = if (item.status == "error") Color(0xFFFCA5A5) else DexTheme.colors.codeText,
                    softWrap = false,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
    }
}

@Composable
private fun ActorBadge(actor: String) {
    val dex = DexTheme.colors
    val (label, icon, colors) = when (actor) {
        "agent" -> Triple("Dex", Icons.Outlined.SmartToy, dex.successContainer to dex.onSuccessContainer)
        "user" -> Triple("You", Icons.Outlined.Person, dex.infoContainer to dex.onInfoContainer)
        else -> Triple("VM", null, MaterialTheme.colorScheme.surfaceContainerHighest to MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(colors.first).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        icon?.let { Icon(it, contentDescription = null, modifier = Modifier.size(12.dp), tint = colors.second) }
        Text(label, style = MaterialTheme.typography.labelSmall, color = colors.second)
    }
}

@Composable
private fun PortPanel(url: String?, busy: Boolean, onOpen: (Int) -> Unit) {
    val openInBrowser = LocalOpenInBrowser.current
    var port by rememberSaveable { mutableStateOf("") }
    Panel("Open a port", Icons.AutoMirrored.Outlined.OpenInNew, Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter(Char::isDigit).take(5) },
                    placeholder = { Text("3000") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.width(120.dp).testTag("port"),
                )
                Button(onClick = { port.toIntOrNull()?.takeIf { it in 1..65535 }?.let(onOpen) }, enabled = port.isNotEmpty() && !busy) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Get URL")
                }
            }
            url?.let { full ->
                TextButton(onClick = { openInBrowser(full) }, modifier = Modifier.testTag("port-url")) {
                    Text(full.replace(Regex("\\?_token=.*"), "") + " ↗", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
