package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Test

/** Spaces as the web has them (tools/goldens/spaces.mts), and how they keep out of the chat list. */
class SpacesTest {
    private val golden: JsonObject =
        DexJson.parseToJsonElement(javaClass.getResourceAsStream("/golden/spaces.json")!!.bufferedReader().use { it.readText() }).jsonObject

    @Test fun labelsAndOrder() {
        for (status in ThreadStatus.entries) assertThat(golden["labels"]!!.jsonObject[status.id].str).isEqualTo(status.label)
        assertThat(Spaces.ORDER.map { it.id }).isEqualTo(golden["order"]!!.jsonArray.map { it.str })
    }

    @Test fun parsesUpdatesAsTheWebDoes() {
        for (case in golden["parse"]!!.jsonArray.map { it.jsonObject }) {
            val input = case["input"].str!!
            val expected = case["updates"]
            val parsed = Spaces.parseUpdates(input)
            if (expected == null || expected is JsonNull) {
                assertWithMessage(input).that(parsed).isNull()
                continue
            }
            assertWithMessage(input).that(parsed?.map { listOf(it.threadId, it.title, it.outcome.id, it.body) })
                .isEqualTo(expected.jsonArray.map { u -> listOf(u["threadId"].str, u["title"].str, u["outcome"].str, u["body"].str) })
        }
    }

    @Test fun writesUpdatesTheParserReads() {
        val text = Spaces.update("chat-a1", "Write the “release” notes", SpaceUpdate.Outcome.Finished, "  Done: notes are in docs/RELEASE.md.\n\n- 12 items  ")
        // The same message the web writes for the golden's first case.
        assertThat(text).isEqualTo(golden["parse"]!!.jsonArray.first().jsonObject["input"].str)
        assertThat(Spaces.update("t", "Fix CI", SpaceUpdate.Outcome.Failed, "")).isEqualTo("[Space update] Thread “Fix CI” (t) failed.")
    }

    @Test fun threadStatusAsTheWebHasIt() {
        val status = golden["status"]!!.jsonObject
        val pending = DexJson.decodeFromJsonElement(ListSerializer(PendingAction.serializer()), status["pending"]!!)
        for (case in status["cases"]!!.jsonArray.map { it.jsonObject }) {
            val session = DexJson.decodeFromJsonElement(SessionMeta.serializer(), case["session"]!!)
            assertWithMessage(session.id).that(Spaces.threadStatus(session, pending).id).isEqualTo(case["status"].str)
        }
    }

    @Test fun threadsAreTheSpacesOtherChatsNewestFirst() {
        val threads = golden["threads"]!!.jsonObject
        val space = DexJson.decodeFromJsonElement(SpaceProfile.serializer(), threads["space"]!!)
        val sessions = DexJson.decodeFromJsonElement(ListSerializer(SessionMeta.serializer()), threads["sessions"]!!)
        assertThat(Spaces.threads(space, sessions).map { it.id }).isEqualTo(threads["ids"]!!.jsonArray.map { it.str })
    }

    private val space = SpaceProfile("sp1", "Launch", goal = "Ship Android 2.4\nwith release notes", sessionId = "c1")
    private val state = DexState(
        spaces = listOf(space),
        sessions = listOf(
            SessionMeta("c1", "Launch", spaceId = "sp1", unread = true),
            SessionMeta("t1", "Notes", createdAt = 3, spaceId = "sp1", busy = true, unread = true),
            SessionMeta("t2", "CI", createdAt = 2, spaceId = "sp1", repliedAt = 5, unread = true),
            SessionMeta("t3", "Icons", createdAt = 1, spaceId = "sp1"),
            SessionMeta("plain", "Plain", unread = true),
            SessionMeta("muse", "Muse", characterId = "muse"),
        ),
        access = AccessState(pending = listOf(PendingAction("p1", "t3", status = "pending"))),
    )

    @Test fun spaceChatsLiveUnderTheirSpace() {
        assertThat(state.chats.map { it.id }).containsExactly("plain")
        assertThat(state.coordinatedSpace(state.session("c1"))).isEqualTo(space)
        assertThat(state.coordinatedSpace(state.session("t1"))).isNull()
        assertThat(state.isThread(state.session("t1")!!)).isTrue()
        assertThat(state.isThread(state.session("c1")!!)).isFalse()
        assertThat(state.isThread(state.session("plain")!!)).isFalse()
        // The coordinator counts toward the badge; its threads report back there instead.
        assertThat(state.unreadCount).isEqualTo(2)
    }

    @Test fun summaries() {
        val threads = Spaces.threads(space, state.sessions)
        assertThat(Spaces.summary(space, threads, state.access.pending)).isEqualTo("1 working · 1 needs you")
        assertThat(Spaces.summary(space, threads.filter { it.id == "t2" }, emptyList())).isEqualTo("Ship Android 2.4")
        assertThat(Spaces.summary(space.copy(goal = ""), emptyList(), emptyList())).isEqualTo("No threads yet")
        assertThat(Spaces.summary(space.copy(goal = " "), threads.filter { it.id == "t2" }, emptyList())).isEqualTo("1 thread")
        assertThat(Spaces.grouped(threads, state.access.pending).map { (status, list) -> status to list.map { it.id } })
            .containsExactly(ThreadStatus.NeedsYou to listOf("t3"), ThreadStatus.Working to listOf("t1"), ThreadStatus.Done to listOf("t2")).inOrder()
    }

    @Test fun startedThreadFromTheToolResult() {
        val details = buildJsonObject { putJsonObject("thread") { put("id", "t9"); put("title", "Write the notes") } }
        assertThat(Spaces.startedThread(details)).isEqualTo(StartedThread("t9", "Write the notes"))
        assertThat(Spaces.startedThread(buildJsonObject { putJsonObject("thread") { put("title", "no id") } })).isNull()
        assertThat(Spaces.startedThread(null)).isNull()
        assertThat(Spaces.startedThread(JsonNull)).isNull()
    }

    @Test fun olderAgentsSendNoneOfIt() {
        val old = DexJson.decodeFromString(DexState.serializer(), """{"sessions":[{"id":"a","title":"A"}]}""")
        assertThat(old.spaces).isEmpty()
        assertThat(old.sessions.single().spaceId).isNull()
        assertThat(old.sessions.single().failed).isFalse()
        val current = DexJson.decodeFromString(
            DexState.serializer(),
            """{"spaces":[{"id":"sp1","name":"Launch","goal":"","projectId":null,"sessionId":"c1","createdAt":1,"updatedAt":2,"later":true}],
               "sessions":[{"id":"c1","spaceId":"sp1","failed":true},{"id":"t1","spaceId":null}]}""",
        )
        assertThat(current.spaces.single().sessionId).isEqualTo("c1")
        assertThat(current.sessions.map { it.spaceId }).containsExactly("sp1", null).inOrder()
        assertThat(current.sessions.first().failed).isTrue()
    }
}
