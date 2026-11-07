package dev.trydex.android.ui.machine

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.CompactTopBar
import dev.trydex.android.ui.components.EmptyState
import dev.trydex.android.ui.nav.ChatMachine
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus
import dev.trydex.core.model.Vms
import kotlinx.coroutines.launch
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.min

private val GAP = 8.dp

/**
 * A chat's control panel (the web's /control/<chat>): every one of its VMs live at once, as square, watch-only tiles,
 * so you can watch the agent work several machines and browsers side by side. Fullscreen fills the whole display;
 * tapping a tile shows it large; its Machine page is where you take control.
 */
@Composable
fun ControlPanelScreen(chatId: String) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val state by repository.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val current = state
    val session = current?.sessions?.firstOrNull { it.id == chatId }
    val vms = current?.vms.orEmpty().filter { Vms.chatOf(it.key) == chatId }.sortedBy { Vms.number(it.key) }
    var fullscreen by rememberSaveable { mutableStateOf(false) }
    var focused by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun act(block: suspend () -> Unit) {
        error = null
        scope.launch { runCatching { block() }.onFailure { error = it.message } }
    }
    // The lowest free number, so a deleted VM's slot is reused.
    val next = (1..Vms.MAX_PER_CHAT).firstOrNull { n -> vms.none { Vms.number(it.key) == n } }
    val running = vms.count { it.status == VmStatus.Running }

    val actions: @Composable () -> Unit = {
        IconButton(onClick = {
            val n = next ?: return@IconButton
            adding = true
            scope.launch {
                runCatching { repository.api.vmStart(Vms.keyFor(chatId, n)) }.onFailure { error = it.message }
                adding = false
            }
        }, enabled = next != null && !adding, modifier = Modifier.testTag("control-add")) {
            if (adding) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Add, contentDescription = "Start another VM for this chat")
        }
        if (running > 0) IconButton(onClick = { act { vms.filter { it.running }.forEach { repository.api.vmStop(it.key) } } }) {
            Icon(Icons.Rounded.Stop, contentDescription = "Stop every VM of this chat (disks are kept)")
        }
        IconButton(onClick = { fullscreen = !fullscreen }, modifier = Modifier.testTag("control-fullscreen")) {
            Icon(if (fullscreen) Icons.Rounded.FullscreenExit else Icons.Rounded.Fullscreen, contentDescription = if (fullscreen) "Exit fullscreen" else "Fullscreen")
        }
    }
    val body: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
            val big = focused?.let { key -> vms.firstOrNull { it.key == key } }
            when {
                current == null -> Box(Modifier.fillMaxSize())
                vms.isEmpty() -> EmptyState(
                    "This chat has no VMs running yet. Ask it to work on several at once, like “check these five sites side by side”, and each shows up here live. It can run up to ${Vms.MAX_PER_CHAT}.",
                    Icons.Outlined.Monitor,
                )
                big != null -> Box(Modifier.fillMaxSize().padding(GAP)) {
                    Tile(big, large = true, onOpen = { focused = null }, onAct = ::act)
                }
                else -> TileGrid(vms) { vm -> Tile(vm, large = false, onOpen = { focused = vm.key }, onAct = ::act) }
            }
        }
    }

    if (fullscreen) {
        // The whole display, over the panes and system bars' area; back leaves fullscreen.
        Dialog(onDismissRequest = { fullscreen = false }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
            Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.safeDrawing)) {
                Row(Modifier.fillMaxWidth().height(48.dp).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(session?.title ?: "VMs", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("${vms.size} of ${Vms.MAX_PER_CHAT} · $running running", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    actions()
                }
                body(Modifier.fillMaxSize())
            }
        }
    }
    Scaffold(
        topBar = {
            CompactTopBar(
                title = {
                    Column {
                        Text(session?.title ?: "VMs", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        Text("${vms.size} of ${Vms.MAX_PER_CHAT} VMs · $running running", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = { actions() },
            )
        },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        modifier = Modifier.testTag("control-panel"),
    ) { padding ->
        // In fullscreen the dialog plays the streams; don't play them twice.
        if (!fullscreen) body(Modifier.fillMaxSize().padding(padding))
    }
}

/**
 * Square tiles, as large as fit every one of them on screen; below 160dp a tile stops shrinking and the grid scrolls.
 */
@Composable
private fun TileGrid(vms: List<VmInfo>, tile: @Composable (VmInfo) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().padding(GAP)) {
        val width = maxWidth.value
        val height = maxHeight.value
        val gap = GAP.value
        var best = 1 to 0f
        for (columns in 1..vms.size.coerceAtLeast(1)) {
            val rows = ceil(vms.size / columns.toFloat())
            val size = floor(min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows))
            if (size > best.second) best = columns to size
        }
        val fits = best.second >= 160f
        LazyVerticalGrid(
            columns = if (fits) GridCells.Fixed(best.first) else GridCells.Adaptive(220.dp),
            horizontalArrangement = Arrangement.spacedBy(GAP, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(GAP, if (fits) Alignment.CenterVertically else Alignment.Top),
            userScrollEnabled = !fits,
            modifier = if (fits) Modifier.width((best.second * best.first + gap * (best.first - 1)).dp).align(Alignment.Center) else Modifier.fillMaxSize(),
        ) {
            items(vms, key = { it.key }) { vm -> Box(Modifier.aspectRatio(1f)) { tile(vm) } }
        }
    }
}

/** One VM, live and watch-only: its number and status, start or stop, and the way to its Machine page. */
@Composable
private fun Tile(vm: VmInfo, large: Boolean, onOpen: () -> Unit, onAct: (suspend () -> Unit) -> Unit) {
    val app = LocalApp.current
    val repository = app.graph.repository
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val running = vm.status == VmStatus.Running
    val desktop = rememberDesktopUrl(vm.key, DesktopMode.saved(prefs.desktopMode), running)
    val n = Vms.number(vm.key)
    val canStart = vm.status == VmStatus.None || vm.status == VmStatus.Stopped || vm.status == VmStatus.Error
    val border = if (vm.busy) MaterialTheme.colorScheme.primary.copy(alpha = 0.6f) else MaterialTheme.colorScheme.outlineVariant
    Column(
        Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).border(1.dp, border, RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer).testTag("control-tile"),
    ) {
        Row(Modifier.fillMaxWidth().height(36.dp).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            VmStatusDot(vm.status)
            Text("VM $n", style = MaterialTheme.typography.labelLarge)
            Text(
                if (vm.busy) "Working…" else Vms.statusLabel(vm.status),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            if (running) IconButton(onClick = { onAct { repository.api.vmStop(vm.key) } }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Rounded.Stop, contentDescription = "Stop VM $n (disk is kept)", modifier = Modifier.size(16.dp))
            }
            IconButton(onClick = { app.navigator.open(ChatMachine(vm.key)) }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Rounded.Tv, contentDescription = "Open VM $n's Machine page to take control", modifier = Modifier.size(16.dp))
            }
            if (large) IconButton(onClick = onOpen, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Rounded.Close, contentDescription = "Back to all VMs", modifier = Modifier.size(16.dp))
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f).background(Color.Black), contentAlignment = Alignment.Center) {
            val url = desktop.url
            if (running && url != null) {
                // The 16:9 desktop, letterboxed in the tile; a tap shows it large.
                DesktopWebView(
                    url, desktop.generation, control = false, watch = true,
                    modifier = Modifier.fillMaxWidth().aspectRatio(16 / 9f, matchHeightConstraintsFirst = large),
                    onWatchTap = if (large) null else onOpen,
                )
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(12.dp)) {
                    if (desktop.loading || vm.status == VmStatus.Starting || vm.status == VmStatus.Stopping) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.6f))
                    } else {
                        Icon(Icons.Outlined.Monitor, contentDescription = null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(18.dp))
                    }
                    Text(
                        when {
                            running -> desktop.error ?: "Connecting to the desktop…"
                            vm.status == VmStatus.Starting -> "Starting…"
                            else -> Vms.statusLabel(vm.status)
                        },
                        style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f),
                    )
                    if (canStart) TextButton(onClick = { onAct { repository.api.vmStart(vm.key) } }) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(if (vm.status == VmStatus.Stopped) " Resume" else " Start")
                    }
                }
            }
        }
    }
}
