package dev.trydex.fake

import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.AttachedFile
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.attachmentSummary
import dev.trydex.core.model.ChatArtifact
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.DexState
import dev.trydex.core.model.DirectorySkill
import dev.trydex.core.model.GitHubAccess
import dev.trydex.core.model.GitHubOrg
import dev.trydex.core.model.GitHubRepo
import dev.trydex.core.model.McpCheck
import dev.trydex.core.model.McpCheckReport
import dev.trydex.core.model.McpServerInfo
import dev.trydex.core.model.McpStatus
import dev.trydex.core.model.McpToolInfo
import dev.trydex.core.model.ModelCatalog
import dev.trydex.core.model.PendingAction
import dev.trydex.core.model.ProjectImageCandidate
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.QueuedMessage
import dev.trydex.core.model.RegistryServer
import dev.trydex.core.model.SavedSecret
import dev.trydex.core.model.ScheduledPrompt
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.SkillDetail
import dev.trydex.core.model.SkillFileInfo
import dev.trydex.core.model.SkillInfo
import dev.trydex.core.model.SkillPreview
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.UsageReport
import dev.trydex.core.model.VmActivity
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmSetup
import dev.trydex.core.model.VmStatus
import dev.trydex.core.model.BuiltInModels
import dev.trydex.core.model.DailySpend
import dev.trydex.core.model.TokenUsage
import dev.trydex.core.model.ModelUsageRow
import dev.trydex.core.model.ChatUsageRow
import dev.trydex.core.model.BoatUsage
import dev.trydex.core.model.BoatRun
import dev.trydex.core.model.BoatSizeUsage
import dev.trydex.core.model.CloudflareUsage
import dev.trydex.core.model.CloudflareLine
import dev.trydex.core.model.OpenCodeLimits
import dev.trydex.core.model.OpenCodeWindow
import dev.trydex.core.model.AccessToken
import dev.trydex.core.model.CreatedAccessToken
import dev.trydex.core.model.WorkspaceFile
import dev.trydex.core.model.WorkspaceFileContent
import dev.trydex.core.model.Format
import dev.trydex.core.model.bool
import dev.trydex.core.model.long
import dev.trydex.core.model.arr
import dev.trydex.core.model.obj
import dev.trydex.core.model.str
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.Buffer
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * A stand-in Dex deployment: the agent's socket and RPC (state, chats that stream scripted replies, VMs, settings,
 * library), native sign-in, media, and the desktop page. It speaks the real wire protocol, so the app can't tell.
 * Everything runs on one thread; `chunkMs` sets how fast replies stream (0 for tests).
 */
