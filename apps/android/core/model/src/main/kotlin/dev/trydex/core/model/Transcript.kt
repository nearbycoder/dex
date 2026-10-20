package dev.trydex.core.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** One chat as the app shows it, folded from Pi's snapshot and event batches (TranscriptState on the web). */
data class TranscriptState(
    val entries: List<EntryRecord> = emptyList(),
    /** The assistant message being streamed, if any. */
    val streaming: AssistantMessage? = null,
    val tools: Map<String, LiveTool> = emptyMap(),
    val running: Boolean = false,
    val queued: Int = 0,
    val retry: RetryInfo? = null,
    val error: String? = null,
    /** The agent has sent this chat's snapshot (or it came from the device's copy). */
    val loaded: Boolean = false,
    val artifacts: List<ChatArtifact> = emptyList(),
    val savingArtifacts: List<String> = emptyList(),
    /** Dex's queue: messages waiting for the run to end, next first; held after you stopped the chat. */
    val queue: List<QueuedMessage> = emptyList(),
    val queueHeld: Boolean = false,
) {
    /** How many user messages the agent has recorded (the pending-message bookkeeping counts these). */
    val userCount: Int get() = entries.count { it.kind == "pi.user" }

    companion object {
        val Empty = TranscriptState()
    }
}

object TranscriptReducer {
    fun fromSnapshot(snapshot: SnapshotEvent, previous: TranscriptState = TranscriptState.Empty) = TranscriptState(
        entries = snapshot.entries,
        streaming = snapshot.streaming,
        tools = snapshot.tools.associateBy { it.callId },
        running = snapshot.running,
        queued = snapshot.queued,
        retry = snapshot.retry,
        error = null,
        loaded = true,
        // Sent right after the snapshot; keep what's known until then.
        artifacts = previous.artifacts,
        savingArtifacts = previous.savingArtifacts,
        queue = previous.queue,
        queueHeld = previous.queueHeld,
    )

    private fun append(entries: List<EntryRecord>, entry: EntryRecord) =
        if (entries.any { it.id == entry.id }) entries else entries + entry

    private fun updateTool(state: TranscriptState, callId: String, name: String, update: (LiveTool) -> LiveTool): TranscriptState {
        val current = state.tools[callId] ?: LiveTool(callId = callId, name = name, status = "running")
        return state.copy(tools = state.tools + (callId to update(current)))
    }

    fun apply(state: TranscriptState, event: AgentEvent): TranscriptState = when (event) {
        is AgentEvent.Snapshot -> fromSnapshot(event.snapshot)
        AgentEvent.RunStart -> state.copy(running = true, error = null)
        AgentEvent.RunEnd -> state.copy(running = false, streaming = null, tools = emptyMap(), retry = null)
        is AgentEvent.MessageStart -> (event.message as? AssistantMessage)?.let { state.copy(streaming = it) } ?: state
        is AgentEvent.MessageUpdate -> state.streaming?.let { state.copy(streaming = applyChanges(it, event.changes)) } ?: state
        is AgentEvent.MessageEnd -> state.copy(streaming = null, entries = append(state.entries, event.entry))
        is AgentEvent.EntryAppended -> state.copy(entries = append(state.entries, event.entry))
        is AgentEvent.ToolStart ->
            if (event.parent != null) state
            else updateTool(state, event.callId, event.name) { it.copy(name = event.name, status = "running", args = event.args) }
        is AgentEvent.ToolUpdate ->
            if (event.parent != null) state
            else updateTool(state, event.callId, event.name) { tool ->
                val output = when {
                    event.set != null -> event.set
                    event.trimStart != null || event.append != null ->
                        tool.output.drop((event.trimStart ?: 0).coerceAtLeast(0)) + (event.append ?: "")
                    else -> tool.output
                }
                tool.copy(output = output, details = event.details ?: tool.details)
            }
        is AgentEvent.ToolEnd ->
            if (event.parent != null) state
            else {
                val withTool = updateTool(state, event.callId, event.name) { it.copy(status = "done") }
                event.entry?.let { withTool.copy(entries = append(withTool.entries, it)) } ?: withTool
            }
        is AgentEvent.InboxUpdate -> state.copy(queued = event.count)
        is AgentEvent.AutoRetryStart -> state.copy(retry = RetryInfo(event.at, event.error))
        AgentEvent.AutoRetryEnd -> state.copy(retry = null)
        is AgentEvent.TaskFailed -> state.copy(error = event.message)
        is AgentEvent.Other -> state
    }

