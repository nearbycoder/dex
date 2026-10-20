package dev.trydex.core.client

import dev.trydex.core.model.DexJson
import dev.trydex.core.model.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

@Serializable
data class DexUser(val id: String, val login: String, val name: String = login, val avatarUrl: String? = null)

/** A signed-in session: the server, the user, and the session token (the web's `dex_session` cookie value). */
@Serializable
data class DexSession(val server: String, val token: String, val user: DexUser, val expiresAt: Long) {
    val serverUrl: HttpUrl get() = server.toHttpUrlOrNull() ?: error("Bad server URL $server")
}

class AuthException(message: String, val status: Int? = null) : Exception(message)

/**
 * Native sign-in (apps/web/src/server/native-auth.ts): a PKCE handoff through the system browser.
 * 1. Make a verifier, open `/auth/native/start?challenge=…` in a Custom Tab.
 * 2. The user signs in as on the web and confirms; the browser comes back to `dex://auth/callback?code=…`.
 * 3. Trade the code and verifier at `POST /auth/native/token` for the ordinary session token.
 * The token goes out as `Cookie: dex_session=…`, so every check (activeViewer, Sign out everywhere) applies as on the web.
 */
object DexAuth {
    const val SESSION_COOKIE = "dex_session"
    const val CALLBACK_SCHEME = "dex"
    const val CALLBACK_HOST = "auth"
    const val CALLBACK_PATH = "/callback"
    const val USER_AGENT = "Dex-Android"

    /** Renew a token this long before it expires (tokens last 30 days). */
    const val RENEW_WITHIN_MS = 7L * 24 * 60 * 60 * 1000

    private const val VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    private val random = SecureRandom()
    private val json = "application/json".toMediaType()

    /** A random RFC 7636 verifier: 64 characters from the unreserved alphabet. */
    fun newVerifier(length: Int = 64): String {
        require(length in 43..128)
        return buildString(length) { repeat(length) { append(VERIFIER_ALPHABET[random.nextInt(VERIFIER_ALPHABET.length)]) } }
    }

    /** base64url(SHA-256(verifier)) without padding: 43 characters. */
    fun challenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    fun startUrl(server: HttpUrl, challenge: String): HttpUrl =
        server.newBuilder().encodedPath("/auth/native/start").query(null).addQueryParameter("challenge", challenge).build()

    /** The sign-in code from a `dex://auth/callback?code=…` link, or null if it isn't one. */
    fun callbackCode(uri: String): String? {
        val match = Regex("^dex://auth/callback\\?(.*)$").find(uri) ?: return null
        return match.groupValues[1].split('&').map { it.split('=', limit = 2) }.firstOrNull { it[0] == "code" }
            ?.getOrNull(1)?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
    }

    /**
     * Reads what the user typed as a server address: `trydex.dev`, `https://my.dex/`, or `http://localhost:5173` for
     * development. Anything other than https is accepted only for local addresses.
     */
    fun parseServer(input: String): HttpUrl? {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null
        val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
        val url = withScheme.toHttpUrlOrNull() ?: return null
        if (url.scheme == "http" && !isLocal(url.host)) return null
        return url.newBuilder().encodedPath("/").query(null).fragment(null).build()
    }

    private fun isLocal(host: String) =
        host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local")

    @Serializable
    private data class TokenResponse(val token: String, val user: DexUser, val expiresAt: Long)

    private fun Response.errorText(fallback: String): String =
        body.string().let { text -> runCatching { DexJson.parseToJsonElement(text).jsonObject["error"].str }.getOrNull() } ?: fallback

    private suspend fun post(client: OkHttpClient, request: Request): TokenResponse = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw AuthException(response.errorText("Sign-in failed (${response.code})."), response.code)
                }
                DexJson.decodeFromString(TokenResponse.serializer(), response.body.string())
            }
        } catch (error: IOException) {
            throw AuthException("Couldn't reach Dex. Check your connection and try again.")
        }
    }

    /** Trades the code from the callback (valid two minutes) and the verifier for a session. */
    suspend fun exchange(client: OkHttpClient, server: HttpUrl, code: String, verifier: String): DexSession {
        val body = buildJsonObject { put("code", code); put("verifier", verifier) }.toString().toRequestBody(json)
        val request = Request.Builder()
            .url(server.newBuilder().encodedPath("/auth/native/token").build())
            .header("User-Agent", USER_AGENT)
            .post(body)
            .build()
        val result = post(client, request)
        return DexSession(server.toString(), result.token, result.user, result.expiresAt)
    }

    /** Renews a still-valid session token. A 401 means it was revoked or has expired: sign in again. */
    suspend fun refresh(client: OkHttpClient, session: DexSession): DexSession {
        val server = session.serverUrl
        val request = Request.Builder()
            .url(server.newBuilder().encodedPath("/auth/native/refresh").build())
            .header("Cookie", "$SESSION_COOKIE=${session.token}")
            .header("User-Agent", USER_AGENT)
            .post(ByteArray(0).toRequestBody(null))
            .build()
        val result = post(client, request)
        return session.copy(token = result.token, user = result.user, expiresAt = result.expiresAt)
    }

    fun needsRenewal(session: DexSession, now: Long = System.currentTimeMillis()) = session.expiresAt - now < RENEW_WITHIN_MS

    /**
     * Whether the server still accepts the token (a socket the Worker refused doesn't always say why): `false` on 401,
     * `true` on success, null when the server can't be reached.
     */
    suspend fun sessionAccepted(client: OkHttpClient, session: DexSession): Boolean? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(session.serverUrl.newBuilder().encodedPath("/api/version").build())
            .header("Cookie", "$SESSION_COOKIE=${session.token}")
            .header("User-Agent", USER_AGENT)
            .build()
        try {
            client.newCall(request).execute().use { response ->
                when (response.code) {
                    401 -> false
                    in 200..299 -> true
                    else -> null
                }
            }
        } catch (_: IOException) {
            null
        }
    }
}

/**
 * Adds the session cookie to requests for the Dex server only (media, the desktop stream page), never to other
 * hosts: links in chats point anywhere, and the token must not travel with them.
 */
class DexCookieInterceptor(private val session: () -> DexSession?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val current = session() ?: return chain.proceed(request)
        val server = current.serverUrl
        val sameOrigin = request.url.host == server.host && request.url.port == server.port && request.url.scheme == server.scheme
        if (!sameOrigin || request.header("Cookie") != null) return chain.proceed(request)
        return chain.proceed(request.newBuilder().header("Cookie", "${DexAuth.SESSION_COOKIE}=${current.token}").build())
    }
}
