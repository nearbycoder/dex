package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.ServerMessage
import dev.trydex.core.model.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** A stand-in agent: answers the socket like the Agents SDK does and records what the app sends. */
class FakeAgent : WebSocketListener() {
    val frames = LinkedBlockingQueue<JsonObject>()
    @Volatile var socket: WebSocket? = null
    val opened = LinkedBlockingQueue<WebSocket>()

    override fun onOpen(webSocket: WebSocket, response: Response) {
        socket = webSocket
        opened.add(webSocket)
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        frames.add(DexJson.parseToJsonElement(text).jsonObject)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(code, null)
    }

    fun send(text: String) = socket!!.send(text)

    /** What the SDK sends a new connection: identity (state follows), then the state. */
    fun hello(state: String = """{"sessions":[{"id":"s1","title":"Hello","busy":true}],"vmConfigured":true}""") {
        send("""{"type":"cf_agent_identity","name":"user-octocat","agent":"dex-agent","stateFollows":true}""")
        send("""{"type":"cf_agent_state","state":$state}""")
    }

    fun nextFrame(): JsonObject = frames.poll(5, TimeUnit.SECONDS) ?: error("No frame from the app")
}

class AgentConnectionTest {
    private val server = MockWebServer()
    private val agent = FakeAgent()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder().readTimeout(5, TimeUnit.SECONDS).build()
    private var token: String? = "signed.token"

    @Before fun start() = server.start()

    @After fun stop() {
        scope.cancel()
        server.close()
    }

    private fun connection() = AgentConnection(client, server.url("/"), "user-octocat", { token }, scope, minDelayMs = 50, maxDelayMs = 200)

    private fun upgrade() = server.enqueue(MockResponse.Builder().webSocketUpgrade(agent).build())

    private fun <T> await(block: suspend () -> T): T = runBlocking { withTimeout(5_000) { block() } }

