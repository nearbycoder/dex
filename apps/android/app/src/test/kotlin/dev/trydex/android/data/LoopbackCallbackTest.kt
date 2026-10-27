package dev.trydex.android.data

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/** Catching Sign in with ChatGPT's 127.0.0.1 redirect: only the callback path counts, and the browser is sent back to Dex. */
class LoopbackCallbackTest {
    private fun freePort() = ServerSocket(0).use { it.localPort }

    /** Sends a raw GET and returns the response's status line and headers. */
    private fun get(port: Int, target: String): String =
        Socket(InetAddress.getByName("127.0.0.1"), port).use { socket ->
            socket.getOutputStream().write("GET $target HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n\r\n".toByteArray())
            socket.getInputStream().readBytes().toString(Charsets.UTF_8).substringBefore("\r\n\r\n")
        }

    @Test fun catchesTheCallbackAndIgnoresOtherPaths() = runBlocking {
        val port = freePort()
        val loopback = LoopbackCallback.open("http://127.0.0.1:$port/auth/callback")!!
        val address = async { loopback.use { it.await(10_000) } }
        withContext(Dispatchers.IO) {
            assertThat(get(port, "/favicon.ico")).startsWith("HTTP/1.1 404")
            assertThat(get(port, "/auth/callbacks?code=x")).startsWith("HTTP/1.1 404")
            val response = get(port, "/auth/callback?code=abc&state=xyz")
            assertThat(response).startsWith("HTTP/1.1 302")
            assertThat(response).contains("Location: dex://chatgpt/signed-in")
        }
        assertThat(address.await()).isEqualTo("http://127.0.0.1:$port/auth/callback?code=abc&state=xyz")
    }

    @Test fun listensOnlyOnAFreeHttpLoopbackPort() {
        val port = freePort()
        assertThat(LoopbackCallback.open("https://127.0.0.1:$port/auth/callback")).isNull()
        assertThat(LoopbackCallback.open("http://example.com:$port/auth/callback")).isNull()
        assertThat(LoopbackCallback.open("http://127.0.0.1/auth/callback")).isNull()
        assertThat(LoopbackCallback.open("not a url")).isNull()
        ServerSocket(port, 1, InetAddress.getByName("127.0.0.1")).use {
            assertThat(LoopbackCallback.open("http://127.0.0.1:$port/auth/callback")).isNull()
        }
    }

    @Test fun givesUpAfterTheTimeoutAndFreesThePort() = runBlocking {
        val port = freePort()
        val loopback = LoopbackCallback.open("http://localhost:$port/auth/callback")!!
        assertThat(loopback.use { it.await(300) }).isNull()
        LoopbackCallback.open("http://127.0.0.1:$port/auth/callback")!!.close()
    }

    @Test fun readsOnlyGetRequestLines() {
        assertThat(LoopbackCallback.requestTarget("GET /auth/callback?code=1 HTTP/1.1\r\nHost: x\r\n\r\n")).isEqualTo("/auth/callback?code=1")
        assertThat(LoopbackCallback.requestTarget("POST /auth/callback HTTP/1.1\r\n\r\n")).isNull()
        assertThat(LoopbackCallback.requestTarget("GET http://evil/auth/callback HTTP/1.1\r\n\r\n")).isNull()
        assertThat(LoopbackCallback.requestTarget("")).isNull()
    }
}
