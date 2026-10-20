package dev.trydex.android.data

import dev.trydex.core.client.AgentConnection
import dev.trydex.core.client.ConnectionStatus
import dev.trydex.core.client.DexApi
import dev.trydex.core.client.DexAuth
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.asRpc
import dev.trydex.core.model.ClientMessages
import dev.trydex.core.model.DexState
import dev.trydex.core.model.ModelRegistry
import dev.trydex.core.model.ServerMessage
import dev.trydex.core.model.TranscriptReducer
import dev.trydex.core.model.TranscriptState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.util.concurrent.atomic.AtomicLong

/** Why the app is showing the sign-in screen. */
enum class SignedOutReason { None, Expired, Everywhere, SignedOut }

/**
 * The signed-in session and the one socket to its agent (DexProvider on the web): synced state, RPC, chat streams,
 * presence, the model list, and the device's quick-launch copies. Created once for the app.
 */
@OptIn(FlowPreview::class)
class DexRepository(
    private val scope: CoroutineScope,
    private val http: OkHttpClient,
    private val sessions: SessionStore,
    private val cache: LocalCache,
    val models: ModelRegistry,
) {
    private val _session = MutableStateFlow<DexSession?>(null)
    val session: StateFlow<DexSession?> = _session.asStateFlow()

    private val _signedOut = MutableStateFlow(SignedOutReason.None)
    val signedOutReason: StateFlow<SignedOutReason> = _signedOut.asStateFlow()

    private val _status = MutableStateFlow<ConnectionStatus>(ConnectionStatus.Stopped)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    private val _state = MutableStateFlow<DexState?>(null)
    /** The live state, or this device's last copy while the socket connects. */
    val state: StateFlow<DexState?> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<ServerMessage>(extraBufferCapacity = 256)
    val messages: SharedFlow<ServerMessage> = _messages

    private val _modelsVersion = MutableStateFlow<String?>(null)
    /** Changes when a new model list is installed, so model menus redraw. */
    val modelsVersion: StateFlow<String?> = _modelsVersion.asStateFlow()

    val connected: StateFlow<Boolean> = MutableStateFlow(false).also { flow ->
        scope.launch { status.collect { flow.value = it == ConnectionStatus.Connected } }
    }

    private var connection: AgentConnection? = null
    private var connectionJobs = emptyList<Job>()
    lateinit var api: DexApi
        private set

    /** The chat on screen here (for presence and the subscription), and whether Dex is visible. */
    private val openChat = MutableStateFlow<String?>(null)
    private val visible = MutableStateFlow(false)

    init {
        cache.loadModels()?.let { if (models.install(it)) _modelsVersion.value = it.version }
        sessions.load()?.let { activate(it) }
        // Presence: whether Dex is on screen here, and which chat it shows, so notifications skip what you're looking at.
        scope.launch {
            combine(connected, visible, openChat) { up, shown, chat -> Triple(up, shown, chat) }.distinctUntilChanged().collect { (up, shown, chat) ->
                if (up) connection?.send(ClientMessages.presence(shown, chat))
            }
        }
    }

    val userId: String? get() = _session.value?.user?.id

    // ── Session ──────────────────────────────────────────────────────────────

    fun signIn(session: DexSession) {
        sessions.save(session)
        _signedOut.value = SignedOutReason.None
        activate(session)
    }

    /** Forgets the session and everything kept for it on this device. */
    fun signOut(reason: SignedOutReason = SignedOutReason.SignedOut) {
        connection?.stop()
        connectionJobs.forEach { it.cancel() }
        connection = null
        sessions.clear()
        cache.clear()
        transcripts.clear()
        _state.value = null
        _session.value = null
        _status.value = ConnectionStatus.Stopped
        _signedOut.value = reason
    }

    private fun activate(session: DexSession) {
        _session.value = session
        _state.value = cache.loadState(session.user.id)
        val agent = AgentConnection(http, session.serverUrl, session.user.id, { _session.value?.token }, scope)
        connection = agent
        api = DexApi(agent.asRpc())
        connectionJobs = listOf(
            scope.launch { agent.status.collect(::onStatus) },
            scope.launch { agent.state.filterNotNull().collect { _state.value = it } },
            scope.launch { agent.messages.collect { _messages.emit(it) } },
            // Kept a moment after it settles, not on every streamed change.
            scope.launch {
                agent.state.filterNotNull().debounce(1_000).collect { state ->
                    withContext(Dispatchers.IO) { cache.saveState(session.user.id, state) }
                }
            },
            scope.launch { syncModels() },
        )
        scope.launch { renewIfDue() }
        // Signed in with the app open: connect now (otherwise the next setVisible does).
        if (visible.value) agent.start()
    }

    private suspend fun onStatus(status: ConnectionStatus) {
        _status.value = status
        when (status) {
            is ConnectionStatus.SignedOut -> {
                // A refused socket doesn't always mean the session is gone: ask the server before signing out.
                val current = _session.value ?: return
                val accepted = if (status.everywhere) false else DexAuth.sessionAccepted(http, current)
                if (accepted == false) signOut(if (status.everywhere) SignedOutReason.Everywhere else SignedOutReason.Expired)
                else {
                    delay(3_000)
                    connection?.start()
                }
            }
            ConnectionStatus.Connected -> {
                connection?.send(ClientMessages.presence(visible.value, openChat.value))
                resubscribe()
            }
            else -> Unit
        }
    }

    private suspend fun renewIfDue() {
        val current = _session.value ?: return
        if (!DexAuth.needsRenewal(current)) return
        runCatching { DexAuth.refresh(http, current) }.onSuccess { renewed ->
            if (_session.value?.token == current.token) {
                sessions.save(renewed)
                _session.value = renewed
            }
        }.onFailure { error ->
            if ((error as? dev.trydex.core.client.AuthException)?.status == 401) signOut(SignedOutReason.Expired)
        }
    }

    /** The agent refreshes its model list from the providers; install a new one when its version changes. */
    private suspend fun syncModels() {
        state.map { it?.models?.version }.distinctUntilChanged().collect { version ->
            if (version == null || version == models.version) return@collect
            connected.first { it }
            runCatching { api.modelCatalog() }.onSuccess { catalog ->
                if (models.install(catalog)) {
                    _modelsVersion.value = catalog.version
                    withContext(Dispatchers.IO) { cache.saveModels(catalog) }
                }
            }
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    fun setVisible(shown: Boolean) {
        visible.value = shown
        if (shown) {
            connection?.start()
            connection?.reconnectNow()
            scope.launch { renewIfDue() }
        }
    }

    /** Stops the socket (the app went away for a while); the next [setVisible] reconnects. */
    fun pause() {
        connection?.stop()
    }

    /** Something changed that may let the socket connect now (the network came back). */
    fun retryNow() {
        connection?.reconnectNow()
    }

    /** Whether this chat is on screen here right now. */
    fun isShowing(sessionId: String) = visible.value && openChat.value == sessionId

    fun send(message: kotlinx.serialization.json.JsonObject) = connection?.send(message) ?: false

    // ── Chats ────────────────────────────────────────────────────────────────

    private class Live(val state: MutableStateFlow<TranscriptState>, var users: Int, var job: Job?)

    private val transcripts = LinkedHashMap<String, Live>()
    private val subscribed = MutableStateFlow<String?>(null)
    private val pings = AtomicLong(0)

    /**
     * A chat's live transcript while you have it open: shows the copy in memory or on this device at once, subscribes
     * when connected (and again after every reconnect), and pings every 20 seconds so an evicted agent resumes the
     * stream. Call [closeChat] when it's no longer on screen.
     */
    fun openChat(sessionId: String): StateFlow<TranscriptState> {
        val live = transcripts.getOrPut(sessionId) {
            Live(MutableStateFlow(TranscriptState.Empty), 0, null)
        }
        live.users++
        transcripts.remove(sessionId)
        transcripts[sessionId] = live
        if (!live.state.value.loaded) {
            val user = userId
            scope.launch(Dispatchers.IO) {
                val kept = user?.let { cache.loadChat(it, sessionId) } ?: return@launch
                if (!live.state.value.loaded) {
                    live.state.value = live.state.value.copy(entries = kept.entries, artifacts = kept.artifacts, loaded = true)
                }
            }
        }
        // Listening before the subscribe goes out, so the snapshot it answers with isn't missed.
        if (live.job == null) live.job = scope.launch(start = CoroutineStart.UNDISPATCHED) { follow(sessionId, live) }
        openChat.value = sessionId
        subscribed.value = sessionId
        if (connected.value) connection?.send(ClientMessages.subscribe(sessionId))
        trim()
        return live.state
    }

    fun closeChat(sessionId: String) {
        val live = transcripts[sessionId] ?: return
        live.users = (live.users - 1).coerceAtLeast(0)
        if (live.users > 0) return
        if (subscribed.value == sessionId) {
            subscribed.value = null
            connection?.send(ClientMessages.unsubscribe())
        }
        if (openChat.value == sessionId) openChat.value = null
        saveChat(sessionId, live.state.value)
    }

    private fun resubscribe() {
        subscribed.value?.let { connection?.send(ClientMessages.subscribe(it)) }
    }

    private suspend fun follow(sessionId: String, live: Live) {
        val pinger = scope.launch {
            while (true) {
                delay(PING_MS)
                if (subscribed.value == sessionId && connected.value) {
                    pings.incrementAndGet()
                    connection?.send(ClientMessages.ping(sessionId))
                }
            }
        }
        try {
            messages.collect { message ->
                if (message.sessionId != sessionId) return@collect
                live.state.value = reduce(live.state.value, message)
            }
        } finally {
            pinger.cancel()
        }
    }

    private fun saveChat(sessionId: String, state: TranscriptState) {
        val user = userId ?: return
        if (!state.loaded) return
        scope.launch(Dispatchers.IO) {
            cache.saveChat(user, sessionId, LocalCache.SavedChat(System.currentTimeMillis(), state.entries, state.artifacts))
        }
    }

    /** Keeps the newest [MAX_TRANSCRIPTS] chats in memory; ones still on screen are never dropped. */
    private fun trim() {
        while (transcripts.size > MAX_TRANSCRIPTS) {
            val oldest = transcripts.entries.firstOrNull { it.value.users == 0 } ?: break
            oldest.value.job?.cancel()
            transcripts.remove(oldest.key)
        }
    }

    companion object {
        const val PING_MS = 20_000L
        const val MAX_TRANSCRIPTS = 12

        fun reduce(state: TranscriptState, message: ServerMessage): TranscriptState = when (message) {
            is ServerMessage.Snapshot -> TranscriptReducer.fromSnapshot(message.snapshot, state)
            is ServerMessage.Events -> TranscriptReducer.applyAll(state, message.events)
            is ServerMessage.Error -> state.copy(error = message.message, loaded = true)
            is ServerMessage.Queue -> state.copy(queue = message.items, queueHeld = message.held)
            is ServerMessage.Artifacts -> state.copy(artifacts = message.artifacts, savingArtifacts = message.saving)
            else -> state
        }
    }
}
