package dev.trydex.android.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.theme.DexTheme
import kotlinx.coroutines.launch

/** A group of related rows or controls on a page, with an optional heading and info tip (Section on the web). */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    info: String? = null,
    aside: (@Composable RowScope.() -> Unit)? = null,
    contentPadding: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(Modifier.padding(vertical = if (contentPadding) 16.dp else 8.dp)) {
            if (title != null) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                    if (info != null) InfoTip(info, label = "About $title")
                    Spacer(Modifier.weight(1f))
                    aside?.invoke(this)
                }
            }
            Column(Modifier.padding(horizontal = if (contentPadding) 20.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                content()
            }
        }
    }
}

/** An ⓘ that explains something when tapped. */
@Composable
fun InfoTip(text: String, label: String = "More info") {
    val state = rememberTooltipState(isPersistent = true)
    val scope = rememberCoroutineScope()
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = { RichTooltip { Text(text) } },
        state = state,
    ) {
        IconButton(onClick = { scope.launch { state.show() } }, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.Info, contentDescription = label, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A short label shown on long press (Material's plain tooltip). */
@Composable
fun Hint(text: String, content: @Composable () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = { PlainTooltip { Text(text) } },
        state = rememberTooltipState(),
        content = content,
    )
}

/** A small status dot; pulsing while something is in progress. */
@Composable
fun StatusDot(color: Color, pulsing: Boolean = false, size: Dp = 8.dp, label: String? = null) {
    val alpha = if (pulsing) {
        val transition = rememberInfiniteTransition(label = "pulse")
        transition.animateFloat(1f, 0.35f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "pulse").value
    } else 1f
    Box(
        Modifier
            .size(size)
            .alpha(alpha)
            .clip(CircleShape)
            .background(color)
            .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier),
    )
}

@Composable
fun EmptyState(text: String, icon: ImageVector? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(36.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        action?.invoke()
    }
}

/** A problem to show inline (red text with an icon). */
@Composable
fun ErrorText(text: String, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
    }
}

/** A banner for something that needs attention (a missing connection, a failure). */
@Composable
fun Banner(
    text: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Warning,
    icon: ImageVector? = null,
    onClick: (() -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = DexTheme.colors
    val (container, content) = when (tone) {
        Tone.Warning -> colors.warningContainer to colors.onWarningContainer
        Tone.Info -> colors.infoContainer to colors.onInfoContainer
        Tone.Success -> colors.successContainer to colors.onSuccessContainer
        Tone.Error -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }
    val shape = MaterialTheme.shapes.large
    val surfaceModifier = modifier.fillMaxWidth()
    val body: @Composable () -> Unit = {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            action?.invoke()
        }
    }
    if (onClick != null) Surface(onClick = onClick, modifier = surfaceModifier, shape = shape, color = container, contentColor = content) { body() }
    else Surface(modifier = surfaceModifier, shape = shape, color = container, contentColor = content) { body() }
}

enum class Tone { Warning, Info, Success, Error }

/** A shimmering placeholder in the shape of what's loading (the web's skeleton bones). */
@Composable
fun Bone(width: Dp = Dp.Unspecified, height: Dp = 14.dp, modifier: Modifier = Modifier, fraction: Float? = null) {
    val transition = rememberInfiniteTransition(label = "bone")
    val alpha by transition.animateFloat(0.45f, 0.9f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "bone")
    val base = if (fraction != null) modifier.fillMaxWidth(fraction) else if (width != Dp.Unspecified) modifier.width(width) else modifier.fillMaxWidth()
    Box(
        base
            .height(height)
            .alpha(alpha)
            .clip(RoundedCornerShape(height / 2))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    )
}

/** Rows of bones, for a list that's loading. */
@Composable
fun BoneRows(count: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val widths = listOf(0.7f, 0.55f, 0.82f, 0.46f, 0.64f, 0.75f)
        repeat(count) { i ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Bone(fraction = widths[i % widths.size], height = 14.dp)
                Bone(fraction = widths[(i + 2) % widths.size] * 0.6f, height = 10.dp)
            }
        }
    }
}

/** Asks before doing something that can't be undone. Show it by calling [ConfirmState.ask]. */
@Stable
class ConfirmState {
    var request by mutableStateOf<Request?>(null)
        private set

    class Request(val title: String, val text: String?, val confirm: String, val destructive: Boolean, val onConfirm: () -> Unit)

    fun ask(title: String, text: String? = null, confirm: String = "Delete", destructive: Boolean = true, onConfirm: () -> Unit) {
        request = Request(title, text, confirm, destructive, onConfirm)
    }

    fun dismiss() {
        request = null
    }
}

@Composable
fun rememberConfirm(): ConfirmState {
    val state = remember { ConfirmState() }
    state.request?.let { request ->
        AlertDialog(
            onDismissRequest = state::dismiss,
            title = { Text(request.title) },
            text = request.text?.let { { Text(it) } },
            confirmButton = {
                TextButton(onClick = {
                    state.dismiss()
                    request.onConfirm()
                }) {
                    Text(request.confirm, color = if (request.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = { TextButton(onClick = state::dismiss) { Text("Cancel") } },
        )
    }
    return state
}

/** Haptic feedback, if it's on in Settings (it is unless turned off). */
@Stable
class Haptics(private val view: android.view.View, private val enabled: () -> Boolean) {
    private var last = 0L

    private fun perform(constant: Int) {
        if (!enabled()) return
        val now = System.currentTimeMillis()
        if (now - last < 80) return
        last = now
        view.performHapticFeedback(constant)
    }

    private val sdk = android.os.Build.VERSION.SDK_INT

    fun tap() = perform(HapticFeedbackConstants.KEYBOARD_TAP)
    fun toggle(on: Boolean) = perform(
        if (sdk >= 34) (if (on) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.TOGGLE_OFF) else HapticFeedbackConstants.CLOCK_TICK,
    )
    fun confirm() = perform(if (sdk >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    fun reject() = perform(if (sdk >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)
    fun longPress() = perform(HapticFeedbackConstants.LONG_PRESS)
    fun tick() = perform(HapticFeedbackConstants.CLOCK_TICK)
}

val LocalHaptics = staticCompositionLocalOf<Haptics?> { null }

@Composable
fun haptics(): Haptics {
    val view = LocalView.current
    return LocalHaptics.current ?: remember(view) { Haptics(view) { true } }
}
