package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Before
import org.junit.Test

class DexUploadsTest {
    private val server = MockWebServer()
    private val client = OkHttpClient()
    private val user = DexUser("user-octocat", "octocat", "Mona", null)

    @Before fun start() = server.start()
    @After fun stop() = server.close()

    private fun session() = DexSession(server.url("/").toString(), "t0k", user, Long.MAX_VALUE)

    @Test fun sendsTheFileAndReadsTheAttachment() = runBlocking<Unit> {
        server.enqueue(
            MockResponse.Builder().addHeader("content-type", "application/json")
                .body("""{"kind":"text","name":"notes.md","mimeType":"text/markdown","text":"# Hi","truncated":true}""").build(),
        )
        val attachment = DexUploads.upload(client, session(), "# Hi".toByteArray(), "notes.md", "text/markdown")
        assertThat(attachment.kind).isEqualTo("text")
        assertThat(attachment.name).isEqualTo("notes.md")
        // Kept exactly as it came, so it goes back to sendMessage unchanged.
        assertThat(attachment.json["truncated"].toString()).isEqualTo("true")
        val request = server.takeRequest()
        assertThat(request.url.encodedPath).isEqualTo("/api/attachments")
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=t0k")
        assertThat(request.headers["Origin"]).isNull()
        val body = request.body!!.utf8()
        assertThat(body).contains("name=\"file\"; filename=\"notes.md\"")
        assertThat(body).contains("Content-Type: text/markdown")
        assertThat(body).contains("# Hi")
    }

    @Test fun reportsTheServersReason() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().code(415).addHeader("content-type", "application/json").body("""{"error":"Dex can't read .zip files yet."}""").build())
        val error = runCatching { DexUploads.upload(client, session(), byteArrayOf(1, 2), "a.zip", "application/zip") }.exceptionOrNull() as AttachmentException
        assertThat(error.message).isEqualTo("Dex can't read .zip files yet.")
        assertThat(error.status).isEqualTo(415)

        server.enqueue(MockResponse.Builder().code(503).body("Dex is restarting").build())
        val restarting = runCatching { DexUploads.upload(client, session(), byteArrayOf(1), "a.png", "image/png") }.exceptionOrNull() as AttachmentException
        assertThat(restarting.status).isEqualTo(503)
        assertThat(restarting.message).isEqualTo("Dex is restarting. Try again in a moment.")
    }
}
