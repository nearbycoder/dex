import Foundation
import Testing
@testable import DexCore

/// The OpenUI engine (JavaScriptCore) and the card logic ported from the web's openui-block.tsx.
@MainActor
@Suite(.serialized) struct OpenUIEngineTests {
    let runtime = OpenUIRuntime.shared

    func document(_ code: String, state: JSONValue? = nil) async -> OpenUIDocument {
        let document = OpenUIDocument(runtime: runtime)
        if let state { document.restore(state) }
        document.setCode(code, streaming: false)
        await document.settle()
        return document
    }

    static func spec() throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "openui-spec", withExtension: "json"))
        return try JSONValue.parse(String(contentsOf: url, encoding: .utf8))
    }

    @Test func loads() {
        #expect(runtime.isLoaded)
        let size = (Bundle.module.url(forResource: "openui-engine", withExtension: "js") ?? Bundle.main.bundleURL).path
        #expect(!size.isEmpty)
    }

    @Test func rendersTheChartSample() async throws {
        let document = await document(MockData.chartProgram)
        let tree = try #require(document.tree)
        #expect(tree.type == "Card")
        #expect(tree.nodes("children").map(\.type) == ["CardHeader", "BarChart", "Table", "Buttons"])
        #expect(document.errors.isEmpty)
        let chart = tree.nodes("children")[1]
        #expect(chart.props["labels"]?.array?.count == 7)
        #expect(chart.nodes("series").first?.string("category") == "Visits")
        #expect(chart.nodes("series").first?.props["values"]?.array?.compactMap(\.number) == [120, 180, 150, 210, 260, 190, 230])
        let table = tree.nodes("children")[2]
        #expect(table.nodes("columns").map { $0.string("label") } == ["Metric", "Value"])
        let button = try #require(tree.nodes("children")[3].nodes("buttons").first)
        #expect(button.string("label") == "Explain the peak")
        #expect(button.action != nil)
    }

    @Test func rendersEveryExample() async throws {
        let spec = OpenUIRuntime.spec
        let examples = (spec["promptOptions"]?["examples"]?.array ?? []).compactMap(\.string)
        #expect(examples.count >= 5)
        for example in examples {
            // Each example is a title line, a blank line, then the program.
            let code = example.components(separatedBy: "\n\n").dropFirst().joined(separator: "\n\n")
            let document = await document(code)
            #expect(document.tree?.type == "Card", "\(example.prefix(40))")
            #expect(document.errors.filter { $0.severity != "warning" }.isEmpty, "\(example.prefix(40)): \(document.errors.map(\.message))")
        }
    }

    @Test func everyComponentDecodes() async throws {
        let spec = OpenUIRuntime.spec
        let names = Set(try #require(spec["components"]?.object).keys)
        #expect(names.count >= 80)
        let gallery = await document(MockOpenUI.galleryProgram)
        #expect(gallery.errors.isEmpty, "\(gallery.errors.map(\.message))")
        var found = Set(gallery.tree?.descendants.map(\.type) ?? [])
        // Label fits nowhere in the gallery's structure, and Slice only in the legacy pie format, which the parser
        // now rejects (it still reports it rather than failing).
        let extra = await document("root = Card([lbl, pie])\nlbl = Label(\"Hello\")\npie = PieChart([Slice(\"a\", 1)], [])")
        found.formUnion(extra.tree?.descendants.map(\.type) ?? [])
        #expect(extra.errors.contains { $0.code == "type-mismatch" && $0.message.contains("Slice") })
        #expect(names.subtracting(found) == ["Slice"])
    }

    @Test func streamsPartialCode() async throws {
        let document = OpenUIDocument(runtime: runtime)
        let code = MockData.chartProgram
        var trees: [Int] = []
        for end in stride(from: 20, through: code.count, by: 25) {
            document.setCode(String(code.prefix(end)), streaming: true)
            #expect(document.errors.isEmpty, "no errors while streaming")
            trees.append(document.tree?.descendants.count ?? 0)
        }
        #expect(trees.last ?? 0 > 0)
        #expect(trees == trees.sorted(), "the tree only grows as code arrives")
        document.setCode(code, streaming: false)
        await document.settle()
        #expect(document.tree?.nodes("children").count == 4)
        #expect(!document.streaming)
    }

    @Test func reportsProgramErrors() async throws {
        let unknown = await document("root = Card([x])\nx = Sparkle(\"hi\")")
        #expect(unknown.errors.contains { $0.code == "unknown-component" && $0.source == "parser" })
        let garbage = await document("this is not a program")
        #expect(garbage.errors.contains { $0.code == "parse-failed" })
        let problems = OpenUICard.programProblems(unknown.errors)
        #expect(problems.first?.hasPrefix("x:") == true)
        #expect(OpenUICard.fixMessage(["a: b"]) == "[UI errors] The UI you rendered has problems. Render it again, fixed:\n- a: b")
    }

    @Test func bindsStateAndRunsSetActions() async throws {
        let code = """
        root = Card([pick, label, reset, bump])
        $n = 1
        $choice = "a"
        pick = Select("choice", [SelectItem("a", "A"), SelectItem("b", "B")], null, null, $choice)
        label = TextContent("Picked " + $choice + " " + $n)
        reset = Button("Reset", @Reset($choice), "secondary")
        bump = Button("Bump", @Set($n, $n + 1), "secondary")
        """
        let document = await document(code)
        var states: [JSONValue] = []
        document.onStateChange = { states.append($0) }
        let children = { document.tree?.nodes("children") ?? [] }
        #expect(children()[1].string("text") == "Picked a 1")
        #expect(children()[0].value == "a")
        document.setField(children()[0].key, "b")
        await document.settle()
        #expect(children()[1].string("text") == "Picked b 1")
        document.press(try #require(children()[3].action))
        await document.settle()
        #expect(children()[1].string("text") == "Picked b 2")
        document.press(try #require(children()[2].action))
        await document.settle()
        #expect(children()[1].string("text") == "Picked a 2")
        #expect(states.last?["$choice"] == "a")
        #expect(states.last?["$n"] == 2)
    }

    @Test func restoresSavedState() async throws {
        let code = "root = Card([pick])\n$choice = \"a\"\npick = Select(\"choice\", [SelectItem(\"a\", \"A\"), SelectItem(\"b\", \"B\")], null, null, $choice)"
        let document = await document(code, state: ["$choice": "b"])
        #expect(document.tree?.nodes("children").first?.value == "b")
    }

    @Test func validatesFormsAndSendsTheirValues() async throws {
        let document = await document(MockOpenUI.formProgram)
        var events: [OpenUIActionEvent] = []
        document.onAction = { events.append($0) }
        let form = { try #require(document.tree?.nodes("children")[1]) }
        let fields = { try form().nodes("fields") }
        let connect = try #require(try form().node("buttons")?.nodes("buttons").first?.action)
        #expect(document.passwordFields == ["password"])
        document.press(connect)
        await document.settle()
        #expect(events.isEmpty, "an invalid form isn't sent")
        #expect(try fields()[0].error == "This field is required")
        #expect(try fields()[0].required)
        document.setField(try fields()[0].nodes("input").first!.key, "db.local")
        document.setField(try fields()[1].nodes("input").first!.key, "admin")
        document.setField(try fields()[2].nodes("input").first!.key, "short")
        document.setField(try fields()[3].nodes("input").first!.key, "require")
        await document.settle()
        #expect(try fields()[0].error == nil)
        document.press(connect)
        await document.settle()
        #expect(events.isEmpty)
        #expect(try fields()[2].error == "Must be at least 8 characters")
        document.setField(try fields()[2].nodes("input").first!.key, "hunter2hunter2")
        document.press(connect)
        await document.settle()
        let event = try #require(events.first)
        #expect(event.type == OpenUIActionEvent.continueConversation)
        #expect(event.humanFriendlyMessage == "Connect the database")
        #expect(event.formName == "db")
        #expect(event.formState?["db"]?["password"]?["value"] == "hunter2hunter2")
        // The secondary button skips validation.
        events = []
        document.press(try #require(try form().node("buttons")?.nodes("buttons").last?.action))
        await document.settle()
        #expect(events.first?.humanFriendlyMessage == "Skip connecting")
    }

    @Test func togglesChipsAndHydratesDefaults() async throws {
        let code = "root = Card([f])\nf = Form(\"trip\", Buttons([Button(\"Go\")]), [FormControl(\"Stay\", Chips(\"stay\", \"multiple\", [ChipItem(\"hotel\", \"Hotel\"), ChipItem(\"camp\", \"Camp\")], {}, [\"hotel\"]))])"
        let document = await document(code)
        let chips = { document.tree?.nodes("children").first?.nodes("fields").first?.node("input") }
        #expect(chips()?.field?["selection"] == ["hotel"])
        document.toggle(try #require(chips()?.key), "camp")
        await document.settle()
        #expect(chips()?.field?["selection"] == ["hotel", "camp"])
        #expect(document.state["trip"]?["stay"]?["value"] == ["hotel", "camp"])
    }

    @Test func runsQueriesThroughTheHost() async throws {
        let document = OpenUIDocument(runtime: runtime)
        var calls: [OpenUIToolCall] = []
        document.onTool = { call in
            calls.append(call)
            switch call.name {
            case "app_list_schedules": return .success([["id": "a", "prompt": "One", "repeat": "daily", "nextRunAt": .number(.nowMs)], ["id": "b", "prompt": "Two", "repeat": "hourly", "nextRunAt": .number(.nowMs)]])
            case "app_usage_report": return .failure(OpenUIToolError("Usage isn't tracked here."))
            default: return .success(.null)
            }
        }
        document.setCode(MockOpenUI.liveProgram, streaming: false)
        await document.settle()
        let found = calls.first { $0.name == "app_list_schedules" }
        let list = try #require(found)
        #expect(list.query)
        #expect(list.args["repeat"] == "all")
        let table = try #require(document.tree?.nodes("children")[2])
        #expect(table.nodes("columns").first?.props["data"]?.array?.compactMap(\.string) == ["One", "Two"], "rows are wrapped for `q.rows`")
        #expect(table.nodes("columns")[2].props["data"]?.array?.first?.string == "just now", "@Ago formats with Dex's formatter")
        #expect(document.errors.contains { $0.source == "query" && $0.message.contains("Usage isn't tracked here.") })
        #expect(OpenUICard.toolMessage(document.errors.first { $0.source == "query" }!.message) == "app_usage_report: Usage isn't tracked here.")

        // Changing the filter fetches again with the new value.
        document.setField(try #require(document.tree?.nodes("children")[1].node("input")).key, "daily")
        await document.settle()
        #expect(calls.last { $0.name == "app_list_schedules" }?.args["repeat"] == "daily")

        // The Mutation is only ever called from a button, so it isn't a query.
        let cancel = try #require(document.tree?.nodes("children")[3].nodes("buttons").first?.action)
        document.press(cancel)
        await document.settle()
        let fired = calls.first { $0.name == "app_cancel_schedule" }
        let mutation = try #require(fired)
        #expect(!mutation.query)
        #expect(mutation.args["id"] == "a")
    }

    @Test func dexFunctionsAndActions() async throws {
        let code = """
        root = Card([t, b1, b2, b3])
        t = TextContent(@Bytes(35000) + " · " + @DateTime(0))
        b1 = Button("Open", @OpenChat("s-1"))
        b2 = Button("Copy", @Copy("hello"))
        b3 = Button("Docs", @OpenUrl("https://example.com"))
        """
        let document = await document(code)
        var events: [OpenUIActionEvent] = []
        document.onAction = { events.append($0) }
        let children = try #require(document.tree?.nodes("children"))
        #expect(children[0].string("text")?.hasPrefix("34.2 KB · ") == true)
        for button in children.dropFirst() { document.press(try #require(button.action)) }
        await document.settle()
        #expect(events.map(\.type) == ["OpenChat", "Copy", OpenUIActionEvent.openURL])
        #expect(events[0].params["sessionId"] == "s-1")
        #expect(events[1].params["text"] == "hello")
        #expect(events[2].params["url"] == "https://example.com")
    }

    @Test func cardBlocksAttachTheItem() async throws {
        let code = """
        root = Card([b])
        b = ContextCardBlock([ContextCardItem("a", "Art", "Museums.", "gray"), ContextCardItem("f", "Food", "Bakeries.")], "grid", true, @ToAssistant("Tell me more"))
        """
        let document = await document(code)
        var events: [OpenUIActionEvent] = []
        document.onAction = { events.append($0) }
        let item = try #require(document.tree?.nodes("children").first?.nodes("items").last)
        document.press(try #require(item.action))
        await document.settle()
        #expect(events.first?.humanFriendlyMessage == "Tell me more")
        let context = try #require(events.first?.params["context"]?.string)
        #expect(context.hasPrefix("Selected item: "))
        #expect(context.contains("\"itemTitle\":\"Food\""))
    }
}

/// The card's host behaviour: tool calls (visibility, confirmation), messages, secrets, saved state.
@MainActor
@Suite(.serialized) struct OpenUICardTests {
    final class Recorder {
        var runs: [(name: String, args: JSONValue, query: Bool, confirmed: Bool)] = []
        var sent: [String] = []
        var secrets: [(String, String)] = []
        var saved: [JSONValue] = []
        var opened: [OpenUIDestination] = []
        var copied: [String] = []
    }

    func host(_ recorder: Recorder, run: @escaping (String, JSONValue, Bool, Bool) -> UiOperationResult) -> OpenUICardHost {
        OpenUICardHost(
            run: { name, args, query, confirmed in
                recorder.runs.append((name, args, query, confirmed))
                return run(name, args, query, confirmed)
            },
            send: { recorder.sent.append($0) },
            storeSecret: { field, value in
                recorder.secrets.append((field, value))
                return "\(field)-1"
            },
            saveState: { recorder.saved.append($0) },
            open: { recorder.opened.append($0) },
            copy: { recorder.copied.append($0); return true }
        )
    }

    @Test func queriesWaitUntilVisible() async throws {
        let recorder = Recorder()
        let card = OpenUICard(id: "c1", savedState: nil, host: host(recorder) { _, _, _, _ in .ok(result: .array([]), changed: nil) })
        card.update(code: MockOpenUI.liveProgram, streaming: false)
        await card.document.settle(timeout: .milliseconds(200))
        #expect(recorder.runs.isEmpty)
        card.visible = true
        await card.document.settle()
        #expect(recorder.runs.contains { $0.name == "app_list_schedules" && $0.query })
    }

    @Test func confirmsAdminOperations() async throws {
        let recorder = Recorder()
        var schedules: JSONValue = [["id": "a", "prompt": "One", "repeat": "daily", "nextRunAt": 0]]
        let card = OpenUICard(id: "c2", savedState: nil, host: host(recorder) { name, _, _, confirmed in
            switch name {
            case "app_list_schedules": return .ok(result: schedules, changed: nil)
            case "app_cancel_schedule":
                guard confirmed else { return .confirm("Cancel the scheduled prompt “One”") }
                schedules = []
                return .ok(result: .null, changed: "Cancelled")
            default: return .failed("Usage isn't tracked here.")
            }
        })
        card.visible = true
        card.update(code: MockOpenUI.liveProgram, streaming: false)
        await card.document.settle()
        #expect(card.toolErrors == ["app_usage_report: Usage isn't tracked here."])
        let cancel = try #require(card.document.tree?.nodes("children")[3].nodes("buttons").first?.action)

        // Cancelled: nothing runs, and the cancellation isn't listed as a failure.
        card.document.press(cancel)
        await card.document.settle(timeout: .milliseconds(300))
        #expect(card.confirmation?.summary == "Cancel the scheduled prompt “One”")
        card.confirm(false)
        await card.document.settle()
        #expect(card.confirmation == nil)
        #expect(!recorder.runs.contains { $0.confirmed })
        #expect(card.toolErrors == ["app_usage_report: Usage isn't tracked here."])

        // Confirmed: runs again with `confirmed`, then the list refreshes.
        card.document.press(cancel)
        await card.document.settle(timeout: .milliseconds(300))
        #expect(card.confirmation != nil)
        card.confirm(true)
        await card.document.settle()
        #expect(recorder.runs.contains { $0.name == "app_cancel_schedule" && $0.confirmed && !$0.query })
        let rows = card.document.tree?.nodes("children")[2].nodes("columns").first?.props["data"]?.array ?? [.null]
        #expect(rows.isEmpty)
    }

    @Test func sendsMessagesWithSecretsKeptOut() async throws {
        let recorder = Recorder()
        let card = OpenUICard(id: "c3", savedState: nil, host: host(recorder) { _, _, _, _ in .ok(result: .null, changed: nil) })
        card.saveDelay = .milliseconds(10)
        card.update(code: MockOpenUI.formProgram, streaming: false)
        await card.document.settle()
        let form = try #require(card.document.tree?.nodes("children")[1])
        let inputs = form.nodes("fields").compactMap { $0.node("input") }
        for (input, value) in zip(inputs, ["db.local", "admin", "hunter2hunter2", "require"]) { card.document.setField(input.key, .string(value)) }
        card.document.press(try #require(form.node("buttons")?.nodes("buttons").first?.action))
        await card.document.settle()
        try await Task.sleep(for: .milliseconds(50))
        let message = try #require(recorder.sent.first)
        #expect(message.hasPrefix("[UI action] Connect the database\nForm values: "))
        #expect(message.contains("{{secret:password-1}}"))
        #expect(!message.contains("hunter2"))
        #expect(recorder.secrets.first?.0 == "password")
        #expect(recorder.secrets.first?.1 == "hunter2hunter2")
        // The saved state never has the password.
        let saved = try #require(recorder.saved.last)
        #expect(saved["db"]?["host"]?["value"] == "db.local")
        #expect(saved["db"]?["password"] == nil)
    }

    @Test func routesDexActions() async throws {
        let recorder = Recorder()
        let card = OpenUICard(id: "c4", savedState: nil, host: host(recorder) { _, _, _, _ in .ok(result: .null, changed: nil) })
        card.update(code: """
        root = Card([b])
        b = Buttons([Button("Chat", @OpenChat("s-1")), Button("File", @OpenFile("/workspace/a.txt")), Button("VM", @OpenMachine("s-2")), Button("Copy", @Copy("x")), Button("Web", @OpenUrl("https://example.com")), Button("Bad", @OpenUrl("javascript:alert(1)"))])
        """, streaming: false)
        await card.document.settle()
        for button in card.document.tree?.nodes("children").first?.nodes("buttons") ?? [] { card.document.press(button.action!) }
        await card.document.settle()
        #expect(recorder.opened == [.chat("s-1"), .file("/workspace/a.txt"), .machine("s-2"), .url(URL(string: "https://example.com")!)])
        #expect(recorder.copied == ["x"])
        #expect(card.notice == "Copied")
    }

    @Test func helpers() async throws {
        #expect(OpenUICard.safeHttpUrl("https://example.com/a") != nil)
        #expect(OpenUICard.safeHttpUrl("javascript:alert(1)") == nil)
        #expect(OpenUICard.safeHttpUrl("data:text/html,hi") == nil)
        #expect(OpenUICard.withoutPasswords(["f": ["pw": ["value": "x"], "u": "y"]], fields: ["pw"]) == ["f": ["u": "y"]])
        let replaced = try await OpenUICard.withoutSecrets(["f": ["pw": ["value": "x", "componentType": "Input"]], "pw": "bare"], fields: ["pw"]) { field, _ in field }
        #expect(replaced["f"]?["pw"]?["value"] == "{{secret:pw}}")
        #expect(replaced["pw"] == "{{secret:pw}}")
        let event = OpenUIActionEvent(type: "continue_conversation", params: ["context": "c"], humanFriendlyMessage: "Hi")
        #expect(OpenUICard.modelMessage(event, formState: ["a": 1]) == "[UI action] Hi\nForm values: {\"a\":1}\nContext: \"c\"")
        #expect(OpenUICard.modelMessage(event, formState: [:]) == "[UI action] Hi\nContext: \"c\"")
        #expect(UiOperationResult(json: ["ok": "confirm", "summary": "S"]) == .confirm("S"))
        #expect(UiOperationResult(json: ["ok": false, "error": "E"]) == .failed("E"))
        #expect(UiOperationResult(json: ["ok": true, "result": [1], "changed": "C"]) == .ok(result: [1], changed: "C"))
    }

    @Test func mockAnswersOperations() async throws {
        let agent = MockAgent()
        #expect(agent.state.sessions.contains { $0.id == MockOpenUI.formChatId })
        #expect(agent.entries[MockOpenUI.galleryChatId]?.count == 4)
    }
}
