package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Done
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.R
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.MediaPlayer
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.openui.OpenUICard
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.AssistantMessage
import dev.trydex.core.model.DisplayItem
import dev.trydex.core.model.LiveTool
import dev.trydex.core.model.Media
import dev.trydex.core.model.PendingMessage
import dev.trydex.core.model.Skills
import dev.trydex.core.model.TextBlock
import dev.trydex.core.model.ThinkingBlock
import dev.trydex.core.model.ToolCallBlock
import dev.trydex.core.model.ToolResultMessage
import dev.trydex.core.model.Tools
import dev.trydex.core.model.TranscriptState
import dev.trydex.core.model.UiNotes
import dev.trydex.core.model.displayItems
import dev.trydex.core.model.obj
import dev.trydex.core.model.str
import dev.trydex.core.model.toolResults
import kotlinx.coroutines.launch

/** The transcript, newest at the bottom, following new content until you scroll up (then a button brings you back). */
@Composable
fun MessageList(
    sessionId: String,
    transcript: TranscriptState,
    pending: List<PendingMessage>,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
) {
    val items = remember(transcript.entries, transcript.streaming) { displayItems(transcript) }
    val results = remember(transcript.entries) { toolResults(transcript.entries) }
    // Reversed: the newest item is first, so the list starts at the bottom and keeps it in view as it grows.
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }
    val lastUser = items.lastOrNull { it is DisplayItem.User }?.id to pending.size
    // Sending something always brings you to the bottom (it opens there already). A frame later, so it never lands
    // in the middle of a layout pass.
    var seen by remember { mutableStateOf(lastUser) }
    LaunchedEffect(lastUser) {
        if (lastUser == seen) return@LaunchedEffect
        seen = lastUser
        withFrameNanos { }
        listState.scrollToItem(0)
    }

    Box(modifier) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            contentPadding = contentPadding,
            modifier = Modifier.fillMaxSize().testTag("messages"),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            transcript.error?.let { error -> item(key = "error") { Centered { ErrorCard(error) } } }
            transcript.retry?.let { retry -> item(key = "retry") { Centered { Text("Retrying after an error: ${retry.error}", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning, modifier = Modifier.padding(start = 40.dp, top = 4.dp)) } } }
            if (transcript.running && items.lastOrNull() !is DisplayItem.Assistant) {
                item(key = "working") {
                    Centered {
                        Row(Modifier.padding(start = 40.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            LoadingIndicator(Modifier.size(24.dp))
                            Text("Working…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            items(pending.reversed(), key = { "pending-${it.at}" }) { message -> Centered { UserBubble(message.text, 0, sending = true) } }
            items(items.reversed(), key = { it.id }) { item ->
                Centered {
                    when (item) {
                        is DisplayItem.User -> UserBubble(item.text, item.images)
                        is DisplayItem.Assistant -> AssistantTurn(
                            sessionId, item.messages, item.streaming, active = transcript.running && item === items.last(),
                            endedAt = item.endedAt, results = results, tools = transcript.tools, onSend = onSend,
                        )
                        is DisplayItem.Divider -> Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            HorizontalDivider(Modifier.weight(1f))
                            Text(item.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp))
                            HorizontalDivider(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
        AnimatedVisibility(!atBottom, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) {
            BadgedBox(badge = { if (transcript.running) Badge(containerColor = DexTheme.colors.success) }) {
                SmallFloatingActionButton(onClick = { scope.launch { listState.animateScrollToItem(0) } }, modifier = Modifier.testTag("jump-to-latest")) {
                    Icon(Icons.Rounded.ArrowDownward, contentDescription = "Scroll to the latest message")
                }
            }
        }
    }
}

/** Messages keep a readable width on wide screens. */
@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 760.dp).fillMaxWidth()) { content() }
    }
}

@Composable
private fun ErrorCard(text: String) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.ErrorOutline, contentDescription = null, modifier = Modifier.size(18.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * Your message: a leading `/skill` set off, and the note Dex added about what you did in the chat's UI shown as a note
 * rather than as your words.
 */
@Composable
fun UserBubble(raw: String, images: Int, sending: Boolean = false) {
    val split = UiNotes.split(raw)
    val skill = Skills.invoked(split.text)
    val accent = MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        androidx.compose.foundation.layout.Spacer(Modifier.weight(0.12f))
        Surface(
            shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 6.dp),
            color = if (sending) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f) else MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier.weight(0.88f, fill = false).widthIn(max = 560.dp).testTag(if (sending) "pending-message" else "user-message"),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                if (split.notes.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                        Icon(Icons.Outlined.TouchApp, contentDescription = null, modifier = Modifier.size(14.dp))
                        Text("In the UI: ${split.notes.joinToString("; ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                val text = buildAnnotatedString {
                    val at = if (skill != null) split.text.indexOf("/$skill") else -1
                    if (skill != null && at >= 0) {
                        append(split.text.substring(0, at))
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, color = accent)) { append("/$skill") }
                        append(split.text.substring(at + skill.length + 1))
                    } else append(split.text)
                }
                SelectionContainer { Text(text, style = MaterialTheme.typography.bodyLarge) }
                if (images > 0) Text("+$images image(s)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (sending) {
                    Row(Modifier.align(Alignment.End).padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.Rounded.Schedule, contentDescription = null, modifier = Modifier.size(12.dp))
                        Text("Sending", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/** One reply: its work folded into an activity row, then what it shows you (answer text and UI cards). */
@Composable
fun AssistantTurn(
    sessionId: String,
    messages: List<AssistantMessage>,
    streaming: Boolean,
    active: Boolean,
    endedAt: Long?,
    results: Map<String, ToolResultMessage>,
    tools: Map<String, LiveTool>,
    onSend: (String) -> Unit,
) {
    val app = LocalApp.current
    val openUrl = LocalOpenInBrowser.current
    val blocks = messages.flatMapIndexed { m, message ->
        message.content.mapIndexed { index, block -> Step("$m:$index", block, streaming && m == messages.lastIndex && index == message.content.lastIndex) }
    }
    val lastWork = blocks.indexOfLast { Tools.isWork(it.block) }
    // Notes the model wrote between steps stay with the work; UI cards and the final answer stay in view.
    val steps = blocks.take(lastWork + 1).filter { !Tools.isUi(it.block) }
    val shown = blocks.take(lastWork + 1).filter { Tools.isUi(it.block) } + blocks.drop(lastWork + 1)
    val touchedMemory = blocks.any { Tools.touchesMemory(it.block) }
    val shownText = shown.joinToString("\n") { (it.block as? TextBlock)?.text ?: "" }
    val sharedMedia = blocks.mapNotNull { step ->
        val call = step.block as? ToolCallBlock ?: return@mapNotNull null
        if (call.name != "share_media") return@mapNotNull null
        val media = results[call.id]?.details?.obj?.get("media")?.obj ?: return@mapNotNull null
        val url = media["url"].str ?: return@mapNotNull null
        if (url in shownText) null else url to media["name"].str
    }
    val confirmations = blocks.mapNotNull { step ->
        val call = step.block as? ToolCallBlock ?: return@mapNotNull null
        if (call.name != "app_call") return@mapNotNull null
        val confirmation = results[call.id]?.details?.obj?.get("confirmation")?.obj ?: return@mapNotNull null
        (confirmation["id"].str ?: return@mapNotNull null) to (confirmation["summary"].str ?: "")
    }
    val errors = messages.filter { it.stopReason == "error" }
    Row(Modifier.fillMaxWidth().testTag("assistant-turn"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = "Dex", modifier = Modifier.size(28.dp).padding(top = 2.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (steps.isNotEmpty()) {
                ActivityRow(
                    sessionId, steps,
                    active = active && shown.none { (it.block as? TextBlock)?.text?.isNotEmpty() == true },
                    running = active,
                    startedAt = messages.first().timestamp,
                    endedAt = endedAt,
                    results = results,
                    tools = tools,
                )
            }
            if (touchedMemory) {
                AssistChip(
                    onClick = { app.navigator.open(WorkspaceFile("/workspace/MEMORY.md")) },
                    label = { Text("Memory updated") },
                    leadingIcon = { Icon(Icons.Outlined.Psychology, contentDescription = null, modifier = Modifier.size(18.dp)) },
                )
            }
            sharedMedia.forEach { (url, name) -> Media.source(url)?.let { MediaPlayer(it, name, onOpen = openUrl) } }
            confirmations.forEach { (id, summary) -> ConfirmCard(id, summary) }
            shown.forEach { step ->
                when (val block = step.block) {
                    is TextBlock -> if (block.text.isNotEmpty()) Markdown(
                        block.text,
                        onLink = openUrl,
                        media = { source, title -> MediaPlayer(source, title, onOpen = openUrl) },
                    )
                    is ThinkingBlock -> Thought(block.thinking, step.live)
                    is ToolCallBlock -> if (Tools.isUi(block)) OpenUICard(
                        sessionId = sessionId,
                        code = block.arguments["code"].str ?: "",
                        streaming = streaming,
                        card = block.id,
                        onSend = onSend,
                    )
                    else -> Unit
                }
            }
            errors.forEach { ErrorCard(it.errorMessage ?: "The model request failed.") }
            if (messages.lastOrNull()?.stopReason == "aborted") Text("Stopped.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** An admin operation a chat asked for: confirm or decline it (Dex's own description of it, not the model's). */
@Composable
fun ConfirmCard(id: String, summary: String) {
    val app = LocalApp.current
    val state by app.graph.repository.state.collectAsStateWithLifecycle()
    val pending = state?.access?.pending?.firstOrNull { it.id == id }
    val status = pending?.status ?: "expired"
    var busy by remember { mutableStateOf<Boolean?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val colors = DexTheme.colors
    Surface(shape = RoundedCornerShape(20.dp), color = colors.warningContainer, contentColor = colors.onWarningContainer, modifier = Modifier.fillMaxWidth().testTag("confirm-$id")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Shield, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("DEX WANTS TO", style = MaterialTheme.typography.labelMedium)
            }
            Text(summary, style = MaterialTheme.typography.bodyLarge)
            if (status == "pending") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    fun answer(approve: Boolean) {
                        busy = approve
                        error = null
                        scope.launch {
                            runCatching { app.graph.repository.api.resolvePendingAction(id, approve) }.onFailure { error = it.message }
                            busy = null
                        }
                    }
                    Button(onClick = { answer(true) }, enabled = busy == null, colors = ButtonDefaults.buttonColors(containerColor = colors.warning, contentColor = MaterialTheme.colorScheme.surface)) {
                        if (busy == true) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Done, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Confirm", modifier = Modifier.padding(start = 6.dp))
                    }
                    TextButton(onClick = { answer(false) }, enabled = busy == null) {
                        if (busy == false) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Decline", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            } else {
                Text(
                    when (status) {
                        "approved" -> "Confirmed"
                        "declined" -> "Declined"
                        "failed" -> "Confirmed, but it failed" + (pending?.result?.let { ": $it" } ?: "")
                        else -> "Expired: ask again if you still want it"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = when (status) {
                        "approved" -> colors.success
                        "failed" -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
