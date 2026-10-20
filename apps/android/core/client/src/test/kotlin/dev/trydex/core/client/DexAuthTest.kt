package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.str
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class DexAuthTest {
    private val server = MockWebServer()
    private val client = OkHttpClient()

    @Before fun start() = server.start()
    @After fun stop() = server.close()

    @Test fun verifierAndChallenge() {
        val verifier = DexAuth.newVerifier()
        assertThat(verifier).hasLength(64)
        assertThat(verifier).matches("[A-Za-z0-9._~-]{64}")
        assertThat(DexAuth.newVerifier()).isNotEqualTo(verifier)
        // Checked against `openssl sha256 -binary | base64` (URL alphabet, no padding).
        assertThat(DexAuth.challenge("dBjftJeZ4CVP-mJ92K9F1Xc-bq2GDqfQ1sS1Y9G0dRw")).isEqualTo("0aj5Fl2GKYT75FD0oWJJWbfYQnZwuLHonhbQvGyvvPM")
        assertThat(DexAuth.challenge(verifier)).matches("[A-Za-z0-9_-]{43}")
    }

    @Test fun startUrlAndCallback() {
        val url = DexAuth.startUrl(DexAuth.parseServer("trydex.dev")!!, "abc")
        assertThat(url.toString()).isEqualTo("https://trydex.dev/auth/native/start?challenge=abc")
        assertThat(DexAuth.callbackCode("dex://auth/callback?code=a%2Bb%3D")).isEqualTo("a+b=")
        assertThat(DexAuth.callbackCode("dex://auth/callback?state=x&code=xyz")).isEqualTo("xyz")
        assertThat(DexAuth.callbackCode("dex://other/callback?code=x")).isNull()
        assertThat(DexAuth.callbackCode("https://evil.example/?code=x")).isNull()
    }

    @Test fun parsesServerAddresses() {
        assertThat(DexAuth.parseServer("trydex.dev").toString()).isEqualTo("https://trydex.dev/")
        assertThat(DexAuth.parseServer(" https://my.dex.example/chat ").toString()).isEqualTo("https://my.dex.example/")
        assertThat(DexAuth.parseServer("http://localhost:5173").toString()).isEqualTo("http://localhost:5173/")
        assertThat(DexAuth.parseServer("http://10.0.2.2:5173").toString()).isEqualTo("http://10.0.2.2:5173/")
        // Plain http only for addresses on this machine or network: a session token must not cross the internet in the clear.
        assertThat(DexAuth.parseServer("http://example.com")).isNull()
        assertThat(DexAuth.parseServer("")).isNull()
        assertThat(DexAuth.parseServer("not a host at all")).isNull()
    }

    @Test fun exchangesTheCode() = runBlocking<Unit> {
        server.enqueue(
            MockResponse.Builder().code(200).addHeader("content-type", "application/json")
                .body("""{"token":"t0k","user":{"id":"user-octocat","login":"octocat","name":"Mona","avatarUrl":null},"expiresAt":1800000000000}""")
                .build(),
        )
        val session = DexAuth.exchange(client, server.url("/"), "the-code", "the-verifier")
        assertThat(session.token).isEqualTo("t0k")
        assertThat(session.user.login).isEqualTo("octocat")
        assertThat(session.user.avatarUrl).isNull()
        assertThat(session.expiresAt).isEqualTo(1_800_000_000_000)
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertThat(request.method).isEqualTo("POST")
        assertThat(request.url.encodedPath).isEqualTo("/auth/native/token")
        assertThat(request.headers["Origin"]).isNull()
        val body = DexJson.parseToJsonElement(request.body!!.utf8()).jsonObject
        assertThat(body["code"].str).isEqualTo("the-code")
        assertThat(body["verifier"].str).isEqualTo("the-verifier")
    }

    @Test fun reportsTheServersError() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().code(400).body("""{"error":"That sign-in code expired. Sign in again."}""").build())
        val error = runCatching { DexAuth.exchange(client, server.url("/"), "old", "v") }.exceptionOrNull() as AuthException
        assertThat(error.message).isEqualTo("That sign-in code expired. Sign in again.")
        assertThat(error.status).isEqualTo(400)
    }

    @Test fun refreshSendsTheCookie() = runBlocking<Unit> {
        server.enqueue(MockResponse.Builder().code(200).body("""{"token":"new","user":{"id":"u","login":"o"},"expiresAt":5}""").build())
        val session = DexSession(server.url("/").toString(), "old", DexUser("u", "o"), 1)
        val renewed = DexAuth.refresh(client, session)
        assertThat(renewed.token).isEqualTo("new")
        assertThat(renewed.user.name).isEqualTo("o")
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertThat(request.url.encodedPath).isEqualTo("/auth/native/refresh")
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=old")
        assertThat(DexAuth.needsRenewal(session, now = 0)).isTrue()
    }

    @Test fun sessionCheck() = runBlocking<Unit> {
        val session = DexSession(server.url("/").toString(), "t", DexUser("u", "o"), 1)
        server.enqueue(MockResponse.Builder().code(401).build())
        assertThat(DexAuth.sessionAccepted(client, session)).isFalse()
        server.enqueue(MockResponse.Builder().code(200).body("""{"build":"x"}""").build())
        assertThat(DexAuth.sessionAccepted(client, session)).isTrue()
        server.enqueue(MockResponse.Builder().code(503).build())
        assertThat(DexAuth.sessionAccepted(client, session)).isNull()
    }

    @Test fun cookieOnlyGoesToDex() {
        val session = DexSession(server.url("/").toString(), "secret-token", DexUser("u", "o"), 1)
        val other = MockWebServer().apply { start() }
        val withCookie = OkHttpClient.Builder().addInterceptor(DexCookieInterceptor { session }).build()
        server.enqueue(MockResponse.Builder().code(200).build())
        other.enqueue(MockResponse.Builder().code(200).build())
        withCookie.newCall(Request.Builder().url(server.url("/api/media/u/x.png")).build()).execute().close()
        withCookie.newCall(Request.Builder().url(other.url("/x.png")).build()).execute().close()
        assertThat(server.takeRequest(5, TimeUnit.SECONDS)!!.headers["Cookie"]).isEqualTo("dex_session=secret-token")
        assertThat(other.takeRequest(5, TimeUnit.SECONDS)!!.headers["Cookie"]).isNull()
        other.close()
    }
}
