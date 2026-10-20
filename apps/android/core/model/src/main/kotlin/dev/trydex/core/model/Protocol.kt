package dev.trydex.core.model

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Messages the agent sends over its socket besides state and RPC (ServerMessage in apps/web/src/shared/protocol.ts). */
sealed interface ServerMessage {
    val sessionId: String?

    data class Snapshot(override val sessionId: String, val snapshot: SnapshotEvent) : ServerMessage
    data class Events(override val sessionId: String, val events: List<AgentEvent>) : ServerMessage
    data class Error(override val sessionId: String?, val message: String) : ServerMessage
    data class Queue(override val sessionId: String, val items: List<QueuedMessage>, val held: Boolean) : ServerMessage
    data class Artifacts(override val sessionId: String, val artifacts: List<ChatArtifact>, val saving: List<String>) : ServerMessage
    data class VmActivityUpdate(val vmKey: String, val activity: VmActivity) : ServerMessage {
        override val sessionId: String? get() = null
    }
    data class VmOutput(val vmKey: String, val id: Long, val data: String) : ServerMessage {
        override val sessionId: String? get() = null
    }

    companion object {
        /** Reads a `dex.*` frame, or null for anything else (unknown types from a newer agent included). */
        fun parse(json: JsonObject): ServerMessage? {
            val sessionId = json["sessionId"].str
            return when (json["type"].str) {
                "dex.snapshot" -> json["snapshot"].obj?.let { Snapshot(sessionId ?: return null, PiCodec.snapshot(it)) }
                "dex.events" -> Events(sessionId ?: return null, PiCodec.events(json["events"].arr))
                "dex.error" -> Error(sessionId, json["message"].str ?: "Something went wrong")
                "dex.queue" -> Queue(
                    sessionId ?: return null,
                    json["items"]?.let { DexJson.decodeFromJsonElement(ListSerializer(QueuedMessage.serializer()), it) } ?: emptyList(),
                    json["held"].bool ?: false,
                )
                "dex.artifacts" -> Artifacts(
                    sessionId ?: return null,
                    json["artifacts"]?.let { DexJson.decodeFromJsonElement(ListSerializer(ChatArtifact.serializer()), it) } ?: emptyList(),
                    json["saving"]?.let { DexJson.decodeFromJsonElement(ListSerializer(String.serializer()), it) } ?: emptyList(),
                )
                "dex.vm.activity" -> VmActivityUpdate(
                    json["vmKey"].str ?: return null,
                    json["activity"]?.let { DexJson.decodeFromJsonElement(VmActivity.serializer(), it) } ?: return null,
                )
                "dex.vm.output" -> VmOutput(json["vmKey"].str ?: return null, json["id"].long ?: return null, json["data"].str ?: "")
                else -> null
            }
        }
    }
}

/** Messages the app sends beside RPC calls (ClientMessage). */
object ClientMessages {
    fun subscribe(sessionId: String): JsonObject = buildJsonObject { put("type", "dex.subscribe"); put("sessionId", sessionId) }
    fun unsubscribe(): JsonObject = buildJsonObject { put("type", "dex.unsubscribe") }

    /** Sent every 20 s: re-opens the event stream if the agent was evicted since. */
    fun ping(sessionId: String?): JsonObject = buildJsonObject { put("type", "dex.ping"); put("sessionId", sessionId) }

    /** Whether Dex is on screen here, and which chat: notifications skip what you're looking at. */
    fun presence(visible: Boolean, sessionId: String?): JsonObject =
        buildJsonObject { put("type", "dex.presence"); put("visible", visible); put("sessionId", sessionId) }
}

/** What a chat's generated UI gets back from an operation (UiOperationResult). */
sealed interface UiOperationResult {
    data class Ok(val result: kotlinx.serialization.json.JsonElement?, val changed: String?) : UiOperationResult
    data class Failed(val error: String) : UiOperationResult
    /** An admin operation: run it again with `confirmed` once the user agrees to `summary`. */
    data class Confirm(val summary: String) : UiOperationResult

    companion object {
        fun parse(json: kotlinx.serialization.json.JsonElement?): UiOperationResult {
            val obj = json.obj ?: return Failed("The operation returned nothing.")
            val ok = obj["ok"]
            return when {
                ok.str == "confirm" -> Confirm(obj["summary"].str ?: "")
                ok.bool == true -> Ok(obj["result"], obj["changed"].str)
                else -> Failed(obj["error"].str ?: "The operation failed.")
            }
        }
    }
}
