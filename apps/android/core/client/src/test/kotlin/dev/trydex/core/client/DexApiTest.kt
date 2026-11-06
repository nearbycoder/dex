package dev.trydex.core.client

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.UiOperationResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
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

    @Test fun vmFiles() = runBlocking<Unit> {
        result = """{"running":true,"data":{"path":"/home/u/work","parent":"/home/u","entries":[{"path":"/home/u/work/dex","name":"dex","directory":true,"size":4096,"modifiedAt":1,"link":false}],"next":null}}"""
        val folder = api.vmDirectory("chat-1")!!
        assertThat(folder.entries.single().directory).isTrue()
        result = """{"running":true,"data":{"path":"/home/u/work/dex/a.ts","size":3,"modifiedAt":1,"content":"b\n","before":"a\n","change":"modified","binary":false,"truncated":false,"message":null}}"""
        assertThat(api.vmFile("chat-1", "/home/u/work/dex/a.ts")!!.before).isEqualTo("a\n")
        // A stopped VM isn't woken: there's nothing to show.
        result = """{"running":false,"status":"stopped"}"""
        assertThat(api.vmChanges("chat-1")).isNull()
        assertThat(calls.map { it.args }).containsExactly(
            """["chat-1","directory","~/work",0]""",
            """["chat-1","file","/home/u/work/dex/a.ts",0]""",
            """["chat-1","changes","~/work",0]""",
        ).inOrder()
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
        // A look always says its finish: a plain color clears the one it had, explicitly.
        val plain = DexApi.characterDraft(CharacterProfile("muse", name = "Muse", look = SidekickLook("bot", "mint"), image = "data:image/png;base64,AA"), picture = true)
        assertThat(plain["look"]!!.jsonObject["finish"]).isEqualTo(JsonNull)
        val finished = DexApi.characterDraft(CharacterProfile("muse", name = "Muse", look = SidekickLook("bot", "pink", finish = 605), image = "data:image/png;base64,AA"), picture = true)
        assertThat(finished["look"]!!.jsonObject["finish"].toString()).isEqualTo("605")
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

    @Test fun spaces() = runBlocking<Unit> {
        result = """{"id":"sp1","name":"Launch","goal":"","projectId":null,"sessionId":"chat-sp1","createdAt":1,"updatedAt":1}"""
        val space = api.saveSpace(DexApi.spaceDraft(null, "  Launch ", "", null))
        assertThat(space.sessionId).isEqualTo("chat-sp1")
        api.saveSpace(DexApi.spaceDraft("sp1", "Launch", "Ship it", "dex-web"))
        result = "\"# Notes\""
        assertThat(api.spaceNotes("sp1")).isEqualTo("# Notes")
        result = "null"
        assertThat(api.spaceNotes("sp1")).isEmpty()
        api.deleteSpace("sp1")
        assertThat(calls.map { it.method }).containsExactly("saveSpace", "saveSpace", "spaceNotes", "spaceNotes", "deleteSpace").inOrder()
        assertThat(calls[0].args).isEqualTo("""[{"name":"Launch","goal":"","projectId":null}]""")
        assertThat(calls[1].args).isEqualTo("""[{"id":"sp1","name":"Launch","goal":"Ship it","projectId":"dex-web"}]""")
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

    @Test fun commandCode() = runBlocking<Unit> {
        result = """{"ok":true,"note":"12 models on your plan are in the model menu."}"""
        val connected = api.connectCommandCode("cc_live_0123456789")
        assertThat(connected.ok).isTrue()
        assertThat(connected.note).isEqualTo("12 models on your plan are in the model menu.")
        result = """{"ok":false,"error":"Command Code didn't accept that key."}"""
        assertThat(api.connectCommandCode("nope").error).isEqualTo("Command Code didn't accept that key.")
        result = "null"
        api.disconnectCommandCode()
        assertThat(calls.map { it.method }).containsExactly("connectCommandCode", "connectCommandCode", "disconnectCommandCode").inOrder()
        assertThat(calls.map { it.args }).containsExactly("""["cc_live_0123456789"]""", """["nope"]""", "[]").inOrder()
        // Both wait for the model list to refresh, which takes longer than an ordinary call.
        assertThat(calls.map { it.timeout }.distinct()).containsExactly(60_000L)
    }

    @Test fun openRouter() = runBlocking<Unit> {
        result = """{"ok":true,"note":"Without credits on the account, OpenRouter allows a few dozen free-model requests a day."}"""
        val connected = api.connectOpenRouter("sk-or-v1-0123456789")
        assertThat(connected.ok).isTrue()
        assertThat(connected.note).isEqualTo("Without credits on the account, OpenRouter allows a few dozen free-model requests a day.")
        result = """{"ok":false,"error":"OpenRouter didn't accept that key. Create a new one in OpenRouter's settings."}"""
        assertThat(api.connectOpenRouter("nope").error).isEqualTo("OpenRouter didn't accept that key. Create a new one in OpenRouter's settings.")
        result = "null"
        api.disconnectOpenRouter()
        assertThat(calls.map { it.method }).containsExactly("connectOpenRouter", "connectOpenRouter", "disconnectOpenRouter").inOrder()
        assertThat(calls.map { it.args }).containsExactly("""["sk-or-v1-0123456789"]""", """["nope"]""", "[]").inOrder()
    }

    @Test fun usageGlance() = runBlocking<Unit> {
        result = """{"meters":[{"provider":"opencode-go","service":"OpenCode Go","window":"5 hours","percent":42,"limited":false,"resetsAt":null,"detail":null,"estimated":false}],"today":{"tokens":1200,"responses":3}}"""
        val glance = api.usageGlance()
        assertThat(glance.top!!.service).isEqualTo("OpenCode Go")
        assertThat(glance.today.tokens).isEqualTo(1200.0)
        assertThat(calls.single()).isEqualTo(Call("usageGlance", "[]", AgentConnection.DEFAULT_TIMEOUT_MS))
    }
}