    @Test fun connectsWithTheSessionCookieAndNoOrigin() {
        upgrade()
        val connection = connection()
        connection.start()
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertThat(request.url.encodedPath).isEqualTo("/agents/dex-agent/user-octocat")
        assertThat(request.url.queryParameter("_pk")).isNotEmpty()
        assertThat(request.headers["Cookie"]).isEqualTo("dex_session=signed.token")
        assertThat(request.headers["Origin"]).isNull()

        agent.opened.poll(5, TimeUnit.SECONDS)
        assertThat(connection.status.value).isEqualTo(ConnectionStatus.Connecting)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }
        val state = connection.state.value!!
        assertThat(state.sessions.single().title).isEqualTo("Hello")
        assertThat(state.sessions.single().busy).isTrue()
        assertThat(state.vmConfigured).isTrue()
        // Defaults fill what the agent didn't send.
        assertThat(state.settings.vmMinutes).isEqualTo(5)
        assertThat(state.sessions.single().mcpServers).isEmpty()
        connection.stop()
    }

    @Test fun identityWaitsForTheStateThatFollows() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.send("""{"type":"cf_agent_identity","name":"user-octocat","agent":"dex-agent","stateFollows":true}""")
        Thread.sleep(200)
        assertThat(connection.status.value).isEqualTo(ConnectionStatus.Connecting)
        agent.send("""{"type":"cf_agent_state","state":{}}""")
        await { connection.status.first { it == ConnectionStatus.Connected } }
        connection.stop()
    }

    @Test fun rpcCallsAndErrors() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }

        val reply = scope.async { connection.call("renameSession", AgentConnection.args("s1", "New title")) }
        val frame = agent.nextFrame()
        assertThat(frame["type"].str).isEqualTo("rpc")
        assertThat(frame["method"].str).isEqualTo("renameSession")
        assertThat(frame["args"].toString()).isEqualTo("""["s1","New title"]""")
        // A streamed chunk first, then the final reply.
        agent.send("""{"type":"rpc","id":"${frame["id"].str}","success":true,"result":"chunk","done":false}""")
        agent.send("""{"type":"rpc","id":"${frame["id"].str}","success":true,"result":{"ok":true},"done":true}""")
        assertThat(await { reply.await() }.toString()).isEqualTo("""{"ok":true}""")

        val failing = scope.async { runCatching { connection.call("deleteSession", AgentConnection.args("nope")) } }
        val second = agent.nextFrame()
        agent.send("""{"type":"rpc","id":"${second["id"].str}","success":false,"error":"Chat not found"}""")
        val error = await { failing.await() }.exceptionOrNull()
        assertThat(error).isInstanceOf(RpcException::class.java)
        assertThat(error!!.message).isEqualTo("Chat not found")
        connection.stop()
    }

    @Test fun dexMessagesReachListeners() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }
        val next = scope.async { connection.messages.first() }
        Thread.sleep(100)
        agent.send("""{"type":"dex.queue","sessionId":"s1","items":[{"id":"q1","text":"later","createdAt":5}],"held":true}""")
        val message = await { next.await() } as ServerMessage.Queue
        assertThat(message.items.single().text).isEqualTo("later")
        assertThat(message.held).isTrue()
        assertThat(connection.send(JsonObject(mapOf("type" to JsonPrimitive("dex.unsubscribe"))))).isTrue()
        assertThat(agent.nextFrame()["type"].str).isEqualTo("dex.unsubscribe")
        connection.stop()
    }

    @Test fun signedOutEverywhereStopsReconnecting() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }
        agent.socket!!.close(4001, "Signed out everywhere")
        assertThat(await { connection.status.first { it is ConnectionStatus.SignedOut } }).isEqualTo(ConnectionStatus.SignedOut(everywhere = true))
        Thread.sleep(300)
        assertThat(server.requestCount).isEqualTo(1)
    }

    @Test fun refusedSessionIsSignedOut() {
        server.enqueue(MockResponse.Builder().code(401).body("Unauthorized").build())
        val connection = connection()
        connection.start()
        assertThat(await { connection.status.first { it is ConnectionStatus.SignedOut } }).isEqualTo(ConnectionStatus.SignedOut(everywhere = false))
    }

    @Test fun noTokenIsSignedOut() {
        token = null
        val connection = connection()
        connection.start()
        assertThat(connection.status.value).isEqualTo(ConnectionStatus.SignedOut(everywhere = false))
    }

    @Test fun reconnectsWithTheSameConnectionIdAndSendsQueuedCalls() {
        upgrade()
        val connection = connection()
        connection.start()
        val first = server.takeRequest(5, TimeUnit.SECONDS)!!
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }

        // A deploy or eviction drops the socket.
        upgrade()
        agent.socket!!.close(1012, "Restarting")
        await { connection.status.first { it is ConnectionStatus.Waiting || it == ConnectionStatus.Connecting } }
        // A call made while it's down goes out once the new socket opens.
        val reply = scope.async { connection.call("listFiles", emptyList()) }
        val second = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertThat(second.url.queryParameter("_pk")).isEqualTo(first.url.queryParameter("_pk"))
        agent.opened.poll(5, TimeUnit.SECONDS)
        val frame = agent.nextFrame()
        assertThat(frame["method"].str).isEqualTo("listFiles")
        agent.send("""{"type":"rpc","id":"${frame["id"].str}","success":true,"result":[],"done":true}""")
        assertThat(await { reply.await() }.toString()).isEqualTo("[]")
        connection.stop()
    }

    @Test fun pendingCallsFailWhenTheSocketDrops() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }
        val reply = scope.async { runCatching { connection.call("vmStart", AgentConnection.args("s1")) } }
        agent.nextFrame()
        upgrade()
        agent.socket!!.close(1011, "Crashed")
        val error = await { reply.await() }.exceptionOrNull()
        assertThat(error!!.message).isEqualTo("Connection closed")
        connection.stop()
    }

    @Test fun callsTimeOut() {
        upgrade()
        val connection = connection()
        connection.start()
        agent.opened.poll(5, TimeUnit.SECONDS)
        agent.hello()
        await { connection.status.first { it == ConnectionStatus.Connected } }
        val error = runBlocking { runCatching { connection.call("slow", emptyList(), timeoutMs = 300) } }.exceptionOrNull()
        assertThat(error).isInstanceOf(RpcException::class.java)
        assertThat(error!!.message).contains("didn't answer")
        connection.stop()
    }

    @Test fun backoffGrowsAndCaps() {
        val connection = AgentConnection(client, server.url("/"), "x", { token }, scope, minDelayMs = 1_000, maxDelayMs = 10_000)
        assertThat(connection.backoff(0)).isIn(com.google.common.collect.Range.closed(800L, 1_200L))
        assertThat(connection.backoff(3)).isIn(com.google.common.collect.Range.closed(1_757L, 2_637L))
        assertThat(connection.backoff(50)).isIn(com.google.common.collect.Range.closed(8_000L, 12_000L))
    }
}
