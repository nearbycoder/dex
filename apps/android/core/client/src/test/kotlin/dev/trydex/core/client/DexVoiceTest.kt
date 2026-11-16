package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.model.Voices
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.nio.file.Files

/** A call's endpoints: phonemes for text, and the model downloaded once into the app's files. */
class DexVoiceTest {
    private val server = MockWebServer()
    private val client = OkHttpClient()
    private val user = DexUser("user-octocat", "octocat", "Mona", null)

    @Before fun start() = server.start()
    @After fun stop() = server.close()

    private fun session() = DexSession(server.url("/").toString(), "t0k", user, Long.MAX_VALUE)
    private fun json(body: String, code: Int = 200) = MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(body).build()

    @Test fun phonemesForText() = runBlocking<Unit> {
        server.enqueue(
            json("""{"sentences":[{"text":"Hi there.","utterances":[{"ids":[1,2,3],"stress":[0,1,0],"phonemes":"haɪ"}]},{"text":":)","utterances":[]}]}"""),
        )
        val response = DexVoice.phonemes(client, session(), "Hi there. :)")
        assertThat(response.sentences.map { it.text }).containsExactly("Hi there.", ":)").inOrder()
        assertThat(response.sentences[0].utterances.single().ids).containsExactly(1L, 2L, 3L).inOrder()
        assertThat(response.sentences[1].utterances).isEmpty()
        val request = server.takeRequest()
        assertThat(request.method).isEqualTo("POST")
        assertThat(request.url.encodedPath).isEqualTo("/api/voice/phonemes")
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=t0k")
        // Like every native request: no Origin.
        assertThat(request.headers["Origin"]).isNull()
        assertThat(request.body!!.utf8()).isEqualTo("""{"text":"Hi there. :)"}""")
    }

    @Test fun longTextIsCutToWhatTheEndpointTakes() = runBlocking<Unit> {
        server.enqueue(json("""{"sentences":[]}"""))
        DexVoice.phonemes(client, session(), "a".repeat(5_000))
        assertThat(server.takeRequest().body!!.utf8().length).isEqualTo(Voices.MAX_SPOKEN_CHARS + """{"text":""}""".length)
    }

    @Test fun signedOutAndRestarting() = runBlocking<Unit> {
        server.enqueue(json("""{"error":"Sign in"}""", 401))
        val signedOut = runCatching { DexVoice.phonemes(client, session(), "Hi.") }.exceptionOrNull() as VoiceException
        assertThat(signedOut.status).isEqualTo(401)
        assertThat(signedOut.message).isEqualTo("Sign in again to use calls.")
        // 503: the agent is restarting onto a new build; asked again.
        server.enqueue(json("{}", 503))
        server.enqueue(json("""{"sentences":[{"text":"Hi.","utterances":[]}]}"""))
        assertThat(DexVoice.phonemes(client, session(), "Hi.").sentences.single().text).isEqualTo("Hi.")
        server.enqueue(json("{}", 500))
        assertThat((runCatching { DexVoice.phonemes(client, session(), "Hi.") }.exceptionOrNull() as VoiceException).status).isEqualTo(500)
    }

    @Test fun theModelDownloadsOnceUnderItsRevision() = runBlocking<Unit> {
        val dir = Files.createTempDirectory("voice").toFile()
        dir.resolve("tiny-voca-000000000000.onnx").writeText("an older revision")
        val bytes = ByteArray(300_000) { (it % 251).toByte() }
        server.enqueue(MockResponse.Builder().body(Buffer().write(bytes)).build())
        val progress = mutableListOf<Float>()
        val file = DexVoice.model(client, session(), dir) { progress += it }
        assertThat(file.name).isEqualTo("tiny-voca-${Voices.modelVersion}.onnx")
        assertThat(file.readBytes()).isEqualTo(bytes)
        assertThat(progress.last()).isEqualTo(1f)
        assertThat(progress).isInOrder()
        // Only this revision is kept.
        assertThat(dir.list()!!.toList()).containsExactly(file.name)
        val request = server.takeRequest()
        assertThat(request.url.encodedPath).isEqualTo("/api/voice/model/model.onnx")
        assertThat(request.url.queryParameter("v")).isEqualTo("e5f9b11651a4")
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=t0k")
        // Then it's on the device: no second download.
        assertThat(DexVoice.model(client, session(), dir)).isEqualTo(file)
        assertThat(server.requestCount).isEqualTo(1)
    }

    @Test fun aFailedDownloadLeavesNothingBehind() = runBlocking<Unit> {
        val dir = Files.createTempDirectory("voice").toFile()
        server.enqueue(MockResponse.Builder().code(404).build())
        val error = runCatching { DexVoice.model(client, session(), dir) }.exceptionOrNull() as VoiceException
        assertThat(error.message).isEqualTo("Couldn't download the voice (404).")
        assertThat(dir.list()!!.toList()).isEmpty()
    }
}
