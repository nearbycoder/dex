package dev.trydex.core.client

import dev.trydex.core.model.AttachmentLimits
import dev.trydex.core.model.ChatAttachment
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** Why a file couldn't be attached; `status` is the server's (401: the session ended; 503: try again soon). */
class AttachmentException(message: String, val status: Int? = null) : Exception(message)

/**
 * `POST /api/attachments` (apps/web/src/routes/api.attachments.ts): sends one file, which comes back prepared for the
 * model (an image scaled to fit, or a file's text). Nothing is stored; the result goes with the message.
 */
object DexUploads {
    suspend fun upload(client: OkHttpClient, session: DexSession, bytes: ByteArray, name: String, mimeType: String): ChatAttachment =
        withContext(Dispatchers.IO) {
            if (bytes.size > AttachmentLimits.UPLOAD_BYTES) {
                throw AttachmentException("$name is too large (limit ${AttachmentLimits.UPLOAD_BYTES / 1024 / 1024} MB).", 413)
            }
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", name, bytes.toRequestBody(mimeType.toMediaTypeOrNull()))
                .build()
            val request = Request.Builder()
                .url(session.serverUrl.newBuilder().encodedPath("/api/attachments").build())
                .header("Cookie", "${DexAuth.SESSION_COOKIE}=${session.token}")
                .header("User-Agent", DexAuth.USER_AGENT)
                .post(body)
                .build()
            val response = try {
                client.newCall(request).execute()
            } catch (error: IOException) {
                throw AttachmentException("Couldn't reach Dex: ${error.message ?: "network error"}")
            }
            response.use {
                val text = it.body.string()
                val json = runCatching { DexJson.parseToJsonElement(text) as? JsonObject }.getOrNull()
                if (!it.isSuccessful || json == null) {
                    val message = json?.get("error").str ?: when (it.code) {
                        401 -> "Sign in again"
                        503 -> "Dex is restarting. Try again in a moment."
                        else -> "Upload failed (${it.code})."
                    }
                    throw AttachmentException(message, it.code)
                }
                ChatAttachment(json)
            }
        }
}
