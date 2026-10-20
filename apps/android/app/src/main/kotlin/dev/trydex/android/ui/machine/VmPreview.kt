package dev.trydex.android.ui.machine

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.rounded.CloseFullscreen
import androidx.compose.material.icons.rounded.OpenInFull
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.AppGraph
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalInPip
import dev.trydex.android.ui.PipSource
import dev.trydex.android.ui.components.StatusDot
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.ChatMachine
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmStatus
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

private const val MARGIN = 8f
private const val TOP = 56f
private const val BUTTON = 48f
private const val TITLE_BAR = 32f
private const val SMALL = 240f
private const val LARGE = 360f
private const val MIN = 180f

/**
 * A chat's VM, floating over the chat while it runs: a button you can drag anywhere, which opens a small, watch-only
 * window you can drag and resize. Leaving the app plays it in Android's picture-in-picture instead.
 */
@Composable
fun VmPreview(vm: VmInfo, title: String) {
    if (LocalInPip.current) return
    val app = LocalApp.current
    val prefs by app.graph.preferences.prefs.collectAsStateWithLifecycle()
    val haptics = haptics()
    val density = LocalDensity.current
    val safeTop = with(density) { WindowInsets.statusBars.getTop(this).toDp().value }
    val working = vm.busy || vm.status == VmStatus.Starting || vm.settingUp
    val dotColor = if (working) DexTheme.colors.warning else DexTheme.colors.success
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val vw = maxWidth.value
        val vh = maxHeight.value
        fun clamp(x: Float, y: Float, w: Float, h: Float) =
            x.coerceIn(MARGIN, max(MARGIN, vw - w - MARGIN)) to y.coerceIn(TOP + safeTop, max(TOP + safeTop, vh - h - MARGIN))
        if (!prefs.vmPreviewOpen) {
            var position by remember { mutableStateOf<Pair<Float, Float>?>(null) }
            val (x, y) = clamp(position?.first ?: prefs.vmButtonX ?: (vw - BUTTON - 12), position?.second ?: prefs.vmButtonY ?: (vh - BUTTON - 180), BUTTON, BUTTON)
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                shadowElevation = 6.dp,
                modifier = Modifier
                    .offset { IntOffset(x.dp.roundToPx(), y.dp.roundToPx()) }
                    .size(BUTTON.dp)
                    .testTag("vm-preview-button")
                    .semantics { contentDescription = "Watch this chat's VM" }
                    .draggable(
                        onTap = {
                            haptics.tap()
                            app.graph.preferences.setVmPreviewOpen(true)
                        },
                        onDrag = { dx, dy -> position = clamp((position?.first ?: x) + dx, (position?.second ?: y) + dy, BUTTON, BUTTON) },
                        onEnd = { position?.let { app.graph.preferences.setVmButton(it.first, it.second) } },
                    ),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Monitor, contentDescription = null)
                    Box(Modifier.align(Alignment.TopEnd).padding(top = 10.dp, end = 10.dp)) { StatusDot(dotColor, pulsing = working) }
                }
            }
            return@BoxWithConstraints
        }
        var width by remember { mutableFloatStateOf(prefs.vmPreviewWidth) }
        val w = width.coerceIn(MIN, max(MIN, vw - 16))
        val h = (w * 9 / 16).roundToInt() + TITLE_BAR
        var position by remember { mutableStateOf<Pair<Float, Float>?>(null) }
        val (x, y) = clamp(position?.first ?: prefs.vmWindowX ?: (vw - w - 12), position?.second ?: prefs.vmWindowY ?: (vh - h - 180), w, h)
        val running = vm.status == VmStatus.Running
        val desktop = rememberDesktopUrl(vm.key, DesktopMode.saved(prefs.desktopMode), running)
        val large = w >= (SMALL + LARGE) / 2
        val fromLeft = x + w / 2 > vw / 2
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Color.Black,
            shadowElevation = 12.dp,
            modifier = Modifier.offset { IntOffset(x.dp.roundToPx(), y.dp.roundToPx()) }.size(w.dp, h.dp).testTag("vm-preview")
                .semantics { contentDescription = "VM preview" },
        ) {
            Column {
                Row(
                    Modifier.fillMaxWidth().height(TITLE_BAR.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        .draggable(onTap = {}, onDrag = { dx, dy -> position = clamp((position?.first ?: x) + dx, (position?.second ?: y) + dy, w, h) }, onEnd = {
                            position?.let { app.graph.preferences.setVmWindow(it.first, it.second) }
                        })
                        .padding(start = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    StatusDot(dotColor, pulsing = working, size = 6.dp)
                    Text(if (vm.busy) "Dex is working" else "VM desktop", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f), maxLines = 1)
                    SmallIcon(if (large) Icons.Rounded.CloseFullscreen else Icons.Rounded.OpenInFull, if (large) "Small" else "Large") {
                        width = if (large) SMALL else LARGE
                        app.graph.preferences.setVmPreviewWidth(width)
                    }
                    SmallIcon(Icons.Rounded.Tv, "Open the Machine page to take control") { app.navigator.open(ChatMachine(vm.key)) }
                    SmallIcon(Icons.Rounded.Remove, "Close to a button") {
                        haptics.tap()
                        app.graph.preferences.setVmPreviewOpen(false)
                    }
                }
                Box(
                    Modifier.fillMaxWidth().weight(1f).draggable(onTap = {}, onDrag = { dx, dy -> position = clamp((position?.first ?: x) + dx, (position?.second ?: y) + dy, w, h) }, onEnd = {
                        position?.let { app.graph.preferences.setVmWindow(it.first, it.second) }
                    }),
                    contentAlignment = Alignment.Center,
                ) {
                    val url = desktop.url
                    if (running && url != null) {
                        DesktopWebView(url, desktop.generation, control = false, modifier = Modifier.fillMaxSize(), watch = true)
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (desktop.loading || vm.status == VmStatus.Starting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.6f))
                            else Icon(Icons.Outlined.Monitor, contentDescription = null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(18.dp))
                            Text(
                                when {
                                    running -> desktop.error ?: "Connecting to the desktop…"
                                    vm.status == VmStatus.Starting -> "The VM is starting…"
                                    else -> "The VM isn't running."
                                },
                                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                    }
                    // The resize grip, in the corner that faces the middle of the screen.
                    Box(
                        Modifier.align(if (fromLeft) Alignment.BottomStart else Alignment.BottomEnd).size(28.dp)
                            .semantics { contentDescription = "Drag to resize" }
                            .pointerInput(fromLeft) {
                                detectDragGestures(onDragEnd = {
                                    app.graph.preferences.setVmPreviewWidth(width)
                                    position?.let { app.graph.preferences.setVmWindow(it.first, it.second) }
                                }) { change, drag ->
                                    change.consume()
                                    val dx = drag.x / density.density * if (fromLeft) -1 else 1
                                    val dy = drag.y / density.density * 16 / 9
                                    val delta = if (abs(dx) >= abs(dy)) dx else dy
                                    val next = (width + delta).coerceIn(MIN, max(MIN, vw - 16))
                                    if (fromLeft) position = (x + w - next) to y
                                    width = next
                                }
                            },
                    ) {
                        Box(Modifier.align(if (fromLeft) Alignment.BottomStart else Alignment.BottomEnd).padding(4.dp).size(10.dp).border(2.dp, Color.White.copy(alpha = 0.4f), RoundedCornerShape(2.dp)))
                    }
                }
            }
        }
    }
}

