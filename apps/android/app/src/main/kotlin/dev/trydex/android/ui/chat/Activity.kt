package dev.trydex.android.ui.chat

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.rounded.ChecklistRtl
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.MarkdownOptions
import dev.trydex.android.ui.nav.ChatMachine
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.android.ui.theme.Mono
import dev.trydex.core.model.ContentBlock
import dev.trydex.core.model.Format
import dev.trydex.core.model.ImageBlock
import dev.trydex.core.model.LiveTool
import dev.trydex.core.model.TextBlock
import dev.trydex.core.model.ThinkingBlock
import dev.trydex.core.model.ToolCallBlock
import dev.trydex.core.model.ToolResultMessage
import dev.trydex.core.model.Tools
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** One step of a reply's work: a block, and whether it's the end of the message still streaming. */
data class Step(val key: String, val block: ContentBlock, val live: Boolean)

fun toolIcon(name: String): ImageVector = when (Tools.icon(name)) {
    Tools.Icon.Terminal -> Icons.Outlined.Terminal
    Tools.Icon.FileText -> Icons.Outlined.Description
    Tools.Icon.FilePen -> Icons.Outlined.EditNote
    Tools.Icon.Search -> Icons.Outlined.Search
    Tools.Icon.Globe -> Icons.Outlined.Language
    Tools.Icon.Clock -> Icons.Outlined.Schedule
    Tools.Icon.Monitor -> Icons.Outlined.Monitor
    Tools.Icon.Camera -> Icons.Outlined.CameraAlt
    Tools.Icon.Book -> Icons.AutoMirrored.Outlined.MenuBook
    Tools.Icon.Plug -> Icons.Outlined.Extension
    Tools.Icon.Wrench -> Icons.Outlined.Build
}

/** Ticks every `period` ms while `active`, so a running clock redraws. */
@Composable
fun rememberNow(active: Boolean, period: Long = 1_000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(active) {
        while (active) {
            now = System.currentTimeMillis()
            delay(period)
        }
        now = System.currentTimeMillis()
    }
    return now
}

/**
 * Everything the model did on the way to its answer, as one row: a status line that follows the current step, counts,
 * and time. Tap it to see every thought, note, and tool call in order.
 */
@Composable
fun ActivityRow(
    sessionId: String,
    steps: List<Step>,
    active: Boolean,
    running: Boolean,
    startedAt: Long,
    endedAt: Long?,
    results: Map<String, ToolResultMessage>,
    tools: Map<String, LiveTool>,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val now = rememberNow(running || endedAt == null)
    val calls = steps.mapNotNull { it.block as? ToolCallBlock }
    val thoughts = steps.count { it.block is ThinkingBlock }
    val failed = calls.count { results[it.id]?.isError == true }
    val current = calls.lastOrNull { it.id !in results }
    val latest = steps.lastOrNull { step ->
        when (val b = step.block) {
            is ThinkingBlock -> b.thinking.isNotBlank()
            is TextBlock -> b.text.isNotBlank()
            else -> true
        }
    }?.block
    val status = when {
        !active -> "Worked for ${Format.duration((endedAt ?: now) - startedAt)}"
        current != null -> Tools.activity(current.name)
        else -> "Thinking"
    }
    val detail = when {
        !active -> ""
        current != null -> Tools.summarize(current.arguments)
        latest is ThinkingBlock -> Tools.latestLine(latest.thinking)
        latest is TextBlock -> Tools.latestLine(latest.text)
        latest is ToolCallBlock -> "${latest.name} ${Tools.summarize(latest.arguments)}"
        else -> ""
    }
    val counts = listOfNotNull(
        calls.takeIf { it.isNotEmpty() }?.let { Format.plural(it.size, "tool") },
        thoughts.takeIf { it > 0 }?.let { Format.plural(it, "thought") },
        failed.takeIf { it > 0 }?.let { "$it failed" },
        if (active) Format.duration(now - startedAt) else null,
    ).joinToString(" · ")
    val chevron by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("activity"),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable(onClickLabel = if (open) "Hide steps" else "Show steps") { open = !open }.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(18.dp).rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                when {
                    active -> LoadingIndicator(Modifier.size(20.dp))
                    failed > 0 -> Icon(Icons.Rounded.WarningAmber, contentDescription = null, tint = DexTheme.colors.warning, modifier = Modifier.size(18.dp))
                    else -> Icon(Icons.Rounded.ChecklistRtl, contentDescription = null, tint = DexTheme.colors.success, modifier = Modifier.size(18.dp))
                }
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AnimatedContent(
                        targetState = status,
                        transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) },
                        label = "status",
                    ) { text ->
                        Text(if (active) "$text…" else text, style = MaterialTheme.typography.labelLarge, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
                    }
                    if (detail.isNotEmpty()) {
                        Text(
                            detail,
                            style = if (current != null || latest is ToolCallBlock) Mono.copy(fontSize = 12.sp) else MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                // The status comes first when it's tight: the counts give way.
                Text(counts, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 120.dp))
            }
            AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    steps.forEach { step ->
                        when (val block = step.block) {
                            is ThinkingBlock -> Thought(block.thinking, step.live)
                            is TextBlock -> if (block.text.isNotBlank()) Markdown(block.text, options = MarkdownOptions(textStyle = MaterialTheme.typography.bodySmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)))
                            is ToolCallBlock -> ToolCard(sessionId, block, results[block.id], tools[block.id])
                            else -> Unit
                        }
                    }
                }
            }
        }
    }
}