class FakeDex(private val chunkMs: Long = 30, private val clock: () -> Long = System::currentTimeMillis) : AutoCloseable {
    val server = MockWebServer()
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "fake-dex").apply { isDaemon = true } }

    @Volatile var state: DexState = FakeData.state(clock())
        private set

    val token = "fake.session-token"
    val requests = CopyOnWriteArrayList<String>()
    /** RPC calls the app made, as `method(args)`, for tests. */
    val calls = CopyOnWriteArrayList<Pair<String, JsonArray>>()

    private val connections = CopyOnWriteArrayList<Connection>()
    private val chats = ConcurrentHashMap<String, FakeChat>()
    private val codes = ConcurrentHashMap<String, String>()
    private val files = linkedMapOf(
        "/workspace/MEMORY.md" to "# Memory\n\n- Josh prefers concise answers.\n- Deploys go through `npm run deploy`.\n",
        "/workspace/notes/plan.md" to "# Plan\n\n1. Ship the Android app\n2. Write the release notes\n\n| Task | Owner |\n|---|---|\n| QA | Dex |\n",
        "/workspace/reports/q3.html" to "<!doctype html><h1 style='font-family:sans-serif'>Q3 report</h1><p>Revenue up <b>12%</b>.</p>",
        "/workspace/data/sales.csv" to "month,revenue\nJul,120\nAug,135\nSep,142\n",
        Characters.memoryPath("muse") to "# Muse's notes\n\n- Mona is making a tiny game for her niece's 8th birthday (space cats).\n- Likes bold colors and silly names.\n",
    )
    private val vmActivity = ConcurrentHashMap<String, MutableList<VmActivity>>()
    private var activityId = 100L
    private var uiStates = ConcurrentHashMap<String, JsonObject>()
    private var schedules = mutableListOf(
        ScheduledPrompt("s1", "Summarize new GitHub issues", "chat-research", "2026-10-20T14:00:00.000Z", "0 9 * * 1-5"),
        ScheduledPrompt("s2", "Remind me to renew the certificates", null, "2026-10-25T16:00:00.000Z", null),
    )

    init {
        for (session in state.sessions) chats[session.id] = FakeChat(session.id).also { it.seed(session) }
        vmActivity["chat-tests"] = mutableListOf(
            VmActivity(1, clock() - 600_000, "system", "lifecycle", "Start VM (small)", "done", null, ""),
            VmActivity(2, clock() - 590_000, "system", "exec", "Clone octocat/dex into ~/work/dex", "done", 0, "Cloning into 'dex'...\ndone."),
            VmActivity(3, clock() - 300_000, "agent", "exec", "npm test", "error", 1, " ✓ 214 passed\n ✗ 1 failed"),
            VmActivity(4, clock() - 200_000, "user", "port", "expose port 5173", "done", 0, ""),
        )
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = route(request)
        }
    }

    /** Starts serving on `port` (any free one by default) of this device's loopback address. */
    fun start(port: Int = 0): HttpUrl {
        server.start(java.net.InetAddress.getByName("127.0.0.1"), port)
        return server.url("/")
    }

    override fun close() {
        connections.forEach { it.socket.close(1001, "Server going away") }
        worker.shutdownNow()
        server.close()
    }

    /** Runs on the fake's thread and waits for it (for tests that change state directly). */
    fun <T> sync(block: () -> T): T = worker.submit<T> { block() }.get(10, TimeUnit.SECONDS)

    // ── HTTP ─────────────────────────────────────────────────────────────────

    private fun json(body: Any, code: Int = 200) = MockResponse.Builder().code(code).addHeader("content-type", "application/json")
        .body(if (body is JsonElement) body.toString() else body.toString()).build()

    private fun authorized(request: RecordedRequest) = request.headers["Cookie"]?.contains("dex_session=$token") == true

    private fun route(request: RecordedRequest): MockResponse {
        val url = request.url
        val path = url.encodedPath
        requests += "${request.method} $path"
        return when {
            path.startsWith("/agents/dex-agent/") -> {
                if (!authorized(request)) return MockResponse.Builder().code(401).body("Unauthorized").build()
                MockResponse.Builder().webSocketUpgrade(Connection()).build()
            }
            path == "/auth/native/start" -> {
                val challenge = url.queryParameter("challenge") ?: return MockResponse.Builder().code(400).build()
                val code = UUID.randomUUID().toString()
                codes[code] = challenge
                MockResponse.Builder().code(302).addHeader("Location", "dex://auth/callback?code=$code").build()
            }
            path == "/auth/native/token" -> {
                val body = DexJson.parseToJsonElement(request.body?.utf8() ?: "{}").jsonObject
                val challenge = codes.remove(body["code"].str)
                val verifier = body["verifier"].str ?: ""
                val digest = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
                if (challenge == null || challenge != digest) json(buildJsonObject { put("error", "That sign-in code isn't valid") }, 400)
                else json(session())
            }
            path == "/auth/native/refresh" -> if (authorized(request)) json(session()) else json(buildJsonObject { put("error", "Sign in again") }, 401)
            path == "/api/attachments" -> {
                if (!authorized(request)) return json(buildJsonObject { put("error", "Sign in again") }, 401)
                attachment(request.body?.utf8() ?: "")
            }
            path == "/api/version" -> if (authorized(request)) json(buildJsonObject { put("build", state.build) }) else MockResponse.Builder().code(401).build()
            path.startsWith("/api/media/") -> {
                if (!authorized(request)) return MockResponse.Builder().code(401).build()
                MockResponse.Builder().addHeader("content-type", "image/png").body(Buffer().write(Base64.getDecoder().decode(FakeAssets.CHART_PNG))).build()
            }
            path.startsWith("/vm-desktop/") -> {
                if (!authorized(request)) return MockResponse.Builder().code(401).body("Unauthorized").build()
                MockResponse.Builder().addHeader("content-type", "text/html; charset=utf-8").body(FakeAssets.desktopPage(url.queryParameter("view") == "watch")).build()
            }
            path == "/desktop/stream" || path == "/desktop/vnc" ->
                MockResponse.Builder().addHeader("content-type", "text/html; charset=utf-8").body(FakeAssets.desktopPage(false)).build()
            else -> MockResponse.Builder().code(404).body("Not found").build()
        }
    }

    /** A fake `/api/attachments`: images come back as a small PNG, other files as a line of text; .zip is refused. */
    private fun attachment(multipart: String): MockResponse {
        val name = Regex("filename=\"([^\"]*)\"").find(multipart)?.groupValues?.get(1) ?: "file"
        val type = Regex("Content-Type: ([^\\s;]+)").findAll(multipart).lastOrNull()?.groupValues?.get(1) ?: "application/octet-stream"
        if (name.endsWith(".zip")) return json(buildJsonObject { put("error", "Dex can't read .zip files yet.") }, 415)
        return json(
            if (type.startsWith("image/")) buildJsonObject {
                put("kind", "image"); put("name", name); put("mimeType", "image/png"); put("data", FakeAssets.CHART_PNG)
            } else buildJsonObject {
                put("kind", "text"); put("name", name); put("mimeType", type); put("text", "(The contents of $name.)")
                if (name.endsWith(".pdf")) put("converted", true)
            }
        )
    }

    private fun session() = buildJsonObject {
        put("token", token)
        put("user", buildJsonObject { put("id", FakeData.USER_ID); put("login", FakeData.LOGIN); put("name", "Mona Octocat"); put("avatarUrl", JsonNull) })
        put("expiresAt", clock() + 30L * 24 * 3600 * 1000)
    }

    // ── Socket ───────────────────────────────────────────────────────────────

    inner class Connection : WebSocketListener() {
        lateinit var socket: WebSocket
        @Volatile var chat: String? = null
        @Volatile var visible = true

        override fun onOpen(webSocket: WebSocket, response: Response) {
            socket = webSocket
            connections += this
            send(buildJsonObject { put("type", "cf_agent_identity"); put("name", FakeData.USER_ID); put("agent", "dex-agent"); put("stateFollows", true) })
            send(stateMessage())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = DexJson.parseToJsonElement(text).jsonObject
            worker.execute { handle(this, message) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
            connections -= this
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            connections -= this
        }

        fun send(message: JsonObject) = runCatching { socket.send(message.toString()) }
    }

    private fun stateMessage() = buildJsonObject {
        put("type", "cf_agent_state")
        put("state", DexJson.encodeToJsonElement(DexState.serializer(), state))
    }

    /** Changes the state and syncs it to every app, like the agent's setState. */
    fun update(change: (DexState) -> DexState) {
        state = change(state)
        val message = stateMessage()
        connections.forEach { it.send(message) }
    }

    private fun broadcast(message: JsonObject) = connections.forEach { it.send(message) }

    /** Closes every socket with "Signed out everywhere" (code 4001). */
    fun signOutEverywhere() = connections.forEach { it.socket.close(4001, "Signed out everywhere") }

    /** Drops every socket, as a deploy or an eviction does. */
    fun dropConnections() = connections.forEach { it.socket.close(1012, "Restarting") }

    private fun handle(connection: Connection, message: JsonObject) {
        when (message["type"].str) {
            "rpc" -> {
                val id = message["id"].str ?: return
                val method = message["method"].str ?: return
                val args = message["args"] as? JsonArray ?: JsonArray(emptyList())
                calls += method to args
                val reply = try {
                    buildJsonObject { put("type", "rpc"); put("id", id); put("success", true); put("result", rpc(connection, method, args) ?: JsonNull); put("done", true) }
                } catch (error: Exception) {
                    buildJsonObject { put("type", "rpc"); put("id", id); put("success", false); put("error", error.message ?: "Failed") }
                }
                connection.send(reply)
            }
            "dex.subscribe" -> subscribe(connection, message["sessionId"].str ?: return)
            "dex.ping" -> message["sessionId"].str?.let { if (connection.chat != it) subscribe(connection, it) }
            "dex.unsubscribe" -> connection.chat = null
            "dex.presence" -> connection.visible = message["visible"].bool ?: true
        }
    }

    private fun subscribe(connection: Connection, sessionId: String) {
        val chat = chats[sessionId]
        if (chat == null) {
            connection.send(buildJsonObject { put("type", "dex.error"); put("sessionId", sessionId); put("message", "Chat not found") })
            return
        }
        connection.chat = sessionId
        connection.send(buildJsonObject { put("type", "dex.snapshot"); put("sessionId", sessionId); put("snapshot", chat.snapshot()) })
        connection.send(chat.artifactsMessage())
        connection.send(chat.queueMessage())
    }

    private fun toChat(sessionId: String, message: JsonObject) = connections.filter { it.chat == sessionId }.forEach { it.send(message) }

    private fun <T> encode(serializer: KSerializer<T>, value: T) = DexJson.encodeToJsonElement(serializer, value)

    private fun session(id: String) = state.sessions.firstOrNull { it.id == id } ?: error("Chat not found")

    private fun updateSession(id: String, change: (SessionMeta) -> SessionMeta) =
        update { s -> s.copy(sessions = s.sessions.map { if (it.id == id) change(it) else it }.sortedByDescending { it.updatedAt }) }

    // ── RPC ──────────────────────────────────────────────────────────────────

    private fun JsonArray.s(i: Int) = getOrNull(i).str ?: ""
    private fun JsonArray.o(i: Int) = getOrNull(i).obj ?: JsonObject(emptyMap())

    @Suppress("CyclomaticComplexMethod")
    private fun rpc(connection: Connection, method: String, args: JsonArray): JsonElement? = when (method) {
        "modelCatalog" -> encode(ModelCatalog.serializer(), ModelCatalog("builtin", clock(), BuiltInModels.list))
        "refreshModelList" -> buildJsonObject { put("added", JsonArray(emptyList())); put("retired", JsonArray(emptyList())); put("count", BuiltInModels.list.size) }
        "createSession" -> {
            val options = args.o(0)
            val agent = state.agents.firstOrNull { it.id == options["agentId"].str }
            val id = "chat-" + UUID.randomUUID().toString().take(8)
            val now = clock()
            val session = SessionMeta(
                id, options["title"].str ?: "New chat", options["model"].str ?: agent?.model ?: state.settings.defaultModel,
                ThinkingLevel.fromId(options["thinking"].str) ?: state.settings.defaultThinking, now, now,
                agentId = agent?.id, mcpServers = (options["mcpServers"] as? JsonArray)?.mapNotNull { it.str } ?: emptyList(), projectId = options["projectId"].str,
            )
            chats[id] = FakeChat(id)
            update { it.copy(sessions = listOf(session) + it.sessions) }
            if (session.projectId != null) startVm(id, setup = true)
            encode(SessionMeta.serializer(), session)
        }
        "sendMessage" -> {
            val chat = chats[args.s(0)] ?: error("Chat not found")
            connection.chat = chat.id
            chat.send(args.s(1).trim(), args.getOrNull(2).arr?.mapNotNull { it.obj }.orEmpty())
            null
        }
        "renameSession" -> { updateSession(args.s(0)) { it.copy(title = args.s(1).trim().ifEmpty { "Untitled" }) }; null }
        "regenerateSessionTitle" -> {
            val title = "Renamed: " + session(args.s(0)).title.take(30)
            updateSession(args.s(0)) { it.copy(title = title) }
            JsonPrimitive(title)
        }
        "deleteSession" -> {
            chats.remove(args.s(0))?.abort()
            update { s -> s.copy(sessions = s.sessions.filter { it.id != args.s(0) }, vms = s.vms.filter { it.key != args.s(0) }) }
            // A character always has a conversation: deleting theirs starts a new one.
            state.characters.firstOrNull { it.sessionId == args.s(0) }?.let { restartCharacter(it.id) }
            null
        }
        "triageSession" -> {
            val change = args.o(1)
            val id = args.s(0)
            session(id)
            change["settled"].bool?.let { settled -> updateSession(id) { it.copy(settledAt = if (settled) clock() else null, snoozedUntil = if (settled) null else it.snoozedUntil) } }
            if (change.containsKey("snoozedUntil")) {
                val until = change["snoozedUntil"].long
                if (until != null && (until <= clock() || until > clock() + 366L * 86_400_000)) error("Pick a time in the next year.")
                updateSession(id) { it.copy(snoozedUntil = until, settledAt = if (until != null) null else it.settledAt) }
            }
            null
        }
        "setSessionMuted" -> { updateSession(args.s(0)) { it.copy(muted = args[1].bool == true) }; null }
        "configureSession" -> {
            val options = args.o(1)
            updateSession(args.s(0)) { s ->
                s.copy(
                    model = options["model"].str ?: s.model,
                    thinking = ThinkingLevel.fromId(options["thinking"].str) ?: s.thinking,
                    mcpServers = (options["mcpServers"] as? JsonArray)?.mapNotNull { it.str } ?: s.mcpServers,
                )
            }
            null
        }
        "abort" -> { chats[args.s(0)]?.abort(); null }
        "listQueue" -> chats[args.s(0)]?.queueJson()
        "editQueued" -> { chats[args.s(0)]?.edit(args.s(1), args.s(2)); null }
        "removeQueued" -> { chats[args.s(0)]?.removeQueued(args.s(1)); null }
        "moveQueued" -> { chats[args.s(0)]?.move(args.s(1), args[2].long?.toInt() ?: 0); null }
        "steerQueued" -> { chats[args.s(0)]?.steer(args.s(1)); null }
        "transcriptImage" -> buildJsonObject { put("data", FakeAssets.DESKTOP_PNG); put("mimeType", "image/png") }
        "storeChatSecret" -> JsonPrimitive(args.s(1))
        "listArtifacts" -> JsonArray(chats[args.s(0)]?.artifacts?.map { encode(ChatArtifact.serializer(), it) } ?: emptyList())
        "saveArtifact" -> buildJsonObject { put("url", "/api/media/user-octocat/saved.png"); put("name", "saved.png"); put("kind", "image"); put("size", 2910) }
        "uiStates" -> JsonObject(uiStates.filterKeys { it.startsWith(args.s(0) + "/") }.mapKeys { it.key.substringAfter("/") })
        "saveUiState" -> { uiStates[args.s(0) + "/" + args.s(1)] = args.o(2); null }
        "runUiOperation" -> uiOperation(args.s(1), args.o(2), args.o(3)["confirmed"].bool == true)
        "updateSettings" -> {
            val patch = args.o(0)
            update { s ->
                s.copy(settings = s.settings.copy(
                    defaultModel = patch["defaultModel"].str ?: s.settings.defaultModel,
                    defaultThinking = ThinkingLevel.fromId(patch["defaultThinking"].str) ?: s.settings.defaultThinking,
                    instructions = patch["instructions"].str ?: s.settings.instructions,
                    vmSize = patch["vmSize"].str ?: s.settings.vmSize,
                    vmMinutes = patch["vmMinutes"].long?.toInt()?.coerceIn(1, 1440) ?: s.settings.vmMinutes,
                ))
            }
            null
        }
        "connectCline", "connectOpenCode", "connectBoat" -> {
            val key = args.s(0).trim()
            if (key.isEmpty()) buildJsonObject { put("ok", false); put("error", "Paste your API key.") }
            else if (key == "bad") buildJsonObject { put("ok", false); put("error", "The provider didn't accept that key.") }
            else {
                val hint = if (key.length > 8) key.take(4) + "…" + key.takeLast(4) else "••••"
                update { s ->
                    when (method) {
                        "connectCline" -> s.copy(cline = s.cline.copy(connected = true, source = "user", keyHint = hint, verifiedAt = clock()))
                        "connectOpenCode" -> s.copy(opencode = s.opencode.copy(connected = true, source = "user", keyHint = hint, verifiedAt = clock()))
                        else -> s.copy(boat = s.boat.copy(connected = true, source = "user", keyHint = hint), vmConfigured = true)
                    }
                }
                buildJsonObject { put("ok", true); if (method == "connectCline") put("note", "Connected to your ClinePass subscription.") }
            }
        }
        "disconnectCline" -> { update { it.copy(cline = it.cline.copy(connected = false, source = null, keyHint = null)) }; null }
        "disconnectOpenCode" -> { update { it.copy(opencode = it.opencode.copy(connected = false, source = null, keyHint = null)) }; null }
        "startChatGPTSignIn" -> buildJsonObject {
            put("url", "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=fake")
            put("redirectUri", "http://127.0.0.1:1455/auth/callback")
        }
        "finishChatGPTSignIn" -> {
            val address = args.s(0).trim()
            if (!address.contains("code=")) buildJsonObject { put("ok", false); put("error", "That address has no sign-in code. Paste the one the browser landed on after you approved.") }
            else {
                update { it.copy(chatgpt = it.chatgpt.copy(connected = true, source = "user", keyHint = "you@example.com", verifiedAt = clock())) }
                buildJsonObject { put("ok", true) }
            }
        }
        "disconnectChatGPT" -> { update { it.copy(chatgpt = it.chatgpt.copy(connected = false, source = null, keyHint = null)) }; null }
        "disconnectBoat" -> {
            if (state.vms.any { it.id != null }) buildJsonObject { put("ok", false); put("error", "Delete your ${state.vms.size} VMs on the Machines page first: they belong to the boat.dev account you're using now.") }
            else { update { it.copy(boat = it.boat.copy(connected = false, source = null, keyHint = null), vmConfigured = false) }; buildJsonObject { put("ok", true) } }
        }
        "connectGitHub" -> {
            update { it.copy(github = it.github.copy(connected = true, login = FakeData.LOGIN, via = "token", expired = false)) }
            buildJsonObject { put("ok", true); put("login", FakeData.LOGIN) }
        }
        "disconnectGitHub" -> { update { it.copy(github = it.github.copy(connected = false, login = null, via = null)) }; null }
        "signOutEverywhere" -> { worker.schedule({ signOutEverywhere() }, 50, TimeUnit.MILLISECONDS); null }
        "saveSecret" -> {
            val name = args.s(0).trim().uppercase()
            if (!Regex("^[A-Z_][A-Z0-9_]{0,63}$").matches(name)) error("Use an environment variable name: capital letters, digits, and underscores (e.g. MY_API_KEY).")
            val value = args.getOrNull(1).str
            val existing = state.secrets.firstOrNull { it.name == name }
            if (value.isNullOrEmpty() && existing == null) error("Enter the secret's value.")
            update { s -> s.copy(secrets = (s.secrets.filter { it.name != name } + SavedSecret(name, args.s(2).trim().take(200), clock())).sortedBy { it.name }) }
            JsonPrimitive(name)
        }
        "removeSecret" -> { update { s -> s.copy(secrets = s.secrets.filter { it.name != args.s(0) }) }; JsonPrimitive(true) }
        "listScheduledPrompts" -> JsonArray(schedules.map { encode(ScheduledPrompt.serializer(), it) })
        "cancelScheduledPrompt" -> { schedules.removeAll { it.id == args.s(0) }; JsonPrimitive(true) }
        "listFiles" -> JsonArray(files.map { (path, content) -> encode(WorkspaceFile.serializer(), WorkspaceFile(path, content.length.toLong(), clock() - 3_600_000)) })
        "readFile" -> {
            val path = normalize(args.s(0))
            val content = files[path] ?: error("No such file: ${args.s(0)}")
            encode(WorkspaceFileContent.serializer(), WorkspaceFileContent(path, content, content.length.toLong()))
        }
        "writeFile" -> { files[normalize(args.s(0))] = args.s(1); null }
        "deleteFile" -> { files.remove(normalize(args.s(0))); JsonPrimitive(true) }
        "runCommand" -> {
            val command = args.s(0)
            val out = when {
                command.startsWith("ls") -> files.keys.joinToString("\n") { it.removePrefix("/workspace/") } + "\n"
                command.startsWith("echo ") -> command.removePrefix("echo ") + "\n"
                command.startsWith("cat ") -> files[normalize(command.removePrefix("cat "))] ?: ""
                else -> ""
            }
            val error = if (out.isEmpty() && !command.startsWith("echo")) "bash: ${command.substringBefore(' ')}: command not found\n" else ""
            buildJsonObject { put("stdout", out); put("stderr", error); put("exitCode", if (error.isEmpty()) 0 else 127) }
        }
        "saveAgent" -> {
            val draft = args.o(0)
            val name = draft["name"].str?.trim()?.take(60).orEmpty()
            if (name.isEmpty()) error("Give the agent a name.")
            val id = draft["id"].str ?: (name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).ifEmpty { "agent" } + "-" + UUID.randomUUID().toString().take(6))
            val previous = state.agents.firstOrNull { it.id == id }
            val agent = DexJson.decodeFromJsonElement(AgentProfile.serializer(), JsonObject(draft + mapOf("id" to JsonPrimitive(id), "name" to JsonPrimitive(name)))).copy(createdAt = previous?.createdAt ?: clock(), updatedAt = clock())
            update { s -> s.copy(agents = if (previous == null) s.agents + agent else s.agents.map { if (it.id == id) agent else it }) }
            encode(AgentProfile.serializer(), agent)
        }
        "deleteAgent" -> {
            // Its chats keep running as plain chats.
            update { s -> s.copy(agents = s.agents.filter { it.id != args.s(0) }, sessions = s.sessions.map { if (it.agentId == args.s(0)) it.copy(agentId = null) else it }) }
            null
        }
        "saveCharacter" -> saveCharacter(args.o(0))
        "deleteCharacter" -> {
            val id = args.s(0)
            // Their conversations stay, as ordinary chats; ones that never got a message go.
            val untouched = state.sessions.filter { it.characterId == id && it.updatedAt == it.createdAt }.map { it.id }.toSet()
            untouched.forEach { chats.remove(it)?.abort() }
            update { s ->
                s.copy(
                    characters = s.characters.filter { it.id != id },
                    sessions = s.sessions.filter { it.id !in untouched }.map { if (it.characterId == id) it.copy(characterId = null) else it },
                )
            }
            null
        }
        "restartCharacter" -> encode(CharacterProfile.serializer(), restartCharacter(args.s(0)))
        "characterMemory" -> {
            state.character(args.s(0)) ?: error("That sidekick no longer exists.")
            JsonPrimitive(files[Characters.memoryPath(args.s(0))] ?: "")
        }
        "saveCharacterMemory" -> {
            state.character(args.s(0)) ?: error("That sidekick no longer exists.")
            val text = args.s(1).take(64_000)
            if (text.isBlank()) files.remove(Characters.memoryPath(args.s(0))) else files[Characters.memoryPath(args.s(0))] = text
            null
        }
        "saveProject" -> {
            val draft = args.o(0)
            val name = draft["name"].str?.trim()?.take(60).orEmpty()
            if (name.isEmpty()) error("Give the project a name.")
            val id = draft["id"].str ?: (name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).ifEmpty { "project" } + "-" + UUID.randomUUID().toString().take(6))
            val previous = state.projects.firstOrNull { it.id == id }
            val project = DexJson.decodeFromJsonElement(ProjectProfile.serializer(), JsonObject(draft + mapOf("id" to JsonPrimitive(id), "name" to JsonPrimitive(name)))).let { p ->
                p.copy(
                    repos = p.repos.map { r -> r.copy(url = if (r.url.matches(Regex("^[\\w.-]+/[\\w.-]+$"))) "https://github.com/${r.url}.git" else r.url) },
                    // Left out, the picture stays as it was; null clears it.
                    image = if ("image" in draft) p.image else previous?.image,
                    createdAt = previous?.createdAt ?: clock(),
                    updatedAt = clock(),
                )
            }
            update { s -> s.copy(projects = if (previous == null) s.projects + project else s.projects.map { if (it.id == id) project else it }) }
            encode(ProjectProfile.serializer(), project)
        }
        "deleteProject" -> {
            // Its chats stay, without the project.
            update { s -> s.copy(projects = s.projects.filter { it.id != args.s(0) }, sessions = s.sessions.map { if (it.projectId == args.s(0)) it.copy(projectId = null) else it }) }
            null
        }
        "projectImageCandidates" -> JsonArray(listOf(encode(ProjectImageCandidate.serializer(), ProjectImageCandidate("public/favicon.png", "data:image/png;base64," + FakeAssets.CHART_PNG))))
        "searchGitHubRepos" -> JsonArray(repos(args.s(0)).filter { repo -> args.getOrNull(1).str?.let { repo.owner.equals(it, ignoreCase = true) } ?: true }.map { encode(GitHubRepo.serializer(), it) })
        "listGitHubBranches" -> JsonArray(listOf("main", "develop", "fix/flaky-login", "feat/android").map { JsonPrimitive(it) })
        "githubRepoAccess" -> encode(GitHubAccess.serializer(), GitHubAccess(true, FakeData.LOGIN, "oauth", listOf(GitHubOrg("acme")), "https://github.com/settings/connections/applications/x"))
        "saveMcpServer" -> {
            val draft = args.o(0)
            val name = draft["name"].str?.trim().orEmpty()
            if (name.isEmpty()) buildJsonObject { put("ok", false); put("error", "Give the server a name.") }
            else {
                val id = draft["id"].str ?: name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-') + "-" + UUID.randomUUID().toString().take(6)
                val local = draft["local"].obj
                val auth = draft["auth"].str ?: "none"
                val server = McpServerInfo(
                    id, name, draft["url"].str ?: "", draft["transport"].str ?: "auto", auth,
                    headerNames = (draft["headers"] as? JsonArray)?.mapNotNull { it.obj?.get("name").str } ?: emptyList(),
                    local = local?.let { dev.trydex.core.model.McpLocal(it["command"].str ?: "", (it["env"] as? JsonArray)?.mapNotNull { e -> e.obj?.get("name").str } ?: emptyList()) },
                    defaultOn = draft["defaultOn"].bool == true, prefix = name.lowercase().replace(Regex("[^a-z0-9_]"), "_").take(24),
                    status = if (auth == "oauth") McpStatus.Authenticating else McpStatus.Ready,
                    tools = if (auth == "oauth") emptyList() else listOf(McpToolInfo("search", "Search it."), McpToolInfo("fetch", "Fetch a page.")),
                    createdAt = clock(), updatedAt = clock(),
                )
                update { s -> s.copy(mcp = s.mcp.filter { it.id != id } + server) }
                buildJsonObject { put("ok", true); put("id", id); if (auth == "oauth") put("authUrl", server("/oauth/authorize?server=$id")) }
            }
        }
        "connectMcpServer" -> {
            val server = state.mcp.firstOrNull { it.id == args.s(0) } ?: error("No such MCP server.")
            if (server.status == McpStatus.Authenticating) buildJsonObject { put("ok", true); put("id", server.id); put("authUrl", server("/oauth/authorize?server=${server.id}")) }
            else {
                update { s -> s.copy(mcp = s.mcp.map { if (it.id == server.id) it.copy(status = McpStatus.Ready, error = null) else it }) }
                buildJsonObject { put("ok", true); put("id", server.id) }
            }
        }
        "setMcpServerDefault" -> { update { s -> s.copy(mcp = s.mcp.map { if (it.id == args.s(0)) it.copy(defaultOn = args[1].bool == true) else it }) }; null }
        "deleteMcpServer" -> { update { s -> s.copy(mcp = s.mcp.filter { it.id != args.s(0) }) }; null }
        "searchMcpRegistry" -> JsonArray(registry(args.s(0), args.s(1)).map { encode(RegistryServer.serializer(), it) })
        "checkMcpServer" -> encode(McpCheckReport.serializer(), McpCheckReport(
            "https://mcp.example.com/mcp",
            listOf(
                McpCheck("https", "HTTPS", "pass", "The endpoint uses HTTPS."),
                McpCheck("publisher", "Publisher", "pass", "Verified as example.com."),
                McpCheck("reachable", "Handshake", "pass", "It answered the MCP handshake in 240 ms."),
                McpCheck("auth", "Sign-in", "warn", "It needs an API key in the Authorization header."),
                McpCheck("repo", "Source", "info", "github.com/example/mcp · 1.2K stars · MIT · pushed 3 days ago"),
            ),
            "headers", "Authorization", listOf("search", "fetch", "summarize"), clock(),
        ))
        "searchSkills" -> JsonArray(if (args.s(0).length < 2) emptyList() else listOf(
            DirectorySkill("anthropics/skills/pdf", "anthropics/skills", "pdf", "pdf", 182_000),
            DirectorySkill("vercel/skills/frontend-design", "vercel/skills", "frontend-design", "frontend-design", 9_400),
            DirectorySkill("acme/skills/code-review", "acme/skills", "code-review", "code-review", 1_250),
        ).filter { args.s(0).lowercase().split(' ').any { w -> w in it.name || it.name.contains(w.take(3)) } }.map { encode(DirectorySkill.serializer(), it) })
        "previewSkill" -> encode(SkillPreview.serializer(), SkillPreview(args.s(1), "Reads, fills, and builds PDF files.", "# PDF\n\nUse pdftk and qpdf on the VM…", args.s(0), args.s(1), "https://github.com/${args.s(0)}/tree/HEAD/${args.s(1)}", listOf(SkillFileInfo("scripts/fill.py", 1_800)), 6_200))
        "installSkill" -> {
            val skill = SkillInfo(args.s(1), "Installed from ${args.s(0)}.", args.s(0), args.s(1), args.getOrNull(2).bool ?: true, 1, 6_200, clock(), clock())
            update { s -> s.copy(skills = s.skills.filter { it.id != skill.id } + skill) }
            encode(SkillDetail.serializer(), detail(skill))
        }
        "getSkill" -> state.skills.firstOrNull { it.id == args.s(0) }?.let { encode(SkillDetail.serializer(), detail(it)) }
        "saveSkill" -> {
            val input = args.o(0)
            val name = (input["name"].str ?: "").lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(64)
            if (name.isEmpty()) error("A skill needs a name: lowercase letters, digits, and dashes.")
            if ((input["description"].str ?: "").isBlank()) error("Describe when to use the skill: chats decide from the description.")
            val previous = state.skills.firstOrNull { it.id == input["id"].str }
            val skill = SkillInfo(name, input["description"].str!!.trim(), previous?.source, previous?.path, input["auto"].bool ?: true, previous?.files ?: 0, (input["instructions"].str ?: "").length.toLong(), previous?.installedAt ?: clock(), clock())
            skillText[name] = input["instructions"].str ?: ""
            update { s -> s.copy(skills = s.skills.filter { it.id != previous?.id && it.id != name } + skill) }
            encode(SkillDetail.serializer(), detail(skill))
        }
        "setSkillAuto" -> { update { s -> s.copy(skills = s.skills.map { if (it.id == args.s(0)) it.copy(auto = args[1].bool == true) else it }) }; null }
        "updateSkill" -> {
            val skill = state.skills.firstOrNull { it.id == args.s(0) } ?: error("No skill ${args.s(0)}.")
            if (skill.source == null) error("${skill.id} wasn't installed from GitHub.")
            update { s -> s.copy(skills = s.skills.map { if (it.id == skill.id) it.copy(updatedAt = clock()) else it }) }
            encode(SkillDetail.serializer(), detail(skill))
        }
        "removeSkill" -> { update { s -> s.copy(skills = s.skills.filter { it.id != args.s(0) }) }; JsonPrimitive(true) }
        "vmRefresh" -> vm(args.s(0))
        "vmStart" -> { startVm(args.s(0), setup = false); vm(args.s(0)) }
        "vmStop" -> {
            setVm(args.s(0)) { it.copy(status = VmStatus.Stopped, busy = false) }
            activity(args.s(0), "system", "lifecycle", "Stop VM (disk is kept)", "done", "")
            vm(args.s(0))
        }
        "vmDestroy" -> {
            update { s -> s.copy(vms = s.vms.filter { it.key != args.s(0) }) }
            encode(VmInfo.serializer(), VmInfo.none(args.s(0)))
        }
        "vmRerunSetup" -> { startVm(args.s(0), setup = true); null }
        "vmTouch" -> { setVm(args.s(0)) { it.copy(lastActiveAt = clock()) }; null }
        "vmActivity" -> JsonArray((vmActivity[args.s(0)] ?: emptyList()).takeLast(args.getOrNull(1).long?.toInt() ?: 100).map { encode(VmActivity.serializer(), it) })
        "vmRun" -> {
            val key = args.s(0)
            if (state.vms.none { it.key == key && it.running }) startVm(key, setup = false)
            val output = "${args.s(1)}\nok\n"
            val id = activity(key, "user", "exec", args.s(1), "running", "")
            worker.schedule({
                broadcast(buildJsonObject { put("type", "dex.vm.output"); put("sessionId", JsonNull); put("vmKey", key); put("id", id); put("data", "ok\n") })
                finishActivity(key, id, "done", 0, "ok\n")
            }, chunkMs * 4, TimeUnit.MILLISECONDS)
            buildJsonObject { put("exitCode", 0); put("output", output) }
        }
        "vmPeek" -> buildJsonObject { put("running", true); put("status", "running"); put("view", args.s(1)) }
        "vmDesktopUrl" -> if (state.vms.any { it.key == args.s(0) && it.running }) {
            when (args.s(1)) {
                "selkies" -> JsonPrimitive("/vm-desktop/${args.s(0)}/")
                "vnc" -> JsonPrimitive(server("/desktop/vnc"))
                else -> JsonPrimitive(server("/desktop/stream"))
            }
        } else JsonNull
        "vmExposePort" -> {
            activity(args.s(0), "user", "port", "expose port ${args[1]}", "done", "")
            JsonPrimitive("https://sb-1f2e-${args[1]}.on.boat.dev/?_token=abc123")
        }
        "usageReport" -> encode(UsageReport.serializer(), usage(args.s(0)))
        "pushUpdate", "pushUnsubscribe" -> {
            if (method == "pushUnsubscribe") update { s -> s.copy(push = s.push.copy(devices = s.push.devices.filter { it.id != args.s(0) })) }
            null
        }
        "pushTest" -> JsonNull
        "createAccessToken" -> {
            val label = args.s(0).trim()
            if (label.isEmpty()) error("Name the token after the agent that will use it.")
            val days = args.getOrNull(2).long
            val token = AccessToken(UUID.randomUUID().toString().take(8), label.take(60), args.s(1), clock(), null, days?.let { clock() + it * 86_400_000 })
            update { s -> s.copy(access = s.access.copy(tokens = listOf(token) + s.access.tokens)) }
            encode(CreatedAccessToken.serializer(), CreatedAccessToken(token, "dexk.dXNlcg.${UUID.randomUUID().toString().replace("-", "")}.sig"))
        }
        "revokeAccessToken" -> { update { s -> s.copy(access = s.access.copy(tokens = s.access.tokens.filter { it.id != args.s(0) })) }; null }
        "resolvePendingAction" -> {
            val id = args.s(0)
            val approve = args[1].bool == true
            val pending = state.access.pending.firstOrNull { it.id == id } ?: error("That request is gone.")
            if (pending.status != "pending") error("That request was already ${pending.status}.")
            update { s -> s.copy(access = s.access.copy(pending = s.access.pending.map { if (it.id == id) it.copy(status = if (approve) "approved" else "declined") else it })) }
            chats[pending.sessionId]?.tell(if (approve) "[Confirmed] ${pending.summary}" else "[Declined] ${pending.summary}")
            null
        }
        else -> error("Method $method does not exist")
    }

    private val skillText = ConcurrentHashMap<String, String>()

    /** A new conversation for a character, titled with their name, on their model and MCP servers. */
    private fun openCharacterSession(character: CharacterProfile): String {
        val id = "chat-" + UUID.randomUUID().toString().take(8)
        val now = clock()
        chats[id] = FakeChat(id)
        val session = SessionMeta(id, character.name, character.model, character.thinking, now, now, mcpServers = character.mcpServers, characterId = character.id)
        update { it.copy(sessions = listOf(session) + it.sessions) }
        return id
    }

    /** saveCharacter: creates (no id) or updates; a left-out `image` or `look` is kept, null removes it. */
    private fun saveCharacter(draft: JsonObject): JsonElement {
        val name = draft["name"].str?.trim()?.take(40).orEmpty()
        if (name.isEmpty()) error("Give your sidekick a name.")
        val existing = draft["id"].str?.let { id -> state.character(id) ?: error("That sidekick no longer exists.") }
        val image = if ("image" in draft) draft["image"].str else existing?.image
        if (image != null && (!image.startsWith("data:image/") || image.length > 66_000)) error("Pick a smaller picture (PNG, JPEG, WebP, GIF, or SVG under 48 KB).")
        val id = existing?.id ?: (name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).ifEmpty { "character" } + "-" + UUID.randomUUID().toString().take(6))
        val now = clock()
        val parsed = DexJson.decodeFromJsonElement(CharacterProfile.serializer(), JsonObject(draft + mapOf("id" to JsonPrimitive(id))))
        var character = parsed.copy(
            name = name,
            tagline = parsed.tagline.trim().take(120),
            greeting = parsed.greeting.trim().take(2_000),
            avatar = parsed.avatar.trim().let { if (it.isEmpty()) "" else it.substring(0, it.offsetByCodePoints(0, 1)) },
            image = image,
            look = if ("look" in draft) parsed.look else existing?.look,
            color = parsed.color.takeIf { it in dev.trydex.core.model.Catalogs.AGENT_COLORS } ?: "violet",
            mcpServers = if ("mcpServers" in draft) parsed.mcpServers.filter { server -> state.mcp.any { it.id == server } } else existing?.mcpServers.orEmpty(),
            sessionId = existing?.sessionId.orEmpty(),
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
        )
        if (existing == null || state.session(existing.sessionId) == null) character = character.copy(sessionId = openCharacterSession(character))
        else updateSession(existing.sessionId) { it.copy(title = name, model = character.model, thinking = character.thinking, mcpServers = character.mcpServers) }
        update { s -> s.copy(characters = if (existing == null) s.characters + character else s.characters.map { if (it.id == id) character else it }) }
        return encode(CharacterProfile.serializer(), character)
    }

    /** Start over: a new conversation; the old one stays unless it never got a message. */
    private fun restartCharacter(id: String): CharacterProfile {
        val character = state.character(id) ?: error("That sidekick no longer exists.")
        val sessionId = openCharacterSession(character)
        val restarted = character.copy(sessionId = sessionId, updatedAt = clock())
        update { s -> s.copy(characters = s.characters.map { if (it.id == id) restarted else it }) }
        val old = state.session(character.sessionId)
        if (old != null && old.updatedAt == old.createdAt && !old.busy) {
            chats.remove(old.id)?.abort()
            update { s -> s.copy(sessions = s.sessions.filter { it.id != old.id }) }
        }
        return restarted
    }

    private fun detail(skill: SkillInfo) = SkillDetail(
        skill.id, skill.description, skill.source, skill.path, skill.auto, skill.files, skill.size, skill.installedAt, skill.updatedAt,
        skillText[skill.id] ?: "# ${skill.id}\n\n1. Read what's asked.\n2. Do it well.",
        if (skill.files > 0) listOf(SkillFileInfo("reference.md", 4_200)) else emptyList(),
    )

    private fun server(path: String) = server.url(path).toString()

    private fun normalize(path: String) = if (path.startsWith("/")) path else "/workspace/" + path.removePrefix("./")

    private fun uiOperation(name: String, args: JsonObject, confirmed: Boolean): JsonElement = when (name) {
        "app_list_sessions" -> buildJsonObject {
            put("ok", true)
            put("result", JsonArray(state.sessions.take(args["limit"].long?.toInt() ?: 10).map { s ->
                buildJsonObject { put("id", s.id); put("title", s.title); put("updatedAt", s.updatedAt); put("busy", s.busy) }
            }))
        }
        "app_delete_sessions", "app_update_settings" -> if (confirmed) buildJsonObject { put("ok", true); put("result", JsonNull); put("changed", "Changed the setting") }
            else buildJsonObject { put("ok", "confirm"); put("summary", "Change the default model to Kimi K3") }
        "app_stop_vm" -> buildJsonObject { put("ok", true); put("result", buildJsonObject { put("status", "stopped") }); put("changed", "Stopped the VM") }
        else -> buildJsonObject { put("ok", false); put("error", "No operation $name.") }
    }

    private fun repos(query: String): List<GitHubRepo> = listOf(
        GitHubRepo("octocat/dex", false, "Agent harness on Cloudflare", "main", "2026-10-19T10:00:00Z", false, false, "octocat", "", true, "TypeScript", 1240),
        GitHubRepo("octocat/blog", true, "My blog", "main", "2026-10-01T10:00:00Z", false, false, "octocat", "", true, "Astro", 3),
        GitHubRepo("acme/api", true, "Acme's API", "develop", "2026-09-20T10:00:00Z", false, false, "acme", "", true, "Go", 18),
        GitHubRepo("torvalds/linux", false, "Linux kernel source tree", "master", "2026-10-19T08:00:00Z", false, false, "torvalds", "", false, "C", 190_000),
    ).filter { query.isBlank() || it.fullName.contains(query, ignoreCase = true) || it.description.contains(query, ignoreCase = true) }

    private fun registry(query: String, source: String): List<RegistryServer> {
        if (query.length < 2) return emptyList()
        return listOf(
            RegistryServer(source, "@smithery/exa", "Exa search", "Web search for agents.", "1.2.0", "https://github.com/exa-labs/exa-mcp", if (source == "registry") "https://mcp.exa.ai/mcp" else "", "streamable-http", headers = listOf(dev.trydex.core.model.RegistryHeader("Authorization", "Your Exa key", required = true, secret = true)), uses = 48_000, verified = true),
            RegistryServer(source, "io.github.modelcontextprotocol/everything", "Everything", "A server that exercises every MCP feature.", "0.6.0", null, "", "stdio", run = dev.trydex.core.model.RegistryRun("npx -y @modelcontextprotocol/server-everything", emptyList()), uses = 1_200, verified = false),
        ).filter { it.title.contains(query, ignoreCase = true) || it.description.contains(query, ignoreCase = true) || query.equals("mcp", true) }
    }

    private fun usage(range: String): UsageReport {
        val day = 86_400_000L
        val days = (0 until if (range == "month") 19 else 30).map { i ->
            val date = Format.utcDay(clock() - (if (range == "month") 18 - i else 29 - i) * day)
            DailySpend(date, cline = 0.4 + (i % 5) * 0.31, opencode = 0.2 + (i % 3) * 0.18, boat = if (i % 4 == 0) 0.0 else 0.09 * (i % 6), cloudflare = 0.02)
        }
        return UsageReport(
            range, clock() - days.size * day, clock(),
            cline = TokenUsage(412, 2_900_000, 410_000, 1_200_000, 3_310_000, 18.42, byModel = listOf(ModelUsageRow("cline-pass/glm-5.3", 280, 2_100_000, 11.5), ModelUsageRow("cline-pass/kimi-k3", 132, 1_210_000, 6.92)), byChat = listOf(ChatUsageRow("chat-dashboard", "Weekly metrics dashboard", 900_000, 4.1), ChatUsageRow("gone", "Deleted chat", 120_000, 0.5))),
            opencode = TokenUsage(120, 800_000, 90_000, 0, 890_000, 3.12, byModel = listOf(ModelUsageRow("opencode-go/kimi-k3", 120, 890_000, 3.12)), connected = true, limits = OpenCodeLimits(OpenCodeWindow(12.0, "2026-10-20T03:00:00Z", false), OpenCodeWindow(46.0, "2026-10-26T00:00:00Z", false), OpenCodeWindow(83.5, "2026-11-01T00:00:00Z", false))),
            boat = BoatUsage(11.5, 0.21, true, listOf(BoatSizeUsage("small", 11.5, 0.21)), listOf(BoatRun(clock() - 2 * 3_600_000, null, "small", 2.0, 0.036), BoatRun(clock() - day, clock() - day + 5_400_000, "small", 1.5, 0.027))),
            cloudflare = CloudflareUsage(true, null, clock() - 18 * day, listOf(CloudflareLine("Worker requests", 412_000.0, "requests", 0.12, 0.04), CloudflareLine("Durable Object duration", 18_200.0, "GB-s", 0.23, 0.05), CloudflareLine("Workers AI", 3_200.0, "neurons", 0.03, null, accountWide = true)), 0.38),
            daily = days,
        )
    }

    // ── VMs ──────────────────────────────────────────────────────────────────

    private fun vm(key: String): JsonElement = encode(VmInfo.serializer(), state.vms.firstOrNull { it.key == key } ?: VmInfo.none(key))

    private fun setVm(key: String, change: (VmInfo) -> VmInfo) = update { s ->
        val existing = s.vms.firstOrNull { it.key == key }
        s.copy(vms = if (existing == null) s.vms + change(VmInfo(key, id = "sb_" + key.takeLast(4))) else s.vms.map { if (it.key == key) change(it) else it })
    }

    private fun startVm(key: String, setup: Boolean) {
        setVm(key) { it.copy(status = VmStatus.Starting, lastActiveAt = clock(), setup = if (setup) VmSetup("running", "Cloning repositories", null) else it.setup) }
        activity(key, "system", "lifecycle", "Start VM (small)", "done", "")
        worker.schedule({
            setVm(key) { it.copy(status = VmStatus.Running, lastActiveAt = clock(), setup = if (setup) VmSetup("done", null, null) else it.setup) }
        }, chunkMs * 20, TimeUnit.MILLISECONDS)
    }

    private fun activity(key: String, actor: String, kind: String, title: String, status: String, output: String): Long {
        val item = VmActivity(++activityId, clock(), actor, kind, title, status, if (status == "done") 0 else null, output)
        vmActivity.getOrPut(key) { mutableListOf() } += item
        broadcast(buildJsonObject { put("type", "dex.vm.activity"); put("sessionId", JsonNull); put("vmKey", key); put("activity", encode(VmActivity.serializer(), item)) })
        return item.id
    }

    private fun finishActivity(key: String, id: Long, status: String, exitCode: Int, output: String) {
        val list = vmActivity[key] ?: return
        val index = list.indexOfFirst { it.id == id }
        if (index < 0) return
        val item = list[index].copy(status = status, exitCode = exitCode, output = output)
        list[index] = item
        broadcast(buildJsonObject { put("type", "dex.vm.activity"); put("sessionId", JsonNull); put("vmKey", key); put("activity", encode(VmActivity.serializer(), item)) })
    }

    // ── Chats ────────────────────────────────────────────────────────────────

    private inner class FakeChat(val id: String) {
        val entries = mutableListOf<JsonObject>()
        var nextId = 10L
        val queue = mutableListOf<QueuedMessage>()
        var held = false
        var running = false
        val artifacts = mutableListOf<ChatArtifact>()
        private val pending = mutableListOf<ScheduledFuture<*>>()
        private var streaming: JsonObject? = null

        fun seed(session: SessionMeta) {
            val at = session.updatedAt - 60_000
            when (session.id) {
                "chat-dashboard" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("Build me a dashboard of this week's metrics", at - 50_000))
                    replay(Scripts.pick("dashboard", { "1" }), at - 45_000)
                }
                "chat-tests" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("The login test keeps failing in CI. Run the tests on the VM and fix it.", at - 50_000))
                    replay(Scripts.pick("test", { (nextId + 1).toString() }), at - 45_000)
                }
                "chat-research" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("Which vector database should I use for 2M documents?", at - 50_000))
                    replay(Scripts.pick("compare", { "1" }), at - 45_000)
                }
                "chat-muse" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("I want to make a tiny game for my niece's birthday. She loves cats and space.", at - 50_000))
                    entries += Pi.entry(nextId++, "pi.assistant", Pi.assistantMessage(listOf(Pi.text(
                        "Space cats. Obviously. Three directions:\n\n1. **Laser Pointer Galaxy**: steer a cat through asteroids chasing a red dot.\n" +
                            "2. **Purrlanet**: tap planets to wake sleeping cats; each one meows a note.\n3. **Hairball Rocket**: a one-button launcher, very silly.\n\nWhich one makes you grin?",
                    )), at - 40_000, 4_000))
                }
                "chat-muse-earlier" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("Help me name my band", at - 50_000))
                    entries += Pi.entry(nextId++, "pi.assistant", Pi.assistantMessage(listOf(Pi.text("Ooh. The Half-Baked Ideas? Velvet Spreadsheet? Tell me what you sound like.")), at - 40_000, 3_000))
                }
                "chat-atlas" -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage("What's on my plate this week?", at - 50_000))
                    entries += Pi.entry(nextId++, "pi.assistant", Pi.assistantMessage(listOf(Pi.text(
                        "Three things:\n\n- **Tuesday**: the dentist at 9.\n- **Thursday**: Android release notes are due.\n- **Friday**: your niece's birthday. The game?\n\nI'll check in Thursday morning.",
                    )), at - 40_000, 3_000))
                }
                else -> {
                    entries += Pi.entry(nextId++, "pi.user", Pi.userMessage(session.title, at - 50_000))
                    entries += Pi.entry(nextId++, "pi.assistant", Pi.assistantMessage(listOf(Pi.text("Done. Anything else?")), at - 40_000, 4_000))
                }
            }
        }

        /** Writes a finished reply straight into the transcript (for seeded chats). */
        private fun replay(steps: List<Step>, start: Long) {
            var at = start
            val content = mutableListOf<JsonObject>()
            val tools = mutableListOf<Step.Tool>()
            fun flush() {
                if (content.isEmpty()) return
                entries += Pi.entry(nextId++, "pi.assistant", Pi.assistantMessage(content.toList(), at, 3_000, stopReason = if (tools.isNotEmpty()) "toolUse" else "stop"))
                at += 3_000
                tools.forEachIndexed { i, tool ->
                    entries += Pi.entry(nextId++, "pi.toolResult", Pi.toolResult("seed-${entries.size}-$i", tool.name, tool.result, at, tool.isError, tool.details, tool.image))
                }
                content.clear()
                tools.clear()
            }
            for (step in steps) when (step) {
                is Step.Think -> content += Pi.thinking(step.text)
                is Step.Say -> content += Pi.text(step.text)
                is Step.Tool -> {
                    content += Pi.toolCall("seed-${entries.size + 1}-${tools.size}", step.name, step.args)
                    tools += step
                }
                Step.Turn -> flush()
                is Step.Fail -> Unit
            }
            flush()
            // Tool call ids in assistant entries must match their results: rewrite them in order.
            relinkToolIds()
        }

        private fun relinkToolIds() {
            var callIndex = 0
            val calls = mutableListOf<String>()
            for ((i, entry) in entries.withIndex()) {
                val message = entry["model"]?.jsonArray?.firstOrNull()?.jsonObject ?: continue
                if (message["role"].str == "assistant") {
                    val content = message["content"]!!.jsonArray.map { block ->
                        val b = block.jsonObject
                        if (b["type"].str == "toolCall") {
                            val newId = "call_${id}_${callIndex++}"
                            calls += newId
                            JsonObject(b + ("id" to JsonPrimitive(newId)))
                        } else b
                    }
                    entries[i] = JsonObject(entry + ("model" to JsonArray(listOf(JsonObject(message + ("content" to JsonArray(content)))))))
                } else if (message["role"].str == "toolResult" && calls.isNotEmpty()) {
                    val callId = calls.removeAt(0)
                    entries[i] = JsonObject(entry + ("model" to JsonArray(listOf(JsonObject(message + ("toolCallId" to JsonPrimitive(callId)))))))
                }
            }
        }

        fun snapshot() = buildJsonObject {
            put("type", "snapshot")
            put("entries", JsonArray(entries))
            if (running) put("run", buildJsonObject { put("inputs", JsonArray(emptyList())) })
            streaming?.let { put("generation", buildJsonObject { put("attempt", 1); put("message", it) }) }
            put("tools", JsonArray(emptyList()))
            put("nestedTools", JsonArray(emptyList()))
            put("compactions", JsonArray(emptyList()))
            put("inbox", JsonArray(emptyList()))
            put("agent", JsonObject(emptyMap()))
            put("usage", JsonObject(emptyMap()))
        }

        fun queueJson() = buildJsonObject { put("items", JsonArray(queue.map { encode(QueuedMessage.serializer(), it) })); put("held", held) }
        fun queueMessage() = buildJsonObject { put("type", "dex.queue"); put("sessionId", id); put("items", JsonArray(queue.map { encode(QueuedMessage.serializer(), it) })); put("held", held) }
        fun artifactsMessage() = buildJsonObject { put("type", "dex.artifacts"); put("sessionId", id); put("artifacts", JsonArray(artifacts.map { encode(ChatArtifact.serializer(), it) })); put("saving", JsonArray(emptyList())) }

        private fun events(vararg events: JsonObject) = toChat(id, buildJsonObject { put("type", "dex.events"); put("sessionId", id); put("events", JsonArray(events.toList())) })

        /** Queued messages' attachments, by queue item id. */
        private val queuedFiles = mutableMapOf<String, List<JsonObject>>()

        fun send(text: String, attachments: List<JsonObject> = emptyList()) {
            if (text.isEmpty() && attachments.isEmpty()) return
            val wasHeld = held
            held = false
            if (!wasHeld && (running || queue.isNotEmpty())) {
                val item = QueuedMessage(
                    UUID.randomUUID().toString().take(8), text, clock(),
                    attachments.map { AttachedFile(it["name"].str ?: "file", it["mimeType"].str ?: "application/octet-stream") },
                )
                queue += item
                if (attachments.isNotEmpty()) queuedFiles[item.id] = attachments
                toChat(id, queueMessage())
                return
            }
            deliver(text, attachments)
            if (wasHeld) toChat(id, queueMessage())
        }

        /** A message from Dex itself (a confirmation's answer), delivered like one of yours. */
        fun tell(text: String) = send(text)

        private fun deliver(text: String, attachments: List<JsonObject> = emptyList()) {
            val entry = Pi.entry(nextId++, "pi.user", Pi.userMessage(text, attachments, clock()))
            entries += entry
            events(buildJsonObject { put("type", "entry_appended"); put("entry", entry) })
            val title = text.ifEmpty { attachmentSummary(attachments.map { it["name"].str ?: "file" }) }
            updateSession(id) { it.copy(title = if (it.title == "New chat") title.replace(Regex("\\s+"), " ").take(60) else it.title, updatedAt = clock(), settledAt = null, snoozedUntil = null) }
            val character = state.character(state.session(id)?.characterId)
            run(if (character != null) Scripts.companion(character.name) else Scripts.pick(text) { (nextId + 1).toString() })
        }

        private fun at(delay: Long, block: () -> Unit) {
            pending += worker.schedule(block, delay, TimeUnit.MILLISECONDS)
        }

        /** Streams a reply: run_start, each model message with its deltas, tools with live output, run_end. */
        private fun run(steps: List<Step>) {
            running = true
            updateSession(id) { it.copy(busy = true) }
            var t = chunkMs
            fun later(block: () -> Unit) {
                at(t, block)
                t += chunkMs
            }
            later { events(buildJsonObject { put("type", "run_start"); put("inputs", JsonArray(emptyList())) }) }
            val turns = mutableListOf<MutableList<Step>>(mutableListOf())
            for (step in steps) if (step == Step.Turn) turns += mutableListOf<Step>() else turns.last() += step
            for (turn in turns.filter { it.isNotEmpty() }) {
                val started = clock()
                val content = mutableListOf<JsonObject>()
                later {
                    streaming = Pi.assistantMessage(emptyList(), clock(), stopReason = "pending")
                    events(buildJsonObject { put("type", "message_start"); put("message", streaming!!) })
                }
                val tools = mutableListOf<Pair<String, Step.Tool>>()
                var failed: String? = null
                for (step in turn) {
                    val index = content.size
                    when (step) {
                        is Step.Think -> {
                            content += Pi.thinking(step.text)
                            later { change(buildJsonObject { put("type", "thinking_start"); put("contentIndex", index); put("block", Pi.thinking("")) }) }
                            step.text.chunked(18).forEach { piece -> later { change(buildJsonObject { put("type", "thinking_delta"); put("contentIndex", index); put("delta", piece) }) } }
                        }
                        is Step.Say -> {
                            content += Pi.text(step.text)
                            later { change(buildJsonObject { put("type", "text_start"); put("contentIndex", index); put("block", Pi.text("")) }) }
                            step.text.chunked(14).forEach { piece -> later { change(buildJsonObject { put("type", "text_delta"); put("contentIndex", index); put("delta", piece) }) } }
                        }
                        is Step.Tool -> {
                            val callId = "call_${id}_${UUID.randomUUID().toString().take(6)}"
                            content += Pi.toolCall(callId, step.name, step.args)
                            tools += callId to step
                            val streamed = step.streamArg
                            val initial = if (streamed != null) JsonObject(step.args - streamed) else step.args
                            later { change(buildJsonObject { put("type", "toolcall_start"); put("contentIndex", index); put("block", Pi.toolCall(callId, step.name, initial)) }) }
                            if (streamed != null) {
                                step.args[streamed].str.orEmpty().chunked(40).forEach { piece ->
                                    later { change(buildJsonObject { put("type", "toolcall_delta"); put("contentIndex", index); put("path", buildJsonArray { add(JsonPrimitive(streamed)) }); put("delta", piece) }) }
                                }
                            }
                        }
                        is Step.Fail -> failed = step.message
                        Step.Turn -> Unit
                    }
                }
                val message = Pi.assistantMessage(content.toList(), started, 2_500, stopReason = if (failed != null) "error" else if (tools.isNotEmpty()) "toolUse" else "stop", error = failed)
                later {
                    streaming = null
                    val entry = Pi.entry(nextId++, "pi.assistant", message)
                    entries += entry
                    events(buildJsonObject { put("type", "message_end"); put("entry", entry) })
                }
                for ((callId, tool) in tools) {
                    later {
                        events(buildJsonObject { put("type", "tool_execution_start"); put("toolCallId", callId); put("toolName", tool.name); put("args", tool.args) })
                        if (tool.name == "vm_exec") {
                            setVm(id) { it.copy(status = VmStatus.Running, busy = true, lastActiveAt = clock()) }
                            vmRunning = activity(id, "agent", "exec", tool.args["command"].str ?: "", "running", "")
                        }
                    }
                    for (chunk in tool.live) later {
                        events(buildJsonObject { put("type", "tool_execution_update"); put("toolCallId", callId); put("toolName", tool.name); put("output", buildJsonObject { put("append", chunk) }) })
                        vmRunning?.let { broadcast(buildJsonObject { put("type", "dex.vm.output"); put("sessionId", JsonNull); put("vmKey", id); put("id", it); put("data", chunk) }) }
                    }
                    later {
                        val entry = Pi.entry(nextId++, "pi.toolResult", Pi.toolResult(callId, tool.name, tool.result, clock(), tool.isError, tool.details, tool.image))
                        entries += entry
                        events(buildJsonObject { put("type", "tool_execution_end"); put("toolCallId", callId); put("toolName", tool.name); put("entry", entry) })
                        if (tool.name == "share_media") {
                            artifacts += ChatArtifact("user-octocat/0b4f2c3e-1111-2222-3333-444455556666.png", "/api/media/user-octocat/0b4f2c3e-1111-2222-3333-444455556666.png", "chart.png", "image", 2910, null, clock())
                            toChat(id, artifactsMessage())
                        }
                        if (tool.name == "app_call" && tool.details != null) {
                            update { s -> s.copy(access = s.access.copy(pending = listOf(PendingAction("p-chat", id, "app_update_settings", "Change the default model to Kimi K3", clock(), "pending")) + s.access.pending.filter { it.id != "p-chat" })) }
                        }
                        vmRunning?.let {
                            finishActivity(id, it, "error", 1, tool.result)
                            setVm(id) { vm -> vm.copy(busy = false) }
                            vmRunning = null
                        }
                    }
                }
            }
            later { finish() }
        }

        private var vmRunning: Long? = null

        private fun change(change: JsonObject) = events(buildJsonObject { put("type", "message_update"); put("usage", JsonObject(emptyMap())); put("changes", JsonArray(listOf(change))) })

        private fun finish() {
            running = false
            streaming = null
            events(buildJsonObject { put("type", "run_end"); put("inputs", JsonArray(emptyList())) })
            updateSession(id) { it.copy(busy = false, updatedAt = clock()) }
            if (!held && queue.isNotEmpty()) {
                val next = queue.removeAt(0)
                toChat(id, queueMessage())
                deliver(next.text, queuedFiles.remove(next.id).orEmpty())
            }
        }

        fun abort() {
            if (!running) return
            pending.forEach { it.cancel(false) }
            pending.clear()
            if (queue.isNotEmpty()) held = true
            streaming?.let { message ->
                val entry = Pi.entry(nextId++, "pi.assistant", JsonObject(message + ("stopReason" to JsonPrimitive("aborted"))))
                entries += entry
                events(buildJsonObject { put("type", "message_end"); put("entry", entry) })
            }
            vmRunning?.let { finishActivity(id, it, "error", 130, "[stopped]") }
            vmRunning = null
            running = false
            streaming = null
            events(buildJsonObject { put("type", "run_end"); put("inputs", JsonArray(emptyList())) })
            updateSession(id) { it.copy(busy = false) }
            toChat(id, queueMessage())
        }

        fun edit(itemId: String, text: String) {
            if (text.isBlank()) error("A message can't be empty: delete it instead.")
            val index = queue.indexOfFirst { it.id == itemId }
            if (index < 0) error("That message was already sent or removed.")
            queue[index] = queue[index].copy(text = text.trim())
            toChat(id, queueMessage())
        }

        fun removeQueued(itemId: String) {
            if (!queue.removeAll { it.id == itemId }) error("That message was already sent or removed.")
            if (queue.isEmpty()) held = false
            toChat(id, queueMessage())
        }

        fun move(itemId: String, index: Int) {
            val item = queue.firstOrNull { it.id == itemId } ?: error("That message was already sent or removed.")
            queue.remove(item)
            queue.add(index.coerceIn(0, queue.size), item)
            toChat(id, queueMessage())
        }

        fun steer(itemId: String) {
            val item = queue.firstOrNull { it.id == itemId } ?: error("That message was already sent or removed.")
            queue.remove(item)
            held = false
            toChat(id, queueMessage())
            val files = queuedFiles.remove(item.id).orEmpty()
            if (running) {
                val entry = Pi.entry(nextId++, "pi.user", Pi.userMessage(item.text, files, clock()))
                entries += entry
                events(buildJsonObject { put("type", "entry_appended"); put("entry", entry) })
            } else deliver(item.text, files)
        }
    }
}
