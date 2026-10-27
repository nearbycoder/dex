package dev.trydex.fake

import dev.trydex.core.model.bool
import dev.trydex.core.model.get
import dev.trydex.core.model.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** Pi Durable's transcript JSON (entries, messages, events), as the agent sends it. */
object Pi {
    private val usage = buildJsonObject {
        put("input", 1200); put("output", 340); put("cacheRead", 0); put("cacheWrite", 0); put("totalTokens", 1540)
        putJsonObject("cost") { put("input", 0); put("output", 0); put("cacheRead", 0); put("cacheWrite", 0); put("total", 0) }
    }

    fun entry(id: Long, kind: String, message: JsonObject?) = buildJsonObject {
        put("id", id)
        put("conversationId", 1)
        put("kind", kind)
        if (message != null) putJsonArray("model") { add(message) }
    }

    fun userMessage(text: String, at: Long) = buildJsonObject {
        put("role", "user")
        put("content", text)
        put("timestamp", at)
    }

    /**
     * A message with attachments, written as the agent writes it (messageContent in apps/web/src/agent/attachments.ts):
     * the text, then each file in a tag naming it, its text inside, or for an image the image right after.
     */
    fun userMessage(text: String, attachments: List<JsonObject>, at: Long) = if (attachments.isEmpty()) userMessage(text, at) else buildJsonObject {
        put("role", "user")
        putJsonArray("content") {
            if (text.isNotEmpty()) add(buildJsonObject { put("type", "text"); put("text", text) })
            for (file in attachments) {
                val name = file["name"].str ?: "file"
                val type = file["mimeType"].str ?: "text/plain"
                val attributes = "name=\"${escape(name)}\" type=\"${escape(type)}\"" + if (file["converted"].bool == true) " converted=\"markdown\"" else ""
                if (file["kind"].str == "image") {
                    add(buildJsonObject { put("type", "text"); put("text", "<attachment $attributes />") })
                    add(buildJsonObject { put("type", "image"); put("data", file["data"].str ?: ""); put("mimeType", type) })
                } else {
                    add(buildJsonObject { put("type", "text"); put("text", "<attachment $attributes>\n${file["text"].str ?: ""}\n</attachment>") })
                }
            }
        }
        put("timestamp", at)
    }

    private fun escape(value: String) = value.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;")

    fun assistantMessage(content: List<JsonObject>, at: Long, durationMs: Long? = null, stopReason: String = "stop", error: String? = null) = buildJsonObject {
        put("role", "assistant")
        put("content", JsonArray(content))
        put("api", "openai-completions")
        put("provider", "clinepass")
        put("model", "glm-5.3")
        put("usage", usage)
        put("stopReason", stopReason)
        if (error != null) put("errorMessage", error)
        put("timestamp", at)
        if (durationMs != null) put("durationMs", durationMs)
    }

    fun toolResult(callId: String, tool: String, text: String, at: Long, isError: Boolean = false, details: JsonElement? = null, image: String? = null) = buildJsonObject {
        put("role", "toolResult")
        put("toolCallId", callId)
        put("toolName", tool)
        putJsonArray("content") {
            add(buildJsonObject { put("type", "text"); put("text", text) })
            if (image != null) add(buildJsonObject { put("type", "image"); put("mimeType", "image/png"); put("data", ""); put("ref", image) })
        }
        put("isError", isError)
        if (details != null) put("details", details)
        put("timestamp", at)
    }

    fun text(text: String) = buildJsonObject { put("type", "text"); put("text", text) }
    fun thinking(text: String) = buildJsonObject { put("type", "thinking"); put("thinking", text) }
    fun toolCall(id: String, name: String, args: JsonObject) = buildJsonObject {
        put("type", "toolCall"); put("id", id); put("name", name); put("arguments", args)
    }
}

