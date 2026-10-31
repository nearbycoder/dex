package dev.trydex.core.client

import dev.trydex.core.model.DexJson
import dev.trydex.core.model.WidgetSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/** Why the widgets' snapshot couldn't be read; `status` is the server's (401: sign in again). */
class SidekicksException(message: String, val status: Int? = null) : Exception(message)

/**
 * `GET /api/sidekicks` (apps/web/src/routes/api.sidekicks.ts): your sidekicks for the home-screen widgets, read with the
 * session cookie and no Origin, so they stay current without the app open. A 503 means the agent is restarting onto a
 * new build: it asks again shortly (after `retry-after`), a couple of times.
 */
object DexSidekicks {
    suspend fun fetch(client: OkHttpClient, session: DexSession, images: Boolean = true, retries: Int = 2): WidgetSnapshot =
        withContext(Dispatchers.IO) {
            val url = session.serverUrl.newBuilder().encodedPath("/api/sidekicks").apply { if (!images) addQueryParameter("images", "0") }.build()
            val request = Request.Builder()
                .url(url)
                .header("Cookie", "${DexAuth.SESSION_COOKIE}=${session.token}")
                .header("User-Agent", DexAuth.USER_AGENT)
                .get()
                .build()
            var attempt = 0
            while (true) {
                val response = try {
                    client.newCall(request).execute()
                } catch (error: IOException) {
                    throw SidekicksException("Couldn't reach Dex: ${error.message ?: "network error"}")
                }
                val (code, text, retryAfter) = response.use { Triple(it.code, it.body.string(), it.header("retry-after")?.toLongOrNull()) }
                when {
                    code in 200..299 -> return@withContext runCatching { DexJson.decodeFromString(WidgetSnapshot.serializer(), text) }
                        .getOrElse { throw SidekicksException("Dex sent something unexpected.", code) }
                    code == 503 && attempt < retries -> {
                        attempt++
                        delay((retryAfter ?: 2).coerceIn(1, 10) * 1_000)
                    }
                    code == 401 -> throw SidekicksException("Sign in again", 401)
                    else -> throw SidekicksException("Dex answered $code.", code)
                }
            }
            @Suppress("UNREACHABLE_CODE")
            throw IllegalStateException()
        }
}
