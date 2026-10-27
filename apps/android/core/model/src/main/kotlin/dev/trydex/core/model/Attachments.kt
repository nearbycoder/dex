package dev.trydex.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/*
 * Files attached to a chat message (apps/web/src/shared/attachments.ts). `POST /api/attachments` turns an upload into a
 * ChatAttachment (an image prepared for the model, or a file's text); the app sends it back unchanged with the message,
 * and the agent writes each one into the message as an `<attachment …>` tag. Apps show those tags as chips.
 */

/** An attachment as the server prepared it. Kept as its JSON, so it goes back to `sendMessage` exactly as it came. */
data class ChatAttachment(val json: JsonObject) {
    /** `image` or `text`. */
    val kind: String get() = json["kind"].str ?: "text"
    val name: String get() = json["name"].str ?: "file"
    val mimeType: String get() = json["mimeType"].str ?: "application/octet-stream"
    /** An image's base64. */
    val data: String? get() = json["data"].str
}

object AttachmentLimits {
    /** Files per message. */
    const val FILES = 10
    /** An upload's size before the server prepares it. */
    const val UPLOAD_BYTES = 25L * 1024 * 1024
}

/** A file named in a message: what the apps show for it. */
@Serializable
data class AttachedFile(val name: String = "file", val mimeType: String = "application/octet-stream")

private val TAG = Regex("""<attachment ((?:[a-z]+="[^"]*"\s*)+)(?:/>|>\n?[\s\S]*?\n?</attachment>)""")
private val ATTRIBUTE = Regex("""([a-z]+)="([^"]*)"""")

private fun unescapeAttribute(value: String) =
    value.replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

/** A message's text without its attachment tags, and the files they name (splitAttachments on the web). */
fun splitAttachments(text: String): Pair<String, List<AttachedFile>> {
    val files = mutableListOf<AttachedFile>()
    val rest = TAG.replace(text) { match ->
        val values = ATTRIBUTE.findAll(match.groupValues[1]).associate { it.groupValues[1] to unescapeAttribute(it.groupValues[2]) }
        files += AttachedFile(values["name"] ?: "file", values["type"] ?: "application/octet-stream")
        ""
    }
    return if (files.isEmpty()) text to files else rest.replace(Regex("\n{3,}"), "\n\n").trim() to files
}

/** A short line naming the attachments, for a pending or queued message that has no text. */
fun attachmentSummary(names: List<String>): String = when (names.size) {
    0 -> ""
    1 -> names[0]
    else -> "${names[0]} and ${names.size - 1} more"
}
