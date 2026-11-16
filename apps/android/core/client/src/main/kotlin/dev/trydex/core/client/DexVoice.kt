package dev.trydex.core.client

import dev.trydex.core.model.DexJson
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.Voices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import kotlin.coroutines.coroutineContext

/** Why the voice couldn't be had; `status` is the server's (401: sign in again; 503: try again shortly). */
class VoiceException(message: String, val status: Int? = null) : Exception(message)

/**
 * A call's two endpoints (apps/web/src/routes/api.voice.*): the text-to-speech model's file, downloaded once, and the
 * phoneme ids it reads for some text. Both signed in with the session cookie and no Origin.
 */
object DexVoice {
    /**
     * `POST /api/voice/phonemes`: each sentence of [text] (up to 4,000 characters) as utterances the model reads. A
     * 503 means the agent is restarting onto a new build: it asks again shortly, a couple of times.
     */
    suspend fun phonemes(client: OkHttpClient, session: DexSession, text: String, retries: Int = 2): PhonemesResponse = withContext(Dispatchers.IO) {
        val body = buildJsonObject { put("text", text.take(Voices.MAX_SPOKEN_CHARS)) }.toString()
        val request = Request.Builder()
            .url(session.serverUrl.newBuilder().encodedPath("/api/voice/phonemes").build())
            .header("Cookie", "${DexAuth.SESSION_COOKIE}=${session.token}")
            .header("User-Agent", DexAuth.USER_AGENT)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        var attempt = 0
        while (true) {
            val (code, text) = try {
                client.newCall(request).execute().use { it.code to it.body.string() }
            } catch (error: IOException) {
                throw VoiceException("Couldn't reach Dex: ${error.message ?: "network error"}")
            }
            when {
                code in 200..299 -> return@withContext runCatching { DexJson.decodeFromString(PhonemesResponse.serializer(), text) }
                    .getOrElse { throw VoiceException("Dex sent something unexpected.", code) }
                code == 503 && attempt < retries -> {
                    attempt++
                    kotlinx.coroutines.delay(1_000L * attempt)
                }
                code == 401 -> throw VoiceException("Sign in again to use calls.", 401)
                else -> throw VoiceException("Their voice isn't available right now.", code)
            }
        }
        @Suppress("UNREACHABLE_CODE")
        throw IllegalStateException()
    }

    /** The model file for this revision of tiny-voca, in [dir]. */
    fun modelFile(dir: File) = File(dir, "tiny-voca-${Voices.modelVersion}.onnx")

    /**
     * The model on the device, downloading it the first time (`GET /api/voice/model/model.onnx`, about 21 MB) with
     * [onProgress] from 0 to 1. Kept in [dir] under its revision; other revisions' files there are deleted.
     */
    suspend fun model(client: OkHttpClient, session: DexSession, dir: File, onProgress: (Float) -> Unit = {}): File = withContext(Dispatchers.IO) {
        val file = modelFile(dir)
        dir.listFiles()?.filter { it.name != file.name }?.forEach { it.delete() }
        if (file.isFile && file.length() > 0) return@withContext file
        dir.mkdirs()
        val part = File(dir, "${file.name}.part")
        val url = session.serverUrl.newBuilder().encodedPath("/api/voice/model/model.onnx").addQueryParameter("v", Voices.modelVersion).build()
        val request = Request.Builder()
            .url(url)
            .header("Cookie", "${DexAuth.SESSION_COOKIE}=${session.token}")
            .header("User-Agent", DexAuth.USER_AGENT)
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw VoiceException(if (response.code == 401) "Sign in again to use calls." else "Couldn't download the voice (${response.code}).", response.code)
                }
                val total = response.body.contentLength()
                var loaded = 0L
                var reported = -1
                part.outputStream().use { out ->
                    response.body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            coroutineContext.ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            loaded += read
                            // A report for each whole percent, not each read.
                            if (total > 0) {
                                val percent = (loaded * 100 / total).toInt()
                                if (percent != reported) {
                                    reported = percent
                                    onProgress(loaded.toFloat() / total)
                                }
                            }
                        }
                    }
                }
                if (total > 0 && loaded != total) throw VoiceException("The voice's download was cut short. Try again.")
            }
            if (!part.renameTo(file)) throw VoiceException("Couldn't save the voice.")
            file
        } catch (error: IOException) {
            throw VoiceException("Couldn't download the voice: ${error.message ?: "network error"}")
        } finally {
            part.delete()
        }
    }
}
