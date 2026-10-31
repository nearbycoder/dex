package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Before
import org.junit.Test

/** GET /api/sidekicks for the widgets: the session cookie and no Origin, pictures optional, a restart waited out. */
class DexSidekicksTest {
    private val server = MockWebServer()
    private val client = OkHttpClient()
    private val user = DexUser("user-octocat", "octocat", "Mona", null)

    @Before fun start() = server.start()
    @After fun stop() = server.close()

    private fun session() = DexSession(server.url("/").toString(), "t0k", user, Long.MAX_VALUE)

    private val body = """{"unread":2,"sidekicks":[{"id":"atlas","name":"Atlas","tagline":"","color":"sky","image":null,"avatar":"","sessionId":"chat-atlas","unread":true,"busy":false,"lastReply":"Morning!","repliedAt":5}]}"""

    @Test fun readsTheSnapshot() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().addHeader("content-type", "application/json").body(body).build())
        val snapshot = DexSidekicks.fetch(client, session(), images = false)
        assertThat(snapshot.unread).isEqualTo(2)
        assertThat(snapshot.sidekicks.single().lastReply).isEqualTo("Morning!")
        val request = server.takeRequest()
        assertThat(request.url.encodedPath).isEqualTo("/api/sidekicks")
        assertThat(request.url.queryParameter("images")).isEqualTo("0")
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=t0k")
        assertThat(request.headers["Origin"]).isNull()
    }

    @Test fun waitsOutARestart() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().code(503).addHeader("retry-after", "1").body("""{"error":"Dex is updating."}""").build())
        server.enqueue(MockResponse.Builder().addHeader("content-type", "application/json").body(body).build())
        assertThat(DexSidekicks.fetch(client, session()).sidekicks).hasSize(1)
        assertThat(server.takeRequest().url.queryParameter("images")).isNull()
        assertThat(server.requestCount).isEqualTo(2)
    }

    @Test fun signedOut() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Sign in again"}""").build())
        val error = runCatching { DexSidekicks.fetch(client, session()) }.exceptionOrNull() as SidekicksException
        assertThat(error.status).isEqualTo(401)
    }
}