@Composable
private fun SmallIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(32.dp)) { Icon(icon, contentDescription = label, modifier = Modifier.size(16.dp)) }
}

/** Drags (in dp) and taps, told apart by the touch slop. */
private fun Modifier.draggable(onTap: () -> Unit, onDrag: (Float, Float) -> Unit, onEnd: () -> Unit): Modifier = this.pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown()
        var moved = false
        var last = down.position
        while (true) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            if (!change.pressed) break
            val total = change.position - down.position
            if (!moved && total.getDistance() > viewConfiguration.touchSlop) moved = true
            if (moved) {
                val delta = change.position - last
                onDrag(delta.x / density, delta.y / density)
                change.consume()
            }
            last = change.position
        }
        if (moved) onEnd() else onTap()
    }
}

/** What plays in Android's picture-in-picture window: the VM's desktop, watch-only. */
@Composable
fun PipDesktop(graph: AppGraph, source: PipSource) {
    val prefs by graph.preferences.prefs.collectAsStateWithLifecycle()
    val state by graph.repository.state.collectAsStateWithLifecycle()
    val running = state?.vms?.firstOrNull { it.key == source.vmKey }?.running == true
    val desktop = rememberDesktopUrl(source.vmKey, DesktopMode.saved(prefs.desktopMode), running)
    Box(Modifier.fillMaxSize().background(Color.Black).testTag("pip-desktop"), contentAlignment = Alignment.Center) {
        val url = desktop.url
        if (running && url != null) {
            DesktopWebView(url, desktop.generation, control = false, modifier = Modifier.fillMaxSize(), watch = true)
        } else {
            Text(if (running) "Connecting…" else "The VM isn't running.", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        }
    }
}