/** One step of a scripted reply. */
sealed interface Step {
    data class Think(val text: String) : Step
    data class Say(val text: String) : Step
    /** A tool call: its args stream in, it runs (with live output chunks), then its result lands. */
    data class Tool(
        val name: String,
        val args: JsonObject,
        val result: String,
        val live: List<String> = emptyList(),
        val details: JsonElement? = null,
        val image: String? = null,
        val isError: Boolean = false,
        /** Streams this argument (render_ui's `code`) in pieces. */
        val streamArg: String? = null,
    ) : Step
    /** Ends the model's message here (tools run between messages). */
    data object Turn : Step
    data class Fail(val message: String) : Step
}

/** The replies FakeDex gives, picked by words in your message. */
object Scripts {
    val DASHBOARD = """
root = Card([header, kpis, chart, table, actions])
header = CardHeader("Weekly metrics", "Oct 13 – 19 · all workspaces")
kpis = SnippetCardBlock([k1, k2, k3], "grid", true)
k1 = SnippetCardItem("chats", IconText(Icon("message-square"), "neutral", "m", "Chats", "this week"), BoldText("number", "128", "+14%", "metric"))
k2 = SnippetCardItem("tokens", IconText(Icon("zap"), "neutral", "m", "Tokens", "all models"), BoldText("number", "4.2M", "+6%", "metric"))
k3 = SnippetCardItem("vm", IconText(Icon("server"), "neutral", "m", "VM hours", "boat.dev"), BoldText("number", "11.5", "-3%", "metric"))
chart = BarChart(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [Series("ClinePass", [12, 18, 15, 22, 19, 6, 4]), Series("OpenCode Go", [5, 7, 9, 6, 11, 2, 1])], "stacked", "Day", "Chats")
sessions = Query("app_list_sessions", {limit: 5}, {rows: []})
table = Table([Col("Recent chat", sessions.rows.title), Col("Updated", @Each(sessions.rows, "s", @Ago(s.updatedAt)))])
actions = Buttons([Button("Refresh", @Run(sessions), "secondary"), Button("Explain the dip on Saturday", @ToAssistant("Why did chats drop on Saturday?")), Button("Open machines", @OpenMachine("chat-tests"), "tertiary")])
""".trim()

    val FORM = """
root = Card([header, form])
header = CardHeader("Deploy settings", "Dex keeps the key out of the chat")
form = Form("deploy", buttons, [FormControl("Service name", Input("service", "api", "text", {required: true, minLength: 3})), FormControl("Region", Select("region", [SelectItem("iad", "Washington (iad)"), SelectItem("fra", "Frankfurt (fra)"), SelectItem("sin", "Singapore (sin)")], "Pick a region", {required: true})), FormControl("API key", Input("apiKey", "sk-…", "password", {required: true}), "Stored as a secret; the chat sees {{secret:apiKey}}"), FormControl("Instances", Slider("instances", "discrete", 1, 5, 1, [2])), FormControl("Notify me", SwitchGroup("notify", [SwitchItem("When it's live", "", "live", true), SwitchItem("If it fails", "", "fails", true)]))])
buttons = Buttons([Button("Deploy", @ToAssistant("Deploy it"), "primary"), Button("Cancel", @ToAssistant("Never mind"), "secondary")])
""".trim()

