package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.UiOperationResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

/** The wrappers send the argument shapes DexAgent's callables expect and read their results. */
class DexApiTest {
    private data class Call(val method: String, val args: String, val timeout: Long)

    private val calls = mutableListOf<Call>()
    private var result: String = "null"
    private val api = DexApi { method, args, timeout ->
        calls += Call(method, kotlinx.serialization.json.JsonArray(args).toString(), timeout)
        DexJson.parseToJsonElement(result)
    }

    @Test fun createSession() = runBlocking<Unit> {
        result = """{"id":"s9","title":"New chat","model":"cline-pass/glm-5.3","thinking":"high"}"""
        val session = api.createSession("cline-pass/glm-5.3", ThinkingLevel.High, agentId = null, mcpServers = listOf("gh"), projectId = "p1")
        assertThat(session.id).isEqualTo("s9")
        assertThat(session.thinking).isEqualTo(ThinkingLevel.High)
        assertThat(calls.single().method).isEqualTo("createSession")
        assertThat(calls.single().args)
            .isEqualTo("""[{"model":"cline-pass/glm-5.3","thinking":"high","agentId":null,"mcpServers":["gh"],"projectId":"p1"}]""")
    }

    @Test fun optionalArgumentsAreLeftOutNotNull() = runBlocking<Unit> {
        result = "[]"
        api.searchGitHubRepos("dex", null)
        api.searchGitHubRepos("dex", "acme")
        assertThat(calls.map { it.args }).containsExactly("""["dex"]""", """["dex","acme"]""").inOrder()
    }

    @Test fun secretsKeepTheirNote() = runBlocking<Unit> {
        result = "\"MY_KEY\""
        assertThat(api.saveSecret("MY_KEY", "v", "for tests")).isEqualTo("MY_KEY")
        api.saveSecret("MY_KEY", null, "for tests")
        assertThat(calls.map { it.args }).containsExactly("""["MY_KEY","v","for tests"]""", """["MY_KEY",null,"for tests"]""").inOrder()
    }

    @Test fun triage() = runBlocking<Unit> {
        api.settle("s1", true)
        api.snooze("s1", 1234L)
        api.snooze("s1", null)
        assertThat(calls.map { it.method }.distinct()).containsExactly("triageSession")
        assertThat(calls.map { it.args }).containsExactly(
            """["s1",{"settled":true}]""",
            """["s1",{"snoozedUntil":1234}]""",
            """["s1",{"snoozedUntil":null}]""",
        ).inOrder()
    }

    @Test fun configureSendsOnlyWhatChanged() = runBlocking<Unit> {
        api.configureSession("s1", thinking = ThinkingLevel.XHigh)
        api.configureSession("s1", mcpServers = emptyList())
        assertThat(calls.map { it.args }).containsExactly("""["s1",{"thinking":"xhigh"}]""", """["s1",{"mcpServers":[]}]""").inOrder()
    }

    @Test fun uiOperations() = runBlocking<Unit> {
        result = """{"ok":"confirm","summary":"Delete the chat “x”"}"""
        val confirm = api.runUiOperation("s1", "app_delete_session", JsonObject(mapOf("id" to JsonPrimitive("x"))), query = false)
        assertThat(confirm).isEqualTo(UiOperationResult.Confirm("Delete the chat “x”"))
        result = """{"ok":true,"result":{"rows":[1]},"changed":"Deleted x"}"""
        val ok = api.runUiOperation("s1", "app_delete_session", JsonObject(emptyMap()), query = false, confirmed = true) as UiOperationResult.Ok
        assertThat(ok.changed).isEqualTo("Deleted x")
        assertThat(calls.last().args).endsWith("""{"query":false,"confirmed":true}]""")
        result = """{"ok":false,"error":"Not allowed"}"""
        assertThat(api.runUiOperation("s1", "x", JsonObject(emptyMap()), query = true)).isEqualTo(UiOperationResult.Failed("Not allowed"))
    }

