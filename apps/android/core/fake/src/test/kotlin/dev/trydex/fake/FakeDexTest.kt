package dev.trydex.fake

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.core.client.AgentConnection
import dev.trydex.core.client.ConnectionStatus
import dev.trydex.core.client.DexApi
import dev.trydex.core.client.asRpc
import dev.trydex.core.model.ClientMessages
import dev.trydex.core.model.DisplayItem
import dev.trydex.core.model.ServerMessage
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

    private fun reduce(state: TranscriptState, message: ServerMessage) = when (message) {
        is ServerMessage.Snapshot -> TranscriptReducer.fromSnapshot(message.snapshot, state)
        is ServerMessage.Events -> TranscriptReducer.applyAll(state, message.events)
        else -> state
    }
}
