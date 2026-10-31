package dev.trydex.fake

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.core.client.AgentConnection
import dev.trydex.core.client.ConnectionStatus
import dev.trydex.core.client.DexApi
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexUploads
import dev.trydex.core.client.DexUser
import dev.trydex.core.client.asRpc
import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.ClientMessages
import dev.trydex.core.model.DisplayItem
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.ProjectRepo
import dev.trydex.core.model.ServerMessage
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.ToolCallBlock
import dev.trydex.core.model.TranscriptReducer
import dev.trydex.core.model.TranscriptState
import dev.trydex.core.model.displayItems
import dev.trydex.openui.DexLibrary
import dev.trydex.openui.OpenUIParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Test

/** FakeDex speaks the protocol the real client expects, and its scripted UIs are valid OpenUI Lang. */
class FakeDexTest {
    private val fake = FakeDex(chunkMs = 1)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @After fun stop() {
        scope.cancel()
        fake.close()
    }

    @Test fun scriptedProgramsParseCleanly() {
        val parser = OpenUIParser(DexLibrary.catalog)
        for (program in listOf(Scripts.DASHBOARD, Scripts.FORM)) {
            val result = parser.parse(program)
            assertWithMessage(result.meta.errors.joinToString { it.message }).that(result.meta.errors).isEmpty()
            assertThat(result.root).isNotNull()
            assertThat(result.meta.unresolved).isEmpty()
        }
    }

