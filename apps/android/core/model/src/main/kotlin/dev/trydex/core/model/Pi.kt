package dev.trydex.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.builtins.ListSerializer

/*
 * Pi Durable's transcript as the app reads it: entries holding pi-ai messages, whose content is text, thinking, tool
 * calls, and images. Types the app doesn't know (newer Pi versions) decode as `Other*` and are skipped when shown.
 */

@Serializable(with = ContentBlockSerializer::class)
sealed interface ContentBlock

@Serializable
data class TextBlock(val type: String = "text", val text: String = "") : ContentBlock

@Serializable
data class ThinkingBlock(val type: String = "thinking", val thinking: String = "", val redacted: Boolean = false) : ContentBlock

@Serializable
data class ToolCallBlock(
    val type: String = "toolCall",
    val id: String = "",
    val name: String = "",
    val arguments: JsonObject = JsonObject(emptyMap()),
    val argumentsError: String? = null,
) : ContentBlock

/** An image. Large ones arrive without `data` and with a `ref` the app loads them by (DexAgent.transcriptImage). */
@Serializable
data class ImageBlock(val type: String = "image", val data: String = "", val mimeType: String = "image/png", val ref: String? = null) : ContentBlock

@Serializable
data class OtherBlock(val type: String = "") : ContentBlock

object ContentBlockSerializer : JsonContentPolymorphicSerializer<ContentBlock>(ContentBlock::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out ContentBlock> = when (element.jsonObject["type"].str) {
        "text" -> TextBlock.serializer()
        "thinking" -> ThinkingBlock.serializer()
        "toolCall" -> ToolCallBlock.serializer()
        "image" -> ImageBlock.serializer()
        else -> OtherBlock.serializer()
    }
}

/** A user message's content may be a plain string: read it as one text block. */
object UserContentSerializer : JsonTransformingSerializer<List<ContentBlock>>(ListSerializer(ContentBlockSerializer)) {
    override fun transformDeserialize(element: JsonElement): JsonElement =
        if (element is JsonPrimitive) buildJsonArray { add(buildJsonObject { put("type", "text"); put("text", element.content) }) } else element
}

@Serializable(with = PiMessageSerializer::class)
sealed interface PiMessage {
    val role: String
}

@Serializable
data class UserMessage(
    override val role: String = "user",
    @Serializable(with = UserContentSerializer::class) val content: List<ContentBlock> = emptyList(),
    val timestamp: Long = 0,
) : PiMessage {
    val text: String get() = content.filterIsInstance<TextBlock>().joinToString("\n") { it.text }
    val imageCount: Int get() = content.count { it is ImageBlock }
}

@Serializable
data class AssistantMessage(
    override val role: String = "assistant",
    val content: List<ContentBlock> = emptyList(),
    val model: String = "",
    val provider: String = "",
    /** pending, stop, length, toolUse, error, aborted, or deferred. */
    val stopReason: String = "stop",
    val errorMessage: String? = null,
    val timestamp: Long = 0,
    val durationMs: Long? = null,
) : PiMessage

@Serializable
data class ToolResultMessage(
    override val role: String = "toolResult",
    val toolCallId: String = "",
    val toolName: String = "",
    @Serializable(with = UserContentSerializer::class) val content: List<ContentBlock> = emptyList(),
    val details: JsonElement? = null,
    val isError: Boolean = false,
    val timestamp: Long = 0,
) : PiMessage {
    /** The result as text, with images as "[image]" (resultText on the web). */
    val text: String get() = content.joinToString("\n") { if (it is TextBlock) it.text else "[image]" }
}

@Serializable
data class OtherMessage(override val role: String = "") : PiMessage

object PiMessageSerializer : JsonContentPolymorphicSerializer<PiMessage>(PiMessage::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out PiMessage> = when (element.jsonObject["role"].str) {
        "user" -> UserMessage.serializer()
        "assistant" -> AssistantMessage.serializer()
        "toolResult" -> ToolResultMessage.serializer()
        else -> OtherMessage.serializer()
    }
}

/** One transcript entry: `pi.user`, `pi.assistant`, `pi.toolResult`, `pi.reset`, `pi.compaction`, `pi.system`, … */
@Serializable
data class EntryRecord(
    val id: Long,
    val kind: String = "",
    val model: List<PiMessage>? = null,
)

/** A running tool call's live slot (pi.live), as the activity row shows it. */
@Serializable
data class LiveTool(
    val callId: String,
    val name: String = "tool",
    /** pending, running, or done. */
    val status: String = "running",
    val args: JsonObject? = null,
    val output: String = "",
    val details: JsonElement? = null,
)

@Serializable
data class RetryInfo(val at: Long = 0, val error: String = "")

data class SnapshotEvent(
    val entries: List<EntryRecord>,
    val running: Boolean,
    val streaming: AssistantMessage?,
    val retry: RetryInfo?,
    val tools: List<LiveTool>,
    val queued: Int,
)

/** One change to the in-flight assistant message (MessageChange in pi-durable). */
sealed interface MessageChange {
    data class SetBlock(val contentIndex: Int, val block: ContentBlock) : MessageChange
    data class TextDelta(val contentIndex: Int, val delta: String) : MessageChange
    data class ThinkingDelta(val contentIndex: Int, val delta: String) : MessageChange
    data class ToolCallDelta(val contentIndex: Int, val path: List<JsonPrimitive>, val delta: String) : MessageChange
    data class Replace(val message: AssistantMessage) : MessageChange
}