    fun pick(text: String, ids: () -> String): List<Step> {
        val t = text.lowercase()
        return when {
            "dashboard" in t || "chart" in t || " ui" in " $t" -> listOf(
                Step.Think("They want a visual summary. Load the UI guide, then render a dashboard with live chat data."),
                Step.Tool("load_ui_guide", JsonObject(emptyMap()), "(Dex's generative UI guide, for the model; not shown here)"),
                Step.Turn,
                Step.Tool("render_ui", buildJsonObject { put("title", "Weekly metrics"); put("code", DASHBOARD) }, "Rendered 12 statements. The user sees the UI now.", streamArg = "code"),
                Step.Turn,
                Step.Say("Here's this week at a glance. Chats were up **14%**; the table at the bottom stays live while it's on screen."),
            )
            "form" in t || "deploy" in t -> listOf(
                Step.Think("Collect the deploy settings with a form; the key goes in a password field."),
                Step.Tool("render_ui", buildJsonObject { put("title", "Deploy settings"); put("code", FORM) }, "Rendered 4 statements.", streamArg = "code"),
                Step.Turn,
                Step.Say("Fill this in and I'll deploy it."),
            )
            "test" in t || " vm" in " $t" || "machine" in t -> listOf(
                Step.Think("Run the test suite on the chat's VM and look at the failures."),
                Step.Tool(
                    "vm_exec", buildJsonObject { put("command", "cd ~/work/dex && npm test -- --reporter=dot") },
                    "> dex@2.4.0 test\n> vitest run\n\n ✓ 214 passed\n ✗ 1 failed: login.spec.ts › retries a stale session\n\nexit 1",
                    live = listOf("> dex@2.4.0 test\n", "> vitest run\n\n", "....................\n", ".........F.........\n", " ✓ 214 passed\n ✗ 1 failed: login.spec.ts › retries a stale session\n"),
                ),
                Step.Tool("vm_screenshot", JsonObject(emptyMap()), "Screenshot of the VM's screen (1280×800).", image = ids() + ":0:1"),
                Step.Turn,
                Step.Think("The stale-session test races the token refresh. Waiting for the refresh promise fixes it."),
                Step.Tool("vm_write_file", buildJsonObject { put("path", "~/work/dex/test/login.spec.ts") }, "Wrote 2.1 KB."),
                Step.Turn,
                Step.Say("One test was flaky: `login.spec.ts` raced the token refresh. I made it wait for the refresh and all **215** tests pass now.\n\n| Suite | Before | After |\n|---|---|---|\n| unit | 214 / 215 | 215 / 215 |\n| e2e | 38 / 38 | 38 / 38 |"),
            )
            "error" in t || "fail" in t -> listOf(Step.Think("Calling the model…"), Step.Fail("429 Too Many Requests: the provider is rate limiting this key. Try again in a minute."))
            "delete" in t || "confirm" in t || "settings" in t -> listOf(
                Step.Think("Changing settings is an admin operation: ask the user to confirm."),
                Step.Tool("app_call", buildJsonObject { put("operation", "app_update_settings") }, "Waiting for the user's confirmation.", details = buildJsonObject {
                    putJsonObject("confirmation") { put("id", "p-chat"); put("summary", "Change the default model to Kimi K3") }
                }),
                Step.Turn,
                Step.Say("I've asked you to confirm the change above."),
            )
            "video" in t || "media" in t -> listOf(
                Step.Tool("share_media", buildJsonObject { put("path", "~/out/demo.mp4") }, "Shared demo.mp4.", details = buildJsonObject {
                    putJsonObject("media") { put("url", "/api/media/user-octocat/0b4f2c3e-1111-2222-3333-444455556666.png"); put("name", "chart.png") }
                }),
                Step.Turn,
                Step.Say("Here's the render: ![chart](/api/media/user-octocat/0b4f2c3e-1111-2222-3333-444455556666.png)\n\nAnd the walkthrough: https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            )
            "remember" in t -> listOf(
                Step.Tool("edit_file", buildJsonObject { put("path", "/workspace/MEMORY.md") }, "Edited /workspace/MEMORY.md."),
                Step.Turn,
                Step.Say("Noted — I'll remember that."),
            )
            else -> listOf(
                Step.Think("A plain question: answer directly, with a short comparison."),
                Step.Say(
                    "Here's a quick take.\n\n**Pick Postgres + pgvector** if you already run Postgres; it keeps one database.\n\n" +
                        "| Option | Good at | Watch out for |\n|---|---|---|\n| pgvector | One database, SQL joins | Tuning HNSW at scale |\n| Qdrant | Filtering, speed | Another service to run |\n| LanceDB | Embedded, files | Young ecosystem |\n\n" +
                        "```sql\nCREATE EXTENSION vector;\nCREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);\n```\n\n- [x] Compared the three\n- [ ] Benchmark on your data",
                ),
            )
        }
    }
}
