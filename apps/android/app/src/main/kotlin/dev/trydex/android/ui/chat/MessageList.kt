package dev.trydex.android.ui.chat

import androidx.compose.animation.AnimatedVisibility
import dev.trydex.core.model.ImageBlock
import dev.trydex.core.model.AttachedFile
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.ui.graphics.asAndroidBitmap
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
import dev.trydex.android.ui.components.MarkdownOptions
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.rotate
import androidx.compose.material.icons.rounded.ExpandMore
import dev.trydex.android.ui.components.MediaPlayer
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.openui.OpenUICard
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.AssistantMessage
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.android.ui.components.CharacterAvatar
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import dev.trydex.core.model.DisplayItem
import dev.trydex.core.model.LiveTool
import dev.trydex.core.model.Media
import dev.trydex.core.model.PendingMessage
import dev.trydex.core.model.Skills
import dev.trydex.core.model.Spaces
import dev.trydex.core.model.StartedThread
import dev.trydex.android.ui.components.EmptyState
import androidx.compose.material.icons.outlined.Workspaces
import dev.trydex.core.model.TextBlock
import dev.trydex.core.model.ThinkingBlock
import dev.trydex.core.model.ToolCallBlock
import dev.trydex.core.model.ToolResultMessage
import dev.trydex.core.model.Tools
import dev.trydex.core.model.TranscriptState
import dev.trydex.core.model.ScheduledNote
import dev.trydex.core.model.UiAction
import dev.trydex.core.model.UiNotes
import dev.trydex.core.model.displayItems
import dev.trydex.core.model.obj
import dev.trydex.core.model.recordedDisplayItems
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
    /** Who answers, when it isn't Dex (a character): their face beside replies, and their greeting first. */
    character: CharacterProfile? = null,
    /** What an empty chat says (a new space's: what to do first). */
    emptyHint: String? = null,
    /** Resumes the chat after a failed or interrupted run without duplicating the user turn. */
    onContinue: (() -> Unit)? = null,
) {
    val recorded = remember(transcript.entries) { recordedDisplayItems(transcript.entries) }
    val items = remember(recorded, transcript.streaming) { displayItems(recorded, transcript.streaming) }
    val results = remember(transcript.entries) { toolResults(transcript.entries) }
    val newestFirst = remember(items) { items.asReversed() }
    val pendingNewestFirst = remember(pending) { pending.asReversed() }
    val last = items.lastOrNull()
    // Reversed: the newest item is first, so the list starts at the bottom and keeps it in view as it grows.
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }
    val lastUser = remember(items, pending.size) { items.lastOrNull { it is DisplayItem.User }?.id to pending.size }
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
            transcript.error?.let { error ->
                item(key = "error", contentType = "error") {
                    Centered { ErrorCard(error, onContinue = if (!transcript.running) onContinue else null) }
                }
            }
            transcript.retry?.let { retry -> item(key = "retry", contentType = "retry") { Centered { Text("Retrying after an error: ${retry.error}", style = MaterialTheme.typography.bodySmall, color = DexTheme.colors.warning, modifier = Modifier.padding(start = 40.dp, top = 4.dp)) } } }
            if (transcript.running && items.lastOrNull() !is DisplayItem.Assistant) {
                item(key = "working", contentType = "working") {
                    Centered {
                        Row(Modifier.padding(start = 40.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            LoadingIndicator(Modifier.size(24.dp))
                            Text("Working…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            items(pendingNewestFirst, key = { "pending-${it.id}" }, contentType = { "pending" }) { message -> Centered { UserBubble(message.text, 0, sending = true) } }
            items(newestFirst, key = { it.id }, contentType = { it::class }) { item ->
                Centered {
                    when (item) {
                        // A prompt that ran on a schedule: the chat reaching out on its own, not something you said.
                        // A thread reporting back to its space: event rows, not your words.
                        is DisplayItem.User -> ScheduledNote.of(item.text)?.let { ScheduledNoteRow(it) }
                            ?: Spaces.parseUpdates(item.text)?.takeIf { it.isNotEmpty() }?.let { SpaceUpdateRows(it) }
                            ?: UserBubble(item.text, item.images, files = item.files, imageParts = item.imageParts, sessionId = sessionId)
                        is DisplayItem.Assistant -> AssistantTurn(
                            sessionId, item.messages, item.streaming, active = transcript.running && item === last,
                            endedAt = item.endedAt, results = results, tools = if (item === last) transcript.tools else emptyMap(), onSend = onSend, character = character,
                            onContinue = if (item === last && !transcript.running) onContinue else null,
                        )
                        is DisplayItem.Divider -> ContextDivider(item)
                    }
                }
            }
            character?.greeting?.takeIf { it.isNotBlank() }?.let { item(key = "greeting", contentType = "greeting") { Centered { CharacterGreeting(character) } } }
            if (emptyHint != null && items.isEmpty() && pending.isEmpty() && !transcript.running) {
                item(key = "empty-hint", contentType = "empty-hint") { Centered { EmptyState(emptyHint, Icons.Outlined.Workspaces, Modifier.testTag("empty-hint")) } }
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

/** "⏰ Scheduled: <prompt>", small, centered, and muted, where a scheduled prompt ran. */
@Composable
fun ScheduledNoteRow(prompt: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp).testTag("scheduled-note"), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Text(
            "⏰ Scheduled: $prompt",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
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
private fun RecoveredErrors(errors: List<String>) {
    var open by remember { mutableStateOf(false) }
    val tint = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.8f)
    Column(Modifier.testTag("retried-errors")) {
        Row(
            Modifier.clickable { open = !open }.padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
            Text(if (errors.size == 1) "Retried after an error" else "Retried after ${errors.size} errors", style = MaterialTheme.typography.labelMedium, color = tint)
        }
        if (open) {
            // Each different error once, with how many times it came.
            errors.groupingBy { it }.eachCount().forEach { (error, count) ->
                Text(
                    if (count > 1) "$count× $error" else error,
                    style = MaterialTheme.typography.bodySmall,
                    color = tint,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 20.dp, top = 4.dp),
                )
            }
        }
    }
}

/** A failure the reply ended on. */
@Composable
private fun ErrorCard(text: String, onContinue: (() -> Unit)? = null) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.ErrorOutline, contentDescription = null, modifier = Modifier.size(18.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (onContinue != null) {
                TextButton(onClick = onContinue) {
                    Text("Continue")
                }
            }
        }
    }
}

/**
 * Your message: a leading `/skill` set off, and the note Dex added about what you did in the chat's UI shown as a note
 * rather than as your words.
 */
@Composable
fun UserBubble(
    raw: String,
    images: Int,
    sending: Boolean = false,
    files: List<AttachedFile> = emptyList(),
    imageParts: List<ImageBlock> = emptyList(),
    sessionId: String? = null,
) {
    val split = remember(raw) { UiNotes.split(raw) }
    // A button pressed in the chat's UI: its words and what it carried, not the lines the model reads.
    val action = remember(split.text) { UiAction.parse(split.text) }
    val skill = remember(split.text, action) { if (action == null) Skills.invoked(split.text) else null }
    val accent = MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        androidx.compose.foundation.layout.Spacer(Modifier.weight(0.12f))
        Surface(
            shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 6.dp),
            color = if (sending) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f) else MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier.weight(0.88f, fill = false).widthIn(max = 560.dp).testTag(if (sending) "pending-message" else "user-message"),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                if (imageParts.isNotEmpty() || files.isNotEmpty()) UserAttachments(sessionId, imageParts, files, spaced = split.text.isNotEmpty())
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
                if (action != null) UiActionText(action)
                else if (split.text.isNotEmpty()) SelectionContainer { Text(text, style = MaterialTheme.typography.bodyLarge) }
                // Without a chat to load them from, images are only counted.
                if (images > 0 && sessionId == null) Text("+$images image(s)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

/**
 * Where the model's context starts again: a summary of what came before (or a reset). Tapping it shows the summary,
 * which is what the model was given in place of the messages above.
 */
@Composable
private fun ContextDivider(item: DisplayItem.Divider) {
    var open by rememberSaveable(item.id) { mutableStateOf(false) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("context-divider")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .then(if (item.summary != null) Modifier.clickable(onClickLabel = if (open) "Hide the summary" else "Show the summary") { open = !open } else Modifier)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(item.label, style = MaterialTheme.typography.labelSmall, color = muted)
                if (item.summary != null) {
                    Icon(Icons.Rounded.ExpandMore, contentDescription = null, tint = muted, modifier = Modifier.size(16.dp).rotate(if (open) 180f else 0f))
                }
            }
            HorizontalDivider(Modifier.weight(1f))
        }
        AnimatedVisibility(open && item.summary != null) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("What the model was given in place of the messages above", style = MaterialTheme.typography.labelSmall, color = muted)
                    Markdown(item.summary.orEmpty(), options = MarkdownOptions(textStyle = MaterialTheme.typography.bodyMedium))
                }
            }
        }
    }
}