    @Test fun connectsChatsAndStreams() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        var transcript = TranscriptState.Empty
        scope.launch { connection.messages.collect { message -> if (message.sessionId != null) transcript = reduce(transcript, message) } }
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }
        assertThat(connection.state.value!!.sessions.map { it.title }).contains("Weekly metrics dashboard")

        val session = api.createSession(null, null, agentId = "researcher", mcpServers = null, projectId = null)
        assertThat(session.agentId).isEqualTo("researcher")
        connection.send(ClientMessages.subscribe(session.id))
        api.sendMessage(session.id, "Make me a dashboard chart")
        withTimeout(10_000) {
            while (!(transcript.loaded && !transcript.running && transcript.entries.size >= 5)) kotlinx.coroutines.delay(20)
        }
        val items = displayItems(transcript)
        assertThat(items.first()).isInstanceOf(DisplayItem.User::class.java)
        val reply = items.last() as DisplayItem.Assistant
        assertThat(reply.messages.flatMap { it.content }.filterIsInstance<ToolCallBlock>().map { it.name }).containsExactly("load_ui_guide", "render_ui").inOrder()
        // The title came from the first message, and the chat isn't busy any more.
        val meta = connection.state.value!!.session(session.id)!!
        assertThat(meta.title).isEqualTo("Make me a dashboard chart")
        assertThat(meta.busy).isFalse()
        connection.stop()
    }

    @Test fun sendsAttachments() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        var transcript = TranscriptState.Empty
        scope.launch { connection.messages.collect { message -> if (message.sessionId != null) transcript = reduce(transcript, message) } }
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }
        val session = DexSession(url.toString(), fake.token, DexUser(FakeData.USER_ID, FakeData.LOGIN), Long.MAX_VALUE)
        val photo = DexUploads.upload(OkHttpClient(), session, byteArrayOf(1, 2, 3), "shot.png", "image/png")
        val report = DexUploads.upload(OkHttpClient(), session, "%PDF".toByteArray(), "report.pdf", "application/pdf")
        assertThat(photo.kind).isEqualTo("image")
        assertThat(report.kind).isEqualTo("text")
        val refused = runCatching { DexUploads.upload(OkHttpClient(), session, byteArrayOf(0), "a.zip", "application/zip") }.exceptionOrNull()
        assertThat(refused!!.message).isEqualTo("Dex can't read .zip files yet.")

        val chat = api.createSession(null, null, agentId = null, mcpServers = null, projectId = null)
        connection.send(ClientMessages.subscribe(chat.id))
        api.sendMessage(chat.id, "", listOf(photo, report))
        withTimeout(10_000) { while (displayItems(transcript).none { it is DisplayItem.User }) kotlinx.coroutines.delay(20) }
        val sent = displayItems(transcript).first { it is DisplayItem.User } as DisplayItem.User
        assertThat(sent.text).isEmpty()
        assertThat(sent.files.map { it.name }).containsExactly("shot.png", "report.pdf").inOrder()
        assertThat(sent.imageParts).hasSize(1)
        assertThat(fake.calls.last { it.first == "sendMessage" }.second).hasSize(3)
        // A chat named after its files when the message has no text.
        assertThat(connection.state.value!!.session(chat.id)!!.title).isEqualTo("shot.png and 1 more")
        connection.stop()
    }

    @Test fun queuesWhileBusyAndAnswersErrors() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }
        val queues = mutableListOf<ServerMessage.Queue>()
        scope.launch { connection.messages.collect { if (it is ServerMessage.Queue) queues += it } }
        connection.send(ClientMessages.subscribe("chat-research"))
        api.sendMessage("chat-research", "Explain HNSW")
        api.sendMessage("chat-research", "And IVF?")
        withTimeout(5_000) { while (queues.none { it.items.isNotEmpty() }) kotlinx.coroutines.delay(10) }
        assertThat(queues.last { it.items.isNotEmpty() }.items.single().text).isEqualTo("And IVF?")
        val error = runCatching { api.snooze("chat-research", 1L) }.exceptionOrNull()
        assertThat(error!!.message).isEqualTo("Pick a time in the next year.")
        connection.stop()
    }

    @Test fun savesProjectsAndAgents() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }

        // A new project gets an id from its name; owner/repo becomes a clone URL.
        val created = api.saveProject(DexApi.projectDraft(ProjectProfile(id = "", name = "My App", repos = listOf(ProjectRepo("octocat/app")), image = "data:image/png;base64,AAAA")))
        assertThat(created.id).startsWith("my-app-")
        assertThat(created.repos.single().url).isEqualTo("https://github.com/octocat/app.git")
        // No picture clears it; leaving the field out keeps it.
        assertThat(api.saveProject(DexApi.projectDraft(created.copy(image = null))).image).isNull()
        api.saveProject(DexApi.projectDraft(created))
        val kept = DexApi.projectDraft(created.copy(description = "Changed")).toMutableMap().apply { remove("image") }
        assertThat(api.saveProject(JsonObject(kept)).image).isEqualTo("data:image/png;base64,AAAA")
        assertThat(runCatching { api.saveProject(DexApi.projectDraft(ProjectProfile(id = "", name = " "))) }.exceptionOrNull()!!.message).isEqualTo("Give the project a name.")

        // Deleting a project keeps its chats, without the project.
        api.deleteProject("dex-web")
        withTimeout(5_000) { while (connection.state.value!!.project("dex-web") != null) kotlinx.coroutines.delay(10) }
        assertThat(connection.state.value!!.sessions.none { it.projectId == "dex-web" }).isTrue()

        val agent = api.saveAgent(DexApi.agentDraft(AgentProfile(id = "", name = "Triage", thinking = ThinkingLevel.High, mcpServers = listOf("github"))))
        assertThat(agent.id).startsWith("triage-")
        assertThat(agent.thinking).isEqualTo(ThinkingLevel.High)
        assertThat(api.searchGitHubRepos("", "acme").map { it.fullName }).containsExactly("acme/api")
        connection.stop()
    }

    @Test fun charactersLiveInTheirOwnConversations() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }
        val seeded = connection.state.value!!
        assertThat(seeded.characters.map { it.name }).containsExactly("Muse", "Atlas").inOrder()
        assertThat(seeded.chats.none { it.characterId != null }).isTrue()
        assertThat(api.characterMemory("muse")).contains("space cats")

        // Seeded with ready-made looks, as the demo shows them.
        assertThat(seeded.characters.all { it.image!!.startsWith("data:image/png;base64,") && it.look != null }).isTrue()

        // Creating one starts their conversation, titled with their name; a template brings its look.
        val draft = Characters.TEMPLATES.first { it.key == "rex" }.applyTo(CharacterProfile("", thinking = ThinkingLevel.Low))
        val rex = api.saveCharacter(DexApi.characterDraft(draft, picture = true))
        assertThat(rex.id).startsWith("rex-")
        assertThat(rex.look).isEqualTo(Characters.preset("rex")!!.look)
        assertThat(rex.image).isEqualTo(Characters.preset("rex")!!.dataUrl)
        withTimeout(5_000) { while (connection.state.value!!.session(rex.sessionId) == null) kotlinx.coroutines.delay(10) }
        val chat = connection.state.value!!.session(rex.sessionId)!!
        assertThat(chat.characterId).isEqualTo(rex.id)
        assertThat(chat.title).isEqualTo("Rex")
        assertThat(runCatching { api.saveCharacter(DexApi.characterDraft(draft.copy(name = " "), picture = false)) }.exceptionOrNull()!!.message).isEqualTo("Give your sidekick a name.")

        // Renaming renames the conversation; leaving the picture and look out keeps them.
        val renamed = api.saveCharacter(DexApi.characterDraft(rex.copy(name = "Coach Rex", image = null, look = null), picture = false))
        assertThat(renamed.image).isEqualTo(rex.image)
        assertThat(renamed.look).isEqualTo(rex.look)
        withTimeout(5_000) { while (connection.state.value!!.session(rex.sessionId)?.title != "Coach Rex") kotlinx.coroutines.delay(10) }
        // A photo replaces the look; null removes the picture.
        val photo = api.saveCharacter(DexApi.characterDraft(rex.copy(image = "data:image/webp;base64,AAAA", look = null), picture = true))
        assertThat(photo.look).isNull()
        assertThat(photo.image).isEqualTo("data:image/webp;base64,AAAA")
        assertThat(api.saveCharacter(DexApi.characterDraft(rex.copy(image = null, look = null), picture = true)).image).isNull()

        // Start over: a new conversation; the old one never got a message, so it goes.
        val restarted = api.restartCharacter(rex.id)
        assertThat(restarted.sessionId).isNotEqualTo(rex.sessionId)
        withTimeout(5_000) { while (connection.state.value!!.session(rex.sessionId) != null) kotlinx.coroutines.delay(10) }
        // Muse's had messages: it stays, as an earlier conversation.
        val muse = api.restartCharacter("muse")
        withTimeout(5_000) { while (connection.state.value!!.session(muse.sessionId) == null) kotlinx.coroutines.delay(10) }
        assertThat(Characters.conversations(connection.state.value!!, muse).map { it.id }).containsAtLeast(muse.sessionId, "chat-muse", "chat-muse-earlier")

        api.saveCharacterMemory("muse", "- Likes space cats.")
        assertThat(api.characterMemory("muse")).isEqualTo("- Likes space cats.")
        api.saveCharacterMemory("muse", "")
        assertThat(api.characterMemory("muse")).isEmpty()

        // Deleting keeps their conversations, as ordinary chats (the untouched new one goes).
        api.deleteCharacter("muse")
        withTimeout(5_000) { while (connection.state.value!!.character("muse") != null) kotlinx.coroutines.delay(10) }
        val after = connection.state.value!!
        assertThat(after.chats.map { it.id }).containsAtLeast("chat-muse", "chat-muse-earlier")
        assertThat(after.session(muse.sessionId)).isNull()
        assertThat(runCatching { api.characterMemory("muse") }.exceptionOrNull()!!.message).isEqualTo("That sidekick no longer exists.")
        connection.stop()
    }

    @Test fun unreadReadAndPush() = runBlocking {
        val url = fake.start()
        val connection = AgentConnection(OkHttpClient(), url, FakeData.USER_ID, { fake.token }, scope)
        val api = DexApi(connection.asRpc())
        connection.start()
        withTimeout(5_000) { connection.status.first { it == ConnectionStatus.Connected } }
        suspend fun until(check: (dev.trydex.core.model.DexState) -> Boolean) = withTimeout(5_000) { while (!check(connection.state.value!!)) kotlinx.coroutines.delay(10) }
        val seeded = connection.state.value!!
        // Atlas reached out on his own and you haven't seen it; his check-in is a scheduled note in his chat.
        assertThat(seeded.session("chat-atlas")!!.unread).isTrue()
        assertThat(seeded.session("chat-atlas")!!.lastReply).isEqualTo(FakeData.ATLAS_CHECK_IN)
        assertThat(seeded.character("atlas")!!.notifyLevel).isEqualTo(dev.trydex.core.model.SidekickNotify.Reachouts)
        assertThat(seeded.session("chat-muse")!!.unread).isFalse()

        api.markSessionRead("chat-atlas")
        until { !it.session("chat-atlas")!!.unread }
        api.markSessionUnread("chat-atlas")
        until { it.session("chat-atlas")!!.unread }
        // Showing a chat (presence) marks it read, as the agent does.
        connection.send(ClientMessages.presence(true, "chat-atlas"))
        until { !it.session("chat-atlas")!!.unread }

        // A check-in while you look elsewhere comes in unread, with its words.
        connection.send(ClientMessages.presence(false, null))
        fake.checkIn("chat-muse", "Ask how the game is going", "How's Purrlanet coming along?")
        until { it.session("chat-muse")!!.unread }
        assertThat(connection.state.value!!.session("chat-muse")!!.lastReply).isEqualTo("How's Purrlanet coming along?")

        // The app's push token: registered (upserted by token), its kinds changed, tested, and removed.
        val token = "fcm-token-" + "x".repeat(40)
        val id = api.registerNativePush("android", token, null, "Pixel 9 · Android app")
        assertThat(api.registerNativePush("android", token, null, "Pixel 9 · Android app")).isEqualTo(id)
        until { it.push.devices.any { device -> device.id == id } }
        val device = connection.state.value!!.push.devices.single { it.id == id }
        assertThat(device.platform).isEqualTo("android")
        assertThat(device.kinds.first()).isEqualTo("sidekick")
        api.pushUpdate(id, kinds = listOf("sidekick"), onlyWhenAway = false)
        until { it.push.devices.single { device -> device.id == id }.kinds == listOf("sidekick") }
        assertThat(connection.state.value!!.push.devices.single { it.id == id }.onlyWhenAway).isFalse()
        assertThat(api.pushTest(id)).isNull()
        assertThat(runCatching { api.registerNativePush("android", "short", null, "x") }.exceptionOrNull()!!.message).isEqualTo("That isn't a push token.")
        api.pushUnsubscribe(id)
        until { it.push.devices.none { device -> device.id == id } }
        connection.stop()
    }

    @Test fun sidekicksForTheWidgets() = runBlocking<Unit> {
        val url = fake.start()
        val session = DexSession(url.toString(), fake.token, DexUser(FakeData.USER_ID, FakeData.LOGIN), Long.MAX_VALUE)
        val full = dev.trydex.core.client.DexSidekicks.fetch(OkHttpClient(), session)
        assertThat(full.unread).isEqualTo(2)
        assertThat(full.sidekicks.map { it.name }).containsExactly("Muse", "Atlas").inOrder()
        assertThat(full.sidekick("atlas")!!.unread).isTrue()
        assertThat(full.sidekick("atlas")!!.image).startsWith("data:image/png;base64,")
        val light = dev.trydex.core.client.DexSidekicks.fetch(OkHttpClient(), session, images = false)
        assertThat(light.sidekicks.all { it.image == null }).isTrue()
        assertThat(light.sidekick("atlas")!!.lastReply).isEqualTo(FakeData.ATLAS_CHECK_IN)
        val signedOut = runCatching { dev.trydex.core.client.DexSidekicks.fetch(OkHttpClient(), session.copy(token = "nope")) }.exceptionOrNull()
        assertThat((signedOut as dev.trydex.core.client.SidekicksException).status).isEqualTo(401)
    }

    private fun reduce(state: TranscriptState, message: ServerMessage) = when (message) {
        is ServerMessage.Snapshot -> TranscriptReducer.fromSnapshot(message.snapshot, state)
        is ServerMessage.Events -> TranscriptReducer.applyAll(state, message.events)
        else -> state
    }
}