    @Test fun longCallsGetLongTimeouts() = runBlocking<Unit> {
        result = """{"ok":true,"id":"m1"}"""
        api.saveMcpServer(JsonObject(emptyMap()))
        result = """{"exitCode":0,"output":"hi"}"""
        assertThat(api.vmRun("s1", "echo hi").output).isEqualTo("hi")
        result = "null"
        assertThat(api.vmDesktopUrl("s1", "selkies")).isNull()
        assertThat(calls.map { it.timeout }).containsExactly(AgentConnection.LONG_TIMEOUT_MS, AgentConnection.VM_TIMEOUT_MS, 300_000L).inOrder()
    }

    @Test fun characters() = runBlocking<Unit> {
        // New: no id, no conversation or timestamps; a changed picture and look go explicitly (null removes them).
        val draft = DexApi.characterDraft(CharacterProfile("", name = "Muse", image = "data:image/png;base64,AA", sessionId = "x", createdAt = 1, updatedAt = 2), picture = true)
        assertThat(draft.keys).containsNoneOf("id", "sessionId", "createdAt", "updatedAt")
        assertThat(draft["image"].toString()).isEqualTo("\"data:image/png;base64,AA\"")
        assertThat(draft["look"].toString()).isEqualTo("null")
        // Unchanged, they're left out so the agent keeps them.
        val kept = DexApi.characterDraft(CharacterProfile("muse", name = "Muse", look = SidekickLook("blob"), image = "data:image/png;base64,AA"), picture = false)
        assertThat(kept["id"].toString()).isEqualTo("\"muse\"")
        assertThat(kept.keys).containsNoneOf("image", "look")
        result = """{"id":"muse","name":"Muse","sessionId":"s2"}"""
        assertThat(api.restartCharacter("muse").sessionId).isEqualTo("s2")
        result = "\"- likes cats\""
        assertThat(api.characterMemory("muse")).isEqualTo("- likes cats")
        result = "null"
        api.saveCharacterMemory("muse", "")
        api.deleteCharacter("muse")
        assertThat(calls.map { it.method }).containsExactly("restartCharacter", "characterMemory", "saveCharacterMemory", "deleteCharacter").inOrder()
        assertThat(calls[2].args).isEqualTo("""["muse",""]""")
    }

    @Test fun unreadAndPush() = runBlocking<Unit> {
        api.markSessionRead("s1")
        api.markSessionUnread("s1")
        result = "\"a1b2\""
        assertThat(api.registerNativePush("android", "tok:en-123", null, "Pixel 9 · Android app")).isEqualTo("a1b2")
        assertThat(calls.map { it.method }).containsExactly("markSessionRead", "markSessionUnread", "registerNativePush").inOrder()
        assertThat(calls[2].args).isEqualTo("""["android","tok:en-123",null,"Pixel 9 · Android app"]""")
    }

    @Test fun aSidekicksNotificationsKeepTheirPicture() {
        val draft = DexApi.characterNotifyDraft(
            CharacterProfile("atlas", name = "Atlas", look = SidekickLook("blob"), image = "data:image/png;base64,AA", sessionId = "s", createdAt = 1),
            dev.trydex.core.model.SidekickNotify.Reachouts,
        )
        assertThat(draft["notify"].toString()).isEqualTo("\"reachouts\"")
        assertThat(draft["id"].toString()).isEqualTo("\"atlas\"")
        assertThat(draft.keys).containsNoneOf("image", "look", "sessionId", "createdAt")
    }

    @Test fun nullableResults() = runBlocking<Unit> {
        result = "null"
        assertThat(api.getSkill("gone")).isNull()
        assertThat(api.transcriptImage("s1", "1:0:0")).isNull()
        result = """{"data":"aGk=","mimeType":"image/jpeg"}"""
        assertThat(api.transcriptImage("s1", "1:0:0")!!.mimeType).isEqualTo("image/jpeg")
        result = """{"card-1":{"tab":"b"}}"""
        val states: Map<String, JsonElement> = api.uiStates("s1")
        assertThat(states.keys).containsExactly("card-1")
    }
}
