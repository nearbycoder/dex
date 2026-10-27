package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material3.Button
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.QueuedMessage
import dev.trydex.core.model.attachmentSummary
import kotlinx.coroutines.launch

/** What the queue's buttons do. */
interface QueueActions {
    suspend fun move(id: String, index: Int)
    suspend fun remove(id: String)
    suspend fun edit(id: String, text: String)
    suspend fun steer(id: String)
}

/**
 * Follow-ups waiting for the run to finish, in the order they'll be sent: reorder, edit, delete, or send one now (as
 * a steer into the current run when it's working).
 */
@Composable
fun QueuePanel(items: List<QueuedMessage>, held: Boolean, running: Boolean, actions: QueueActions, modifier: Modifier = Modifier) {
    if (items.isEmpty()) return
    var open by rememberSaveable { mutableStateOf(false) }
    val chevron by animateFloatAsState(if (open) 0f else 180f, label = "queue")
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("queue-panel"),
    ) {
        Column {
            Surface(
                onClick = { open = !open },
                color = androidx.compose.ui.graphics.Color.Transparent,
                modifier = Modifier.fillMaxWidth().semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
            ) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(
                        if (held) Icons.Rounded.Pause else Icons.Outlined.HourglassTop,
                        contentDescription = null,
                        tint = if (held) DexTheme.colors.warning else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                    Column(Modifier.weight(1f)) {
                        Text("${items.size} queued", style = MaterialTheme.typography.labelLarge)
                        Text(
                            when {
                                held -> "Held since you stopped: send one, or a new message, to continue"
                                open -> "Sent in this order as the chat finishes"
                                else -> items.first().text
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Icon(Icons.Rounded.ExpandLess, contentDescription = null, modifier = Modifier.rotate(chevron))
                }
            }
            AnimatedVisibility(open) {
                val window = LocalWindowInfo.current
                val maxHeight = with(androidx.compose.ui.platform.LocalDensity.current) { (window.containerSize.height * 0.45f).toDp() }
                Column(Modifier.heightIn(max = maxHeight).verticalScroll(rememberScrollState())) {
                    items.forEachIndexed { index, item ->
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        QueueRow(item, index, items.size, running, actions)
                    }
                }
            }
        }
    }
}

@Composable
private fun QueueRow(item: QueuedMessage, index: Int, count: Int, running: Boolean, actions: QueueActions) {
    val scope = rememberCoroutineScope()
    var editing by remember(item.id) { mutableStateOf(false) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    fun act(block: suspend () -> Unit) {
        error = null
        scope.launch { runCatching { block() }.onFailure { error = it.message ?: "That didn't work." } }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).testTag("queued-item")) {
        if (editing) {
            val text = rememberTextFieldState(item.text)
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { focus.requestFocus() }
            OutlinedTextField(
                state = text,
                lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = 8),
                modifier = Modifier.fillMaxWidth().heightIn(max = 200.dp).focusRequester(focus).testTag("queued-editor"),
                shape = RoundedCornerShape(16.dp),
            )
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { editing = false }) { Text("Cancel") }
                Button(onClick = {
                    val value = text.text.toString().trim()
                    if (value.isNotEmpty()) act {
                        actions.edit(item.id, value)
                        editing = false
                    }
                }, enabled = text.text.isNotBlank()) {
                    Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("Save", modifier = Modifier.padding(start = 6.dp))
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(24.dp).background(MaterialTheme.colorScheme.secondaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                    Text("${index + 1}", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
                Column(Modifier.weight(1f)) {
                    if (item.text.isNotEmpty()) Text(item.text, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    if (item.attachments.isNotEmpty()) {
                        Text(
                            "Attached: ${attachmentSummary(item.attachments.map { it.name })}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(start = 26.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { act { actions.move(item.id, index - 1) } }, enabled = index > 0) { Icon(Icons.Rounded.ArrowUpward, contentDescription = "Move up", modifier = Modifier.size(20.dp)) }
                IconButton(onClick = { act { actions.move(item.id, index + 1) } }, enabled = index < count - 1) { Icon(Icons.Rounded.ArrowDownward, contentDescription = "Move down", modifier = Modifier.size(20.dp)) }
                IconButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, contentDescription = "Edit", modifier = Modifier.size(20.dp)) }
                IconButton(onClick = { act { actions.remove(item.id) } }) { Icon(Icons.Outlined.Delete, contentDescription = "Delete", modifier = Modifier.size(20.dp)) }
                Box(Modifier.weight(1f))
                TextButton(onClick = { act { actions.steer(item.id) } }, modifier = Modifier.testTag("steer")) {
                    Icon(Icons.Outlined.Bolt, contentDescription = null, modifier = Modifier.size(18.dp), tint = DexTheme.colors.warning)
                    Text(if (running) "Steer" else "Send now", color = DexTheme.colors.warning, modifier = Modifier.padding(start = 4.dp))
                }
            }
            error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 34.dp)) }
        }
    }
}
