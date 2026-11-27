package dev.trydex.core.client

import dev.trydex.core.model.DexJson
import dev.trydex.core.model.DexState
import dev.trydex.core.model.ServerMessage
import dev.trydex.core.model.bool
import dev.trydex.core.model.obj
import dev.trydex.core.model.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/** Where the socket to the user's agent is. */
sealed interface ConnectionStatus {
    /** Opening the socket, or waiting for the agent to say who it is. */
    data object Connecting : ConnectionStatus

    /** The agent identified itself and sent its state: RPC works. */
    data object Connected : ConnectionStatus

    /** The socket dropped (no network, a deploy, an evicted agent); it reconnects at [retryAt]. */
    data class Waiting(val retryAt: Long, val reason: String?) : ConnectionStatus

    /** The session is no longer valid (expired, or "Sign out everywhere"): only signing in again helps. */
    data class SignedOut(val everywhere: Boolean) : ConnectionStatus

    data object Stopped : ConnectionStatus
}

class RpcException(message: String, val method: String) : Exception(message)

/**
 * One WebSocket to this user's DexAgent, speaking the Agents SDK's protocol (what `useAgent` does on the web):
 * `cf_agent_identity` and `cf_agent_state` frames, `rpc` calls and replies, and Dex's own `dex.*` messages. It
 * reconnects with backoff (like PartySocket) and keeps one connection id (`_pk`) across reconnects.
 *
 * The session token rides as the `dex_session` cookie and no Origin is sent, which is what the Worker's
 * `authorizeAgent` accepts from a native app (apps/web/src/server/native-auth.ts).
 */
