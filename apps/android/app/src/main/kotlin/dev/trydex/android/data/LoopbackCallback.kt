package dev.trydex.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI

/**
 * Catches a sign-in redirect to a loopback address on this device: Sign in with ChatGPT sends the browser back to
 * `http://127.0.0.1:1455/auth/callback?code=…` only (apps/web/src/agent/chatgpt.ts). Dex's server can't receive it,
 * but the app can listen there while the sign-in page is open, take the address, and send the browser on to
 * `dex://chatgpt/signed-in`, which brings Dex back to the front.
 */
class LoopbackCallback private constructor(private val server: ServerSocket, private val base: String, private val path: String) : Closeable {
    /** The full address the browser landed on, or null when nothing arrived in time. */
    suspend fun await(timeoutMs: Long = 10 * 60_000L): String? = withTimeoutOrNull(timeoutMs) {
        withContext(Dispatchers.IO) {
            // A short accept timeout so cancelling (Cancel, leaving the screen) is noticed within a moment.
            server.soTimeout = 250
            var address: String? = null
            while (address == null) {
                ensureActive()
                val socket = try {
                    server.accept()
                } catch (_: SocketTimeoutException) {
                    continue
                }
                address = socket.use { answer(it) }
            }
            address
        }
    }

    /** Answers one request: the callback gets the hand-off page and its address; anything else (a favicon) a 404. */
    private fun answer(socket: Socket): String? {
        socket.soTimeout = 5_000
        val target = runCatching { requestTarget(readHead(socket)) }.getOrNull()
        val matches = target != null && target.startsWith(path) && (target.length == path.length || target[path.length] == '?')
        val response = if (matches) {
            "HTTP/1.1 302 Found\r\nLocation: $RETURN_URL\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${PAGE.toByteArray().size}\r\nConnection: close\r\n\r\n$PAGE"
        } else {
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        }
        runCatching { socket.getOutputStream().apply { write(response.toByteArray()); flush() } }
        return if (matches) base + target else null
    }

    override fun close() {
        runCatching { server.close() }
    }

    companion object {
        /** Where the browser goes once the address is caught (MainActivity brings Dex to the front). */
        const val RETURN_URL = "dex://chatgpt/signed-in"
        private const val MAX_HEAD = 64 * 1024
        private const val PAGE =
            "<!doctype html><meta name=viewport content=\"width=device-width\"><title>Dex</title>" +
                "<p style=\"font:16px system-ui;margin:2em\">Signed in to ChatGPT. <a href=\"$RETURN_URL\">Return to Dex</a>.</p>"

        /**
         * Listens on [redirectUri]'s port, when it's an `http` loopback address with an explicit port and that port is
         * free. Otherwise null: the user pastes the address instead.
         */
        fun open(redirectUri: String): LoopbackCallback? {
            val uri = runCatching { URI(redirectUri) }.getOrNull() ?: return null
            if (uri.scheme != "http" || uri.host !in setOf("127.0.0.1", "localhost") || uri.port !in 1..65535) return null
            val server = runCatching {
                ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), uri.port))
                }
            }.getOrNull() ?: return null
            return LoopbackCallback(server, "http://${uri.host}:${uri.port}", uri.rawPath.ifEmpty { "/" })
        }

        /** The request's head, up to the blank line (capped). */
        private fun readHead(socket: Socket): String {
            val input = socket.getInputStream()
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (out.size() < MAX_HEAD) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                if (out.toString(Charsets.ISO_8859_1.name()).contains("\r\n\r\n")) break
            }
            return out.toString(Charsets.ISO_8859_1.name())
        }

        /** The target of a GET request line (`GET /auth/callback?code=… HTTP/1.1`), or null. */
        internal fun requestTarget(head: String): String? {
            val parts = head.substringBefore("\r\n").split(' ')
            if (parts.size < 3 || parts[0] != "GET" || !parts[1].startsWith("/")) return null
            return parts[1]
        }
    }
}
