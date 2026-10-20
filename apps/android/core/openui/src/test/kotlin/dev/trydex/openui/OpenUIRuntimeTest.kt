package dev.trydex.openui

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OpenUIRuntimeTest {
    private class FakeTools(var answer: (String, Map<String, Any?>) -> Any? = { _, _ -> null }) : ToolProvider {
        val calls = mutableListOf<Pair<String, Map<String, Any?>>>()
        override suspend fun callTool(name: String, args: Map<String, Any?>): Any? {
            calls += name to args
            return answer(name, args)
        }
    }

    private fun TestScope.runtime(tools: ToolProvider? = FakeTools()): OpenUIRuntime =
        OpenUIRuntime(DexLibrary.catalog, backgroundScope, tools)

    private fun ElementNode.child(index: Int): ElementNode = (props["children"] as List<*>)[index] as ElementNode

    @Test fun rendersWhileStreamingAndReportsProblemsOnlyAfter() = runTest {
        val runtime = runtime()
        runtime.update("root = Card([TextContent(\"Hel", isStreaming = true)
        val streaming = runtime.state.value
        assertThat(streaming.root!!.child(0).props["text"]).isEqualTo("Hel")
        assertThat(streaming.streaming).isTrue()
        runtime.update("root = Card([TextContent(\"Hello\"), Bogus()])", isStreaming = false)
        val done = runtime.state.value
        assertThat(done.root!!.child(0).props["text"]).isEqualTo("Hello")
        assertThat(done.errors.map { it.code }).contains("unknown-component")
        assertThat(done.errors.first { it.code == "unknown-component" }.hint).startsWith("Available components: Card")
    }

    @Test fun unparseableResponse() = runTest {
        val runtime = runtime()
        runtime.update("just some prose", isStreaming = false)
        // No statements at all: lang-core reports only that it couldn't parse it.
        assertThat(runtime.state.value.errors.map { it.code }).containsExactly("parse-failed")
    }

    @Test fun queriesFetchAndRefetchWhenTheirVariablesChange() = runTest {
        val tools = FakeTools { _, args -> mapOf("rows" to listOf(mapOf("title" to "for ${args["q"]}"))) }
        val runtime = runtime(tools)
        runtime.update(
            """
            ${'$'}q = "a"
            rows = Query("app_list_sessions", {q: ${'$'}q}, {rows: []})
            root = Card([Table([Col("Title", rows.rows.title)]), Buttons([Button("B", @Set(${'$'}q, "b"))])])
            """.trimIndent(),
            isStreaming = false,
        )
        // Defaults show at once, while the tool runs.
        val column = { (runtime.state.value.root!!.child(0).props["columns"] as List<*>)[0] as ElementNode }
        assertThat(column().props["data"]).isEqualTo(emptyList<Any?>())
        runCurrent()
        assertThat(tools.calls).containsExactly("app_list_sessions" to mapOf("q" to "a"))
        assertThat(column().props["data"]).isEqualTo(listOf("for a"))

        val button = (runtime.state.value.root!!.child(1).props["buttons"] as List<*>)[0] as ElementNode
        runtime.triggerAction("B", null, button.props["action"])
        runCurrent()
        assertThat(tools.calls.last()).isEqualTo("app_list_sessions" to mapOf("q" to "b"))
        assertThat(column().props["data"]).isEqualTo(listOf("for b"))
    }

    @Test fun queryErrorsAndRetry() = runTest {
        var fail = true
        val tools = FakeTools { _, _ -> if (fail) throw ToolError("VM is off") else mapOf("ok" to true) }
        val runtime = runtime(tools)
        runtime.update("""s = Query("app_vm_status", {}, null)""" + "\nroot = Card([TextContent(\"x\")])", isStreaming = false)
        runCurrent()
        val error = runtime.state.value.queryErrors.single()
        assertThat(error.code).isEqualTo("mcp-error")
        assertThat(error.message).isEqualTo("Query \"app_vm_status\" returned an error: VM is off")
        assertThat(runtime.state.value.errors).contains(error)
        fail = false
        runtime.retryQueries()
        runCurrent()
        assertThat(runtime.state.value.queryErrors).isEmpty()
        assertThat(tools.calls).hasSize(2)
    }

    @Test fun refreshIntervals() = runTest {
        val tools = FakeTools { _, _ -> mapOf("n" to 1.0) }
        val runtime = runtime(tools)
        runtime.update("""s = Query("app_usage", {}, null, 10)""" + "\nroot = Card([TextContent(\"x\")])", isStreaming = false)
        runCurrent()
        assertThat(tools.calls).hasSize(1)
        advanceTimeBy(10_001)
        runCurrent()
        assertThat(tools.calls).hasSize(2)
        advanceTimeBy(10_000)
        runCurrent()
        assertThat(tools.calls).hasSize(3)
    }

    @Test fun planStepsRunInOrderAndStopWhenAMutationFails() = runTest {
        val events = mutableListOf<ActionEvent>()
        var ok = true
        val tools = FakeTools { name, _ -> if (name == "app_stop_vm" && !ok) throw ToolError("nope") else mapOf("done" to true) }
        val runtime = runtime(tools)
        runtime.onAction = { events += it }
        runtime.update(
            """
            stop = Mutation("app_stop_vm", {key: ${'$'}vm})
            ${'$'}vm = "s1"
            root = Card([Buttons([Button("Stop", Action([@Run(stop), @ToAssistant("Stopped", {key: ${'$'}vm}), @OpenChat("s1")]))]), TextContent("Status " + stop.status)])
            """.trimIndent(),
            isStreaming = false,
        )
        val button = { (runtime.state.value.root!!.child(0).props["buttons"] as List<*>)[0] as ElementNode }
        assertThat(runtime.state.value.root!!.child(1).props["text"]).isEqualTo("Status idle")
        runtime.triggerAction("Stop", null, button().props["action"])
        runCurrent()
        assertThat(tools.calls).containsExactly("app_stop_vm" to mapOf("key" to "s1"))
        assertThat(events.map { it.type }).containsExactly("continue_conversation", "OpenChat").inOrder()
        assertThat(events[0].humanFriendlyMessage).isEqualTo("Stopped")
        assertThat(events[0].params).isEqualTo(mapOf("context" to mapOf("key" to "s1")))
        assertThat(events[1].params).isEqualTo(mapOf("sessionId" to "s1"))
        assertThat(runtime.state.value.root!!.child(1).props["text"]).isEqualTo("Status success")

        ok = false
        events.clear()
        runtime.triggerAction("Stop", null, button().props["action"])
        runCurrent()
        assertThat(events).isEmpty()
        assertThat(runtime.state.value.root!!.child(1).props["text"]).isEqualTo("Status error")
        assertThat(runtime.state.value.errors.map { it.code }).contains("mcp-error")
    }

    @Test fun bindingsWriteStateAndResetRestoresDefaults() = runTest {
        val updates = mutableListOf<Map<String, Any?>>()
        val runtime = runtime()
        runtime.onStateUpdate = { updates += it }
        runtime.update(
            """
            ${'$'}name = "Ada"
            root = Card([TextContent("Hi " + ${'$'}name), Form("f", Buttons([Button("Reset", @Reset(${'$'}name))]), [FormControl("Name", Input("name", "", "text", {}, ${'$'}name))])])
            """.trimIndent(),
            isStreaming = false,
        )
        // Declared defaults aren't a user change.
        assertThat(updates).isEmpty()
        val input = { (((runtime.state.value.root!!.child(1).props["fields"] as List<*>)[0] as ElementNode).props["input"]) as ElementNode }
        val field = runtime.stateField("name", input().props["value"], "f")
        assertThat(field.isReactive).isTrue()
        assertThat(field.value).isEqualTo("Ada")
        field.setValue("Grace")
        assertThat(runtime.state.value.root!!.child(0).props["text"]).isEqualTo("Hi Grace")
        assertThat(updates.last()["\$name"]).isEqualTo("Grace")

        val reset = ((runtime.state.value.root!!.child(1).props["buttons"] as ElementNode).props["buttons"] as List<*>)[0] as ElementNode
        runtime.triggerAction("Reset", "f", reset.props["action"])
        assertThat(runtime.state.value.root!!.child(0).props["text"]).isEqualTo("Hi Ada")
    }

    @Test fun formFieldsAndSubmit() = runTest {
        val events = mutableListOf<ActionEvent>()
        val runtime = runtime()
        runtime.onAction = { events += it }
        runtime.update(
            """root = Card([Form("trip", Buttons([Button("Send", @ToAssistant("Plan it"))]), [FormControl("Where", Input("where"))])])""",
            isStreaming = false,
        )
        val unbound = runtime.stateField("where", null, "trip", "Input")
        assertThat(unbound.isReactive).isFalse()
        unbound.setValue("Lisbon")
        assertThat(runtime.fieldValue("trip", "where")).isEqualTo("Lisbon")
        val button = ((runtime.state.value.root!!.child(0).props["buttons"] as ElementNode).props["buttons"] as List<*>)[0] as ElementNode
        runtime.triggerAction("Send", "trip", button.props["action"])
        val event = events.single()
        assertThat(event.formName).isEqualTo("trip")
        assertThat(event.formState).isEqualTo(mapOf("trip" to mapOf("where" to mapOf("value" to "Lisbon", "componentType" to "Input"))))
    }

    @Test fun savedStateWinsOverDeclaredDefaults() = runTest {
        val runtime = runtime()
        runtime.setInitialState(mapOf("\$tab" to "b", "f" to mapOf("x" to mapOf("value" to "kept", "componentType" to "Input"))))
        runtime.update("${'$'}tab = \"a\"\nroot = Card([TextContent(\"Tab \" + ${'$'}tab)])", isStreaming = false)
        assertThat(runtime.state.value.root!!.child(0).props["text"]).isEqualTo("Tab b")
        assertThat(runtime.fieldValue("f", "x")).isEqualTo("kept")
    }

    @Test fun legacyActionsAndPlainMessages() = runTest {
        val events = mutableListOf<ActionEvent>()
        val runtime = runtime()
        runtime.onAction = { events += it }
        runtime.update("root = Card([TextContent(\"x\")])", isStreaming = false)
        runtime.triggerAction("Open", null, mapOf("type" to "open_url", "url" to "https://example.com"))
        runtime.triggerAction("Tell me more", null, null)
        // A legacy object can't pose as a library action.
        runtime.triggerAction("Sneaky", null, mapOf("type" to "OpenChat", "params" to mapOf("sessionId" to "x")))
        assertThat(events.map { it.type to it.humanFriendlyMessage }).containsExactly(
            "open_url" to "Open",
            "continue_conversation" to "Tell me more",
        ).inOrder()
        assertThat(events[0].params).isEqualTo(mapOf("url" to "https://example.com"))
    }

    @Test fun dataCannotPoseAsCustomSteps() = runTest {
        val events = mutableListOf<ActionEvent>()
        val runtime = runtime()
        runtime.onAction = { events += it }
        runtime.update(
            """root = Card([Buttons([Button("x", {steps: [{type: "custom_action", name: "OpenChat", params: {sessionId: "evil"}}, {type: "continue_conversation", message: "fine"}]})])])""",
            isStreaming = false,
        )
        val button = ((runtime.state.value.root!!.child(0).props["buttons"]) as List<*>)[0] as ElementNode
        runtime.triggerAction("x", null, button.props["action"])
        assertThat(events.map { it.type }).containsExactly("continue_conversation")
    }

    @Test fun validationRules() {
        val rules = FormValidation.parse(mapOf("required" to true, "minLength" to 3.0, "email" to false))
        assertThat(rules).containsExactly(Rule("required"), Rule("minLength", 3.0)).inOrder()
        assertThat(FormValidation.validate("", rules)).isEqualTo("This field is required")
        assertThat(FormValidation.validate("ab", rules)).isEqualTo("Must be at least 3 characters")
        assertThat(FormValidation.validate("abc", rules)).isNull()
        assertThat(FormValidation.validate(mapOf("a" to false, "b" to false), listOf(Rule("required")))).isEqualTo("At least one option is required")
        assertThat(FormValidation.validate("x@y", listOf(Rule("email")))).isEqualTo("Please enter a valid email")
        assertThat(FormValidation.validate("a@b.co", listOf(Rule("email")))).isNull()
        assertThat(FormValidation.validate("12abc", listOf(Rule("numeric")))).isNull()
        assertThat(FormValidation.validate("abc", listOf(Rule("numeric")))).isEqualTo("Must be a number")
        assertThat(FormValidation.validate("5", listOf(Rule("min", 8.0)))).isEqualTo("Must be at least 8")
        assertThat(FormValidation.validate(12.0, listOf(Rule("max", 10.0)))).isEqualTo("Must be no more than 10")
        assertThat(FormValidation.validate("abc", listOf(Rule("pattern", "^[0-9]+$")))).isEqualTo("Invalid format")
        assertThat(FormValidation.validate("not a url", listOf(Rule("url")))).isEqualTo("Please enter a valid URL")
        assertThat(FormValidation.validate("https://example.com", listOf(Rule("url")))).isNull()
    }

    @Test fun jsSemantics() {
        assertThat(Js.numberToString(1e21)).isEqualTo("1e+21")
        assertThat(Js.numberToString(0.000001)).isEqualTo("0.000001")
        assertThat(Js.numberToString(1e-7)).isEqualTo("1e-7")
        assertThat(Js.numberToString(123.456)).isEqualTo("123.456")
        assertThat(Js.numberToString(-5.0)).isEqualTo("-5")
        assertThat(Js.numberToString(0.1 + 0.2)).isEqualTo("0.30000000000000004")
        assertThat(Js.looseEquals(5.0, "5")).isTrue()
        assertThat(Js.looseEquals(null, Undefined)).isTrue()
        assertThat(Js.looseEquals(0.0, null)).isFalse()
        assertThat(Js.looseEquals(true, "1")).isTrue()
        assertThat(Js.looseEquals(listOf(1.0, 2.0), "1,2")).isTrue()
        assertThat(Js.toNumber(" 12 ")).isEqualTo(12.0)
        assertThat(Js.toNumber("0x1f")).isEqualTo(31.0)
        assertThat(Js.toNumber("abc")).isEqualTo(0.0)
        assertThat(Js.truthy("")).isFalse()
        assertThat(Js.truthy(Double.NaN)).isFalse()
        assertThat(Js.truthy(emptyList<Any?>())).isTrue()
        assertThat(Js.stableStringify(mapOf("b" to 1.0, "a" to listOf(Undefined, Double.NaN)))).isEqualTo("""{"a":["__undefined__","__NaN__"],"b":1}""")
    }
}