/** A thought, folded until you tap it. */
@Composable
fun Thought(text: String, streaming: Boolean) {
    if (text.isBlank()) return
    var open by rememberSaveable { mutableStateOf(false) }
    val chevron by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(vertical = 4.dp, horizontal = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp).rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if (streaming) "Thinking…" else "Thought", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        AnimatedVisibility(open) {
            Row(Modifier.padding(start = 10.dp, top = 2.dp, bottom = 4.dp)) {
                Box(Modifier.size(width = 2.dp, height = 1.dp))
                Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

private val pretty = Json { prettyPrint = true }

/** One tool call: its name and main argument; open it for its arguments and output (and screenshots). */
@Composable
fun ToolCard(sessionId: String, call: ToolCallBlock, result: ToolResultMessage?, live: LiveTool?) {
    val app = LocalApp.current
    var open by rememberSaveable(call.id) { mutableStateOf(false) }
    val pending = result == null
    val running = pending && live?.status == "running"
    val output = result?.text ?: live?.output ?: ""
    val failed = result?.isError == true
    val onVm = call.name.startsWith("vm_")
    val chevron by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().testTag("tool-${call.name}")) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.size(16.dp).rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Icon(toolIcon(call.name), contentDescription = null, modifier = Modifier.size(16.dp), tint = if (failed) MaterialTheme.colorScheme.error else DexTheme.colors.success)
                Text(call.name, style = MaterialTheme.typography.labelLarge)
                Text(Tools.summarize(call.arguments), style = Mono.copy(fontSize = 12.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (onVm) {
                    TextButton(
                        onClick = { if (app.panes >= 3) app.navigator.open(ChatMachine(sessionId)) else app.navigator.open(Machine(sessionId)) },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp),
                        modifier = Modifier.heightIn(max = 28.dp),
                    ) { Text("watch", style = MaterialTheme.typography.labelSmall) }
                }
                when {
                    pending -> if (running || live == null) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp) else Unit
                    failed -> Text("failed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                }
            }
            result?.content?.filterIsInstance<ImageBlock>()?.forEach { image ->
                Screenshot(sessionId, image)
            }
            // A VM command's output streams in while it runs.
            if (onVm && pending && output.isNotEmpty() && !open) Output(output.takeLast(4_000), maxHeight = 192, error = false)
            AnimatedVisibility(open) {
                Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        pretty.encodeToString(JsonElement.serializer(), call.arguments),
                        style = Mono.copy(fontSize = 12.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.heightIn(max = 192.dp).verticalScroll(rememberScrollState()),
                    )
                    if (output.isNotEmpty()) Output(output, maxHeight = 384, error = failed)
                }
            }
        }
    }
}

@Composable
private fun Output(text: String, maxHeight: Int, error: Boolean) {
    val colors = DexTheme.colors
    SelectionContainer {
        Text(
            text,
            style = Mono.copy(fontSize = 12.sp, lineHeight = 17.sp),
            color = if (error) MaterialTheme.colorScheme.error else colors.codeText,
            softWrap = false,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp).clip(RoundedCornerShape(10.dp)).background(colors.codeBackground)
                .heightIn(max = maxHeight.dp).verticalScroll(rememberScrollState(), reverseScrolling = true).horizontalScroll(rememberScrollState())
                .padding(10.dp),
        )
    }
}

/** Screenshots seen this session, so reopening a step doesn't fetch again. */
private object ScreenshotCache {
    private val cache = object : LinkedHashMap<String, ImageBitmap>(40, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ImageBitmap>?) = size > 40
    }
    @Synchronized fun get(key: String) = cache[key]
    @Synchronized fun put(key: String, image: ImageBitmap) { cache[key] = image }
}

/**
 * An image from the transcript (a VM screenshot, or a photo attached to a message): shipped inline, or loaded when
 * shown (big ones are left out of the transcript). Null while loading; a failure or null bitmap if it can't be shown.
 */
@Composable
internal fun rememberTranscriptBitmap(sessionId: String, image: ImageBlock): Result<ImageBitmap?>? {
    val app = LocalApp.current
    val key = "$sessionId:${image.ref ?: image.data.hashCode()}"
    val bitmap by produceState<Result<ImageBitmap?>?>(initialValue = ScreenshotCache.get(key)?.let { Result.success(it) }, key) {
        if (value != null) return@produceState
        value = runCatching {
            val data = image.data.ifEmpty { image.ref?.let { app.graph.repository.api.transcriptImage(sessionId, it)?.data } ?: return@runCatching null }
            val bytes = Base64.decode(data, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()?.also { ScreenshotCache.put(key, it) }
        }
    }
    return bitmap
}

/** A VM screenshot: shipped with the step, or loaded when shown (big ones are left out of the transcript). */
@Composable
private fun Screenshot(sessionId: String, image: ImageBlock) {
    val bitmap = rememberTranscriptBitmap(sessionId, image)
    Box(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp).clip(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        val loaded = bitmap?.getOrNull()
        when {
            loaded != null -> Image(loaded, contentDescription = "VM screenshot", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth())
            bitmap == null -> Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp))
            }
            else -> Text("Screenshot unavailable", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
    }
}