/** A button you pressed in the chat's UI, inside your bubble: what it does, then what it carried as small labels. */
@Composable
private fun UiActionText(action: UiAction) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.clearAndSetSemantics { contentDescription = action.spoken }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.TouchApp, contentDescription = null, tint = muted, modifier = Modifier.padding(top = 3.dp).size(16.dp))
            SelectionContainer { Text(action.message, style = MaterialTheme.typography.bodyLarge) }
        }
        if (action.details.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (detail in action.details) {
                    Text(
                        buildAnnotatedString {
                            if (detail.label.isNotEmpty()) withStyle(SpanStyle(color = muted)) { append("${detail.label} ") }
                            append(detail.value)
                        },
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.55f), RoundedCornerShape(7.dp))
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                    )
                }
            }
        }
    }
}

/** What was attached to one of your messages: its images as thumbnails, its other files as chips (tap to download). */
@Composable
private fun UserAttachments(sessionId: String?, images: List<ImageBlock>, files: List<AttachedFile>, spaced: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val http = LocalApp.current.graph.mediaHttp
    val scope = rememberCoroutineScope()
    // Each image has a tag naming it among the files; the thumbnails stand for those.
    val imageFiles = files.filter { it.mimeType.startsWith("image/") && it.mimeType != "image/svg+xml" }
    val others = files.filter { !it.mimeType.startsWith("image/") || it.mimeType == "image/svg+xml" }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(bottom = if (spaced) 8.dp else 0.dp).testTag("user-attachments"),
    ) {
        if (sessionId != null) images.forEachIndexed { index, image ->
            val bitmap = rememberTranscriptBitmap(sessionId, image)
            Box(
                Modifier.size(96.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
                contentAlignment = Alignment.Center,
            ) {
                val loaded = bitmap?.getOrNull()
                when {
                    loaded != null -> {
                        Image(loaded, contentDescription = "Attached image", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .padding(4.dp)
                                .size(26.dp)
                                .clip(androidx.compose.foundation.shape.CircleShape)
                                .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.6f))
                                .clickable(onClickLabel = "Download image") {
                                    val name = imageFiles.getOrNull(index)?.name ?: "image-${index + 1}.png"
                                    scope.launch {
                                        dev.trydex.android.data.AssetDownloader.saveBitmapToDevice(context, loaded.asAndroidBitmap(), name)
                                            .onSuccess { android.widget.Toast.makeText(context, "Saved ${it.fileName} to Downloads/Dex", android.widget.Toast.LENGTH_SHORT).show() }
                                            .onFailure { android.widget.Toast.makeText(context, it.message ?: "Couldn't save image", android.widget.Toast.LENGTH_SHORT).show() }
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Rounded.Download, contentDescription = "Download image", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(14.dp))
                        }
                    }
                    bitmap == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else -> Text("Image unavailable", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        for (file in others) {
            val downloadUrl = file.key?.let { dev.trydex.android.ui.components.dexUrl("/api/media/$it") }
            var downloading by remember(file.key) { mutableStateOf(false) }
            Row(
                Modifier
                    .widthIn(max = 240.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.5f))
                    .then(
                        if (downloadUrl != null) {
                            Modifier.clickable(enabled = !downloading, onClickLabel = "Download ${file.name}") {
                                downloading = true
                                scope.launch {
                                    dev.trydex.android.data.AssetDownloader.downloadToDevice(context, http, downloadUrl, file.name, file.mimeType)
                                        .onSuccess { android.widget.Toast.makeText(context, "Saved ${it.fileName} to Downloads/Dex", android.widget.Toast.LENGTH_SHORT).show() }
                                        .onFailure { android.widget.Toast.makeText(context, it.message ?: "Couldn't download ${file.name}", android.widget.Toast.LENGTH_SHORT).show() }
                                    downloading = false
                                }
                            }
                        } else {
                            Modifier
                        }
                    )
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(fileIcon(file.mimeType, file.name), contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(file.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (downloadUrl != null) {
                    if (downloading) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Rounded.Download, contentDescription = "Download ${file.name}", modifier = Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
    character: CharacterProfile? = null,
    onContinue: (() -> Unit)? = null,
) {
    val app = LocalApp.current
    val openUrl = LocalOpenInBrowser.current
    // Worked out once per change to this turn, not on every frame of another turn's stream.
    val turn = remember(messages, streaming, results) { TurnParts.of(messages, streaming, results) }
    val (steps, shown, touchedMemory) = turn
    val sharedMedia = turn.sharedMedia
    val confirmations = turn.confirmations
    val threads = turn.threads
    // A failed request the chat retried past is noted quietly with the work; only a failure the reply ended on shows
    // as an error card (while the run goes on, a retry may still get past it).
    val failedLast = messages.lastOrNull()?.stopReason == "error"
    val recovered = turn.errors.let { if (failedLast) it.dropLast(1) else it }
    Row(Modifier.fillMaxWidth().testTag("assistant-turn"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (character != null) CharacterAvatar(character, size = 28.dp, modifier = Modifier.semantics { contentDescription = character.name })
        else Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = "Dex", modifier = Modifier.size(28.dp).padding(top = 2.dp))
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
            if (recovered.isNotEmpty()) RecoveredErrors(recovered.map { it.errorMessage ?: "The model request failed." })
            if (touchedMemory) {
                AssistChip(
                    // A character keeps their own notes about you.
                    onClick = { app.navigator.open(WorkspaceFile(character?.let { Characters.memoryPath(it.id) } ?: "/workspace/MEMORY.md")) },
                    label = { Text("Memory updated") },
                    leadingIcon = { Icon(Icons.Outlined.Psychology, contentDescription = null, modifier = Modifier.size(18.dp)) },
                )
            }
            sharedMedia.forEach { (url, name) -> Media.source(url)?.let { MediaPlayer(it, name, onOpen = openUrl) } }
            confirmations.forEach { (id, summary) -> ConfirmCard(id, summary) }
            threads.forEach { ThreadCard(it.id, it.title) }
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
            if (failedLast && !active) ErrorCard(messages.last().errorMessage ?: "The model request failed.", onContinue = onContinue)
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

/** One reply split for showing: its work steps, what stays in view, and the media and confirmations it produced. */
private data class TurnParts(
    val steps: List<Step>,
    val shown: List<Step>,
    val touchedMemory: Boolean,
    val sharedMedia: List<Pair<String, String?>>,
    val confirmations: List<Pair<String, String>>,
    val errors: List<AssistantMessage>,
    /** Threads a space's coordinator started, as live cards. */
    val threads: List<StartedThread> = emptyList(),
) {
    companion object {
        fun of(messages: List<AssistantMessage>, streaming: Boolean, results: Map<String, ToolResultMessage>): TurnParts {
            val blocks = messages.flatMapIndexed { m, message ->
                message.content.mapIndexed { index, block -> Step("$m:$index", block, streaming && m == messages.lastIndex && index == message.content.lastIndex) }
            }
            val lastWork = blocks.indexOfLast { Tools.isWork(it.block) }
            // Notes the model wrote between steps stay with the work; UI cards and the final answer stay in view.
            val steps = blocks.take(lastWork + 1).filter { !Tools.isUi(it.block) }
            val shown = blocks.take(lastWork + 1).filter { Tools.isUi(it.block) } + blocks.drop(lastWork + 1)
            val hasShareMedia = blocks.any { (it.block as? ToolCallBlock)?.name == "share_media" }
            val shownText = if (hasShareMedia) shown.joinToString("\n") { (it.block as? TextBlock)?.text ?: "" } else ""
            val sharedMedia = if (!hasShareMedia) emptyList() else blocks.mapNotNull { step ->
                val call = step.block as? ToolCallBlock ?: return@mapNotNull null
                if (call.name != "share_media") return@mapNotNull null
                val media = results[call.id]?.details?.obj?.get("media")?.obj ?: return@mapNotNull null
                val url = media["url"].str ?: return@mapNotNull null
                if (url in shownText) null else url to media["name"].str
            }
            val confirmations = blocks.flatMap { step ->
                val call = step.block as? ToolCallBlock ?: return@flatMap emptyList()
                if (call.name != "app_call" && call.name != "batch_tools" && "__" !in call.name) return@flatMap emptyList()
                val details = results[call.id]?.details?.obj ?: return@flatMap emptyList()
                val batch = (details["confirmations"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { el ->
                    val obj = el.obj ?: return@mapNotNull null
                    (obj["id"].str ?: return@mapNotNull null) to (obj["summary"].str ?: "")
                }
                if (!batch.isNullOrEmpty()) return@flatMap batch
                val confirmation = details["confirmation"]?.obj ?: return@flatMap emptyList()
                listOfNotNull(confirmation["id"].str?.let { it to (confirmation["summary"].str ?: "") })
            }
            val threads = blocks.mapNotNull { step ->
                val call = step.block as? ToolCallBlock ?: return@mapNotNull null
                if (call.name != Spaces.START_THREAD_TOOL) null else Spaces.startedThread(results[call.id]?.details)
            }.distinctBy { it.id }
            return TurnParts(steps, shown, blocks.any { Tools.touchesMemory(it.block) }, sharedMedia, confirmations, messages.filter { it.stopReason == "error" }, threads)
        }
    }
}