/** The agent events the app folds into a transcript (AgentEvent in pi-durable); the rest are `Other`. */
sealed interface AgentEvent {
    data class Snapshot(val snapshot: SnapshotEvent) : AgentEvent
    data object RunStart : AgentEvent
    data object RunEnd : AgentEvent
    data class MessageStart(val message: PiMessage) : AgentEvent
    data class MessageUpdate(val changes: List<MessageChange>) : AgentEvent
    data class MessageEnd(val entry: EntryRecord) : AgentEvent
    data class EntryAppended(val entry: EntryRecord) : AgentEvent
    data class ToolStart(val callId: String, val name: String, val parent: String?, val args: JsonObject?) : AgentEvent
    data class ToolUpdate(
        val callId: String,
        val name: String,
        val parent: String?,
        val set: String?,
        val trimStart: Int?,
        val append: String?,
        val details: JsonElement?,
    ) : AgentEvent
    data class ToolEnd(val callId: String, val name: String, val parent: String?, val entry: EntryRecord?) : AgentEvent
    data class InboxUpdate(val count: Int) : AgentEvent
    data class AutoRetryStart(val at: Long, val error: String) : AgentEvent
    data object AutoRetryEnd : AgentEvent
    data class TaskFailed(val message: String) : AgentEvent
    data class Other(val type: String) : AgentEvent
}

object PiCodec {
    private fun entry(element: JsonElement?): EntryRecord? =
        element?.obj?.let { runCatching { DexJson.decodeFromJsonElement(EntryRecord.serializer(), it) }.getOrNull() }

    private fun message(element: JsonElement?): PiMessage? =
        element?.obj?.let { runCatching { DexJson.decodeFromJsonElement(PiMessageSerializer, it) }.getOrNull() }

    private fun block(element: JsonElement?): ContentBlock? =
        element?.obj?.let { runCatching { DexJson.decodeFromJsonElement(ContentBlockSerializer, it) }.getOrNull() }

    fun snapshot(json: JsonObject): SnapshotEvent {
        val generation = json["generation"].obj
        return SnapshotEvent(
            entries = json["entries"].arr?.mapNotNull { entry(it) } ?: emptyList(),
            running = json["run"].obj != null,
            streaming = message(generation?.get("message")) as? AssistantMessage,
            retry = generation?.get("retry").obj?.let { RetryInfo(it["at"].long ?: 0, it["error"].str ?: "") },
            tools = json["tools"].arr?.mapNotNull { slot ->
                val callId = slot["callId"].str ?: return@mapNotNull null
                LiveTool(
                    callId = callId,
                    name = slot["name"].str ?: "tool",
                    status = slot["status"].str ?: "running",
                    output = slot["output"].str ?: "",
                    details = slot["details"],
                )
            } ?: emptyList(),
            queued = json["inbox"].arr?.size ?: 0,
        )
    }

    private fun change(json: JsonObject): MessageChange? {
        val index = json["contentIndex"].long?.toInt() ?: 0
        return when (json["type"].str) {
            "text_start", "thinking_start", "toolcall_start", "block" -> block(json["block"])?.let { MessageChange.SetBlock(index, it) }
            "text_delta" -> MessageChange.TextDelta(index, json["delta"].str ?: "")
            "thinking_delta" -> MessageChange.ThinkingDelta(index, json["delta"].str ?: "")
            "toolcall_delta" -> MessageChange.ToolCallDelta(
                index,
                json["path"].arr?.mapNotNull { it as? JsonPrimitive } ?: emptyList(),
                json["delta"].str ?: "",
            )
            "message" -> (message(json["message"]) as? AssistantMessage)?.let { MessageChange.Replace(it) }
            else -> null
        }
    }

    fun event(json: JsonObject): AgentEvent {
        val type = json["type"].str ?: ""
        val callId = json["toolCallId"].str ?: ""
        val toolName = json["toolName"].str ?: "tool"
        val parent = json["parentToolCallId"].str
        return when (type) {
            "snapshot" -> AgentEvent.Snapshot(snapshot(json))
            "run_start" -> AgentEvent.RunStart
            "run_end" -> AgentEvent.RunEnd
            "message_start" -> message(json["message"])?.let { AgentEvent.MessageStart(it) } ?: AgentEvent.Other(type)
            "message_update" -> AgentEvent.MessageUpdate(json["changes"].arr?.mapNotNull { it.obj?.let(::change) } ?: emptyList())
            "message_end" -> entry(json["entry"])?.let { AgentEvent.MessageEnd(it) } ?: AgentEvent.Other(type)
            "entry_appended" -> entry(json["entry"])?.let { AgentEvent.EntryAppended(it) } ?: AgentEvent.Other(type)
            "tool_execution_start" -> AgentEvent.ToolStart(callId, toolName, parent, json["args"].obj)
            "tool_execution_update" -> {
                val output = json["output"].obj
                AgentEvent.ToolUpdate(
                    callId, toolName, parent,
                    set = output?.get("set").str,
                    trimStart = output?.get("trimStart").long?.toInt(),
                    append = output?.get("append").str,
                    details = json["details"],
                )
            }
            "tool_execution_end" -> AgentEvent.ToolEnd(callId, toolName, parent, entry(json["entry"]))
            "inbox_update" -> AgentEvent.InboxUpdate(json["items"].arr?.size ?: 0)
            "auto_retry_start" -> AgentEvent.AutoRetryStart(json["at"].long ?: 0, json["errorMessage"].str ?: "")
            "auto_retry_end" -> AgentEvent.AutoRetryEnd
            "task_failed" -> AgentEvent.TaskFailed(json["message"].str ?: "")
            else -> AgentEvent.Other(type)
        }
    }

    fun events(array: JsonArray?): List<AgentEvent> = array?.mapNotNull { it.obj?.let(::event) } ?: emptyList()
}