class AgentConnection(
    private val client: OkHttpClient,
    private val server: HttpUrl,
    private val agentName: String,
    private val token: () -> String?,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val minDelayMs: Long = 1_000,
    private val maxDelayMs: Long = 10_000,
) {
    private val wsClient: OkHttpClient = client.newBuilder().readTimeout(0, java.util.concurrent.TimeUnit.SECONDS).build()
    private val connectionId = UUID.randomUUID().toString()

    private val _status = MutableStateFlow<ConnectionStatus>(ConnectionStatus.Stopped)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    private val _state = MutableStateFlow<DexState?>(null)
    /** The agent's synced state, decoded (null until the first `cf_agent_state`). */
    val state: StateFlow<DexState?> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<ServerMessage>(extraBufferCapacity = 256, onBufferOverflow = BufferOverflow.SUSPEND)
    val messages: SharedFlow<ServerMessage> = _messages.asSharedFlow()

    /** Messages in the order they arrived (a snapshot must reach listeners before the events after it). */
    private val inbox = Channel<ServerMessage>(Channel.UNLIMITED)
    private var inboxJob: Job? = null

    private class Pending(val method: String, val reply: CompletableDeferred<JsonElement?>) {
        val sent = AtomicBoolean(false)
    }

    private val pending = ConcurrentHashMap<String, Pending>()
    private val lock = Any()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var open = false
    @Volatile private var running = false
    @Volatile private var attempts = 0
    private var reconnect: Job? = null
    @Volatile private var identityPending = false
    @Volatile private var stateSeen = false
    @Volatile private var openedAt = 0L

    private val opened = MutableStateFlow(false)

    val url: HttpUrl
        get() = server.newBuilder()
            .scheme(if (server.isHttps) "https" else "http")
            .addPathSegment("agents").addPathSegment("dex-agent").addPathSegment(agentName)
            .addQueryParameter("_pk", connectionId)
            .build()

    private fun ensureInboxLocked() {
        if (inboxJob?.isActive == true) return
        inboxJob = scope.launch { for (message in inbox) _messages.emit(message) }
    }

    fun start() {
        synchronized(lock) {
            if (running) return
            running = true
            attempts = 0
            ensureInboxLocked()
            connectLocked()
        }
    }

    /** Closes the socket and stops reconnecting; pending calls fail. */
    fun stop() {
        val old = synchronized(lock) {
            running = false
            reconnect?.cancel()
            reconnect = null
            inboxJob?.cancel()
            inboxJob = null
            while (inbox.tryReceive().isSuccess) {}
            val current = socket
            socket = null
            markClosed("Connection closed")
            _status.value = ConnectionStatus.Stopped
            current
        }
        old?.close(1000, "Closed by the app")
    }

    /** Reconnects at once if the socket is down (the app came back to the foreground, or the network returned). */
    fun reconnectNow() {
        synchronized(lock) {
            if (!running || open || socket != null) return
            if (_status.value is ConnectionStatus.SignedOut) return
            reconnect?.cancel()
            reconnect = null
            attempts = 0
            ensureInboxLocked()
            connectLocked()
        }
    }

    private fun connectLocked() {
        val token = token()
        if (token == null) {
            _status.value = ConnectionStatus.SignedOut(everywhere = false)
            running = false
            return
        }
        socket?.cancel()
        socket = null
        _status.value = ConnectionStatus.Connecting
        identityPending = false
        stateSeen = false
        val request = Request.Builder()
            .url(url)
            .header("Cookie", "${DexAuth.SESSION_COOKIE}=$token")
            .header("User-Agent", DexAuth.USER_AGENT)
            .build()
        socket = wsClient.newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            synchronized(lock) {
                if (webSocket !== socket || !running) return
                open = true
                openedAt = clock()
                opened.value = true
            }
            // Calls made while the socket was down go now.
            for ((id, call) in pending) if (!call.sent.get()) transmit(id, call)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (synchronized(lock) { webSocket !== socket || !running }) return
            handle(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (synchronized(lock) { webSocket !== socket }) return
            closed(code, reason.ifEmpty { null })
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val code = response?.code
            response?.close()
            if (synchronized(lock) { webSocket !== socket }) return
            if (code == 401 || code == 403) {
                // The Worker refused the session: it expired or was revoked.
                signedOut(everywhere = false)
                return
            }
            closed(null, t.message)
        }
    }

    private fun handle(text: String) {
        val json = runCatching { DexJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (json["type"].str) {
            "cf_agent_identity" -> {
                if (json["stateFollows"].bool == true && !stateSeen) identityPending = true else identified()
            }
            "cf_agent_state" -> {
                val state = json["state"].obj
                if (state != null) {
                    runCatching { DexJson.decodeFromJsonElement(DexState.serializer(), state) }.onSuccess { _state.value = it }
                }
                stateSeen = true
                if (identityPending) {
                    identityPending = false
                    identified()
                }
            }
            "rpc" -> reply(json)
            else -> {
                if (json["type"].str?.startsWith("dex.") != true) return
                val message = runCatching { ServerMessage.parse(json) }.getOrNull() ?: return
                inbox.trySend(message)
            }
        }
    }

    private fun identified() {
        attempts = 0
        _status.value = ConnectionStatus.Connected
    }

    private fun reply(json: JsonObject) {
        val id = json["id"].str ?: return
        val call = pending[id] ?: return
        if (json["success"].bool == false) {
            pending.remove(id)
            call.reply.completeExceptionally(RpcException(json["error"].str ?: "${call.method} failed", call.method))
            return
        }
        // Streamed replies send chunks with done: false before the final one.
        if (json["done"].bool == false) return
        pending.remove(id)
        call.reply.complete(json["result"])
    }

    private fun closed(code: Int?, reason: String?) {
        synchronized(lock) {
            socket = null
            markClosed("Connection closed")
            if (code == 4001) {
                signedOutLocked(everywhere = true)
                return
            }
            if (!running) return
            // A connection that lasted a while starts the backoff over.
            if (openedAt != 0L && clock() - openedAt > 5_000) attempts = 0
            openedAt = 0
            val delayMs = backoff(attempts++)
            _status.value = ConnectionStatus.Waiting(clock() + delayMs, reason)
            reconnect?.cancel()
            reconnect = scope.launch {
                delay(delayMs)
                synchronized(lock) {
                    if (running && socket == null) connectLocked()
                }
            }
        }
    }

    private fun signedOut(everywhere: Boolean) {
        synchronized(lock) { signedOutLocked(everywhere) }
    }

    private fun signedOutLocked(everywhere: Boolean) {
        running = false
        reconnect?.cancel()
        reconnect = null
        socket = null
        markClosed("Signed out")
        _status.value = ConnectionStatus.SignedOut(everywhere)
    }

    private fun markClosed(reason: String) {
        open = false
        opened.value = false
        // Calls already sent can't be answered any more; ones still waiting to go keep waiting for the next socket.
        for ((id, call) in pending) {
            if (call.sent.get() || !running) {
                pending.remove(id)
                callArgs.remove(id)
                call.reply.completeExceptionally(RpcException(reason, call.method))
            }
        }
    }

    internal fun backoff(attempt: Int): Long {
        var delay = minDelayMs.toDouble()
        repeat(attempt) { delay *= 1.3 }
        val capped = delay.coerceAtMost(maxDelayMs.toDouble())
        return (capped * (0.8 + Random.nextDouble() * 0.4)).toLong().coerceAtLeast(250)
    }

    private fun transmit(id: String, call: Pending, args: JsonArray? = callArgs[id]) {
        if (!call.sent.compareAndSet(false, true)) return
        val frame = buildJsonObject {
            put("type", "rpc")
            put("id", id)
            put("method", call.method)
            put("args", args ?: callArgs[id] ?: JsonArray(emptyList()))
        }
        if (socket?.send(frame.toString()) == true) {
            callArgs.remove(id)
        } else {
            call.sent.set(false)
        }
    }

    private val callArgs = ConcurrentHashMap<String, JsonArray>()

    /**
     * Calls a `@callable()` method on DexAgent and returns its result. Waits for the socket if it's down (up to the
     * timeout), like the web client's buffered sends. Throws [RpcException] with the agent's message on failure.
     */
    suspend fun call(method: String, args: List<JsonElement>, timeoutMs: Long = DEFAULT_TIMEOUT_MS): JsonElement? {
        if (!running && !open) {
            val status = _status.value
            if (status is ConnectionStatus.SignedOut || status == ConnectionStatus.Stopped) {
                throw RpcException("Not connected to Dex.", method)
            }
        }
        val id = UUID.randomUUID().toString()
        val call = Pending(method, CompletableDeferred())
        // Args go in before pending so an onOpen flush on another thread always sees them.
        callArgs[id] = JsonArray(args)
        pending[id] = call
        try {
            return withTimeout(timeoutMs) {
                if (!open) opened.first { it }
                if (!call.sent.get()) transmit(id, call)
                call.reply.await()
            }
        } catch (error: CancellationException) {
            pending.remove(id)
            callArgs.remove(id)
            if (error is kotlinx.coroutines.TimeoutCancellationException) {
                throw RpcException("$method didn't answer in ${timeoutMs / 1000} seconds. Try again.", method)
            }
            throw error
        }
    }

    /** Sends a `dex.*` message if the socket is open (callers send them again after reconnecting). */
    fun send(message: JsonObject): Boolean = open && socket?.send(message.toString()) == true

    companion object {
        const val DEFAULT_TIMEOUT_MS = 30_000L
        /** Saving or connecting a local MCP server starts a VM and installs packages: minutes. */
        const val LONG_TIMEOUT_MS = 200_000L
        /** VM commands run for up to 10 minutes. */
        const val VM_TIMEOUT_MS = 660_000L

        fun args(vararg values: Any?): List<JsonElement> = values.map { value ->
            when (value) {
                null -> kotlinx.serialization.json.JsonNull
                is JsonElement -> value
                is String -> JsonPrimitive(value)
                is Number -> JsonPrimitive(value)
                is Boolean -> JsonPrimitive(value)
                else -> error("Unsupported RPC argument ${value::class}")
            }
        }
    }
}