    fun applyAll(state: TranscriptState, events: List<AgentEvent>): TranscriptState = events.fold(state, ::apply)

    fun applyChanges(message: AssistantMessage, changes: List<MessageChange>): AssistantMessage {
        var content = message.content.toMutableList()
        fun set(index: Int, block: ContentBlock) {
            while (content.size <= index) content.add(OtherBlock())
            content[index] = block
        }
        for (change in changes) {
            when (change) {
                is MessageChange.Replace -> return change.message
                is MessageChange.SetBlock -> set(change.contentIndex, change.block)
                is MessageChange.TextDelta -> (content.getOrNull(change.contentIndex) as? TextBlock)?.let {
                    content[change.contentIndex] = it.copy(text = it.text + change.delta)
                }
                is MessageChange.ThinkingDelta -> (content.getOrNull(change.contentIndex) as? ThinkingBlock)?.let {
                    content[change.contentIndex] = it.copy(thinking = it.thinking + change.delta)
                }
                is MessageChange.ToolCallDelta -> (content.getOrNull(change.contentIndex) as? ToolCallBlock)?.let {
                    content[change.contentIndex] = it.copy(arguments = appendAtPath(it.arguments, change.path, change.delta))
                }
            }
        }
        return message.copy(content = content)
    }

    /** Appends `delta` to the string at `path` inside `target`, creating objects on the way (appendAtPath on the web). */
    fun appendAtPath(target: JsonObject, path: List<JsonPrimitive>, delta: String): JsonObject {
        if (path.isEmpty()) return target
        fun key(primitive: JsonPrimitive) = if (primitive.isString) primitive.content else primitive.intOrNull?.toString() ?: primitive.content
        fun go(node: JsonObject, depth: Int): JsonObject {
            val name = key(path[depth])
            val next: JsonElement = if (depth == path.lastIndex) {
                val current = node[name].str ?: ""
                JsonPrimitive(current + delta)
            } else {
                go(node[name] as? JsonObject ?: JsonObject(emptyMap()), depth + 1)
            }
            return JsonObject(node + (name to next))
        }
        return go(target, 0)
    }
}

/** Tool results by call id, across the transcript. */
fun toolResults(entries: List<EntryRecord>): Map<String, ToolResultMessage> = buildMap {
    for (entry in entries) for (message in entry.model.orEmpty()) if (message is ToolResultMessage) put(message.toolCallId, message)
}

sealed interface DisplayItem {
    val id: String

    data class User(override val id: String, val text: String, val images: Int) : DisplayItem

    /** One reply: the assistant messages between two user messages, the last one possibly still streaming. */
    data class Assistant(
        override val id: String,
        val messages: List<AssistantMessage>,
        val streaming: Boolean,
        val endedAt: Long?,
    ) : DisplayItem

    data class Divider(override val id: String, val label: String) : DisplayItem
}

/** The transcript as rows: user messages, replies (consecutive assistant messages), and context dividers. */
fun displayItems(state: TranscriptState): List<DisplayItem> {
    val items = mutableListOf<DisplayItem>()
    fun addAssistant(id: String, message: AssistantMessage, streaming: Boolean) {
        val last = items.lastOrNull()
        val ended = if (streaming) null else message.timestamp + (message.durationMs ?: 0)
        if (last is DisplayItem.Assistant) {
            items[items.lastIndex] = last.copy(messages = last.messages + message, streaming = streaming, endedAt = ended ?: last.endedAt)
        } else {
            items += DisplayItem.Assistant(id, listOf(message), streaming, ended)
        }
    }
    for (entry in state.entries) {
        when (entry.kind) {
            "pi.reset" -> items += DisplayItem.Divider(entry.id.toString(), "Context reset")
            "pi.compaction" -> items += DisplayItem.Divider(entry.id.toString(), "Earlier messages summarized")
        }
        entry.model.orEmpty().forEachIndexed { index, message ->
            val id = "${entry.id}:$index"
            when (message) {
                is UserMessage -> items += DisplayItem.User(id, message.text, message.imageCount)
                is AssistantMessage -> addAssistant(id, message, false)
                is ToolResultMessage -> {
                    val last = items.lastOrNull()
                    if (last is DisplayItem.Assistant) items[items.lastIndex] = last.copy(endedAt = maxOf(last.endedAt ?: 0, message.timestamp))
                }
                is OtherMessage -> Unit
            }
        }
    }
    state.streaming?.let { addAssistant("streaming", it, true) }
    return items
}
