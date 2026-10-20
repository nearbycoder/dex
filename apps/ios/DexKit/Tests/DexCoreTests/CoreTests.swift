import Foundation
import Testing
@testable import DexCore

@Suite struct JSONValueTests {
    @Test func roundTripsAndReads() throws {
        let value = try JSONValue.parse(#"{"a":[1,true,null,"x"],"b":{"c":2.5}}"#)
        #expect(value["a"]?[0]?.int == 1)
        #expect(value["a"]?[1]?.bool == true)
        #expect(value["a"]?[2]?.isNull == true)
        #expect(value["b"]?["c"]?.number == 2.5)
        #expect(try JSONValue.parse(value.jsonText) == value)
    }

    @Test func appendsStreamedToolArguments() {
        var args = JSONValue.object([:])
        args.append("npm ", at: [.key("command")][...])
        args.append("test", at: [.key("command")][...])
        args.append("v", at: [.key("env"), .key("NODE")][...])
        #expect(args["command"]?.string == "npm test")
        #expect(args["env"]?["NODE"]?.string == "v")
    }

    @Test func foundationBridge() {
        let value = JSONValue(foundation: ["n": NSNumber(value: 3), "b": NSNumber(value: true), "s": "x", "l": [1, 2]] as [String: Any])
        #expect(value["n"]?.number == 3)
        #expect(value["b"]?.bool == true)
        #expect(value["l"]?.array?.count == 2)
    }
}

@Suite struct ProtocolTests {
    @Test func decodesStateWithMissingFields() throws {
        // An older agent: no vms, projects, push, access, or session triage fields.
        let json = #"{"cline":{"connected":true,"source":"user","keyHint":"…ab","verifiedAt":1},"settings":{"defaultModel":"cline-pass/glm-5.3","defaultThinking":"low","instructions":""},"sessions":[{"id":"a","title":"Hi","model":"m","thinking":"low","createdAt":1,"updatedAt":2,"busy":false}]}"#
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(json.utf8))
        #expect(state.cline.connected)
        #expect(state.opencode.connected == false)
        #expect(state.vms.isEmpty)
        #expect(state.settings.vmSize == "small")
        #expect(state.settings.vmMinutes == 5)
        #expect(state.sessions[0].mcpServers.isEmpty)
        #expect(state.sessions[0].settledAt == nil)
        #expect(state.sessions[0].muted == false)
    }

    @Test func mockStateRoundTrips() throws {
        let state = MockData.state()
        let data = try JSONEncoder.dex.encode(state)
        #expect(try JSONDecoder.dex.decode(DexState.self, from: data) == state)
    }

    @Test func decodesServerMessages() throws {
        let queue = try JSONDecoder.dex.decode(ServerMessage.self, from: Data(#"{"type":"dex.queue","sessionId":"s","items":[{"id":"q","text":"next","createdAt":1}],"held":true}"#.utf8))
        #expect(queue == .queue(sessionId: "s", items: [QueuedMessage(id: "q", text: "next", createdAt: 1)], held: true))
        let output = try JSONDecoder.dex.decode(ServerMessage.self, from: Data(#"{"type":"dex.vm.output","sessionId":null,"vmKey":"k","id":4,"data":"hi"}"#.utf8))
        #expect(output == .vmOutput(vmKey: "k", id: 4, data: "hi"))
        let unknown = try JSONDecoder.dex.decode(ServerMessage.self, from: Data(#"{"type":"dex.future","x":1}"#.utf8))
        #expect(unknown == .unknown("dex.future"))
    }

    @Test func encodesClientMessages() throws {
        #expect(try JSONValue.parse(ClientMessage.subscribe(sessionId: "s").json) == ["type": "dex.subscribe", "sessionId": "s"])
        #expect(try JSONValue.parse(ClientMessage.ping(sessionId: nil).json) == ["type": "dex.ping", "sessionId": nil])
        #expect(try JSONValue.parse(ClientMessage.presence(visible: false, sessionId: "s").json) == ["type": "dex.presence", "visible": false, "sessionId": "s"])
    }

    @Test func decodesEntriesWithNumericIdsAndImageRefs() throws {
        let json = #"{"id":42,"kind":"pi.toolResult","model":[{"role":"toolResult","toolCallId":"c","toolName":"vm_screenshot","content":[{"type":"image","data":"","mimeType":"image/png","ref":"42:0:0"}],"isError":false,"timestamp":5}]}"#
        let entry = try JSONDecoder.dex.decode(EntryRecord.self, from: Data(json.utf8))
        #expect(entry.id == "42")
        guard case .toolResult(let result) = entry.model?.first else { Issue.record("not a tool result"); return }
        #expect(result.images.first?.ref == "42:0:0")
    }
}

@Suite struct TranscriptTests {
    func assistantStart(_ at: Double = 1) -> AgentEvent {
        .messageStart(.assistant(AssistantMessage(content: [], stopReason: "pending", timestamp: at)))
    }

    @Test func streamsAMessage() {
        var state = TranscriptState.empty
        state.apply(.runStart)
        state.apply(assistantStart())
        state.apply(.messageUpdate([.start(contentIndex: 0, block: .thinking("", redacted: false)), .thinkingDelta(contentIndex: 0, delta: "Hmm")]))
        state.apply(.messageUpdate([.start(contentIndex: 1, block: .text("")), .textDelta(contentIndex: 1, delta: "Hel"), .textDelta(contentIndex: 1, delta: "lo")]))
        state.apply(.messageUpdate([.start(contentIndex: 2, block: .toolCall(.init(id: "c", name: "bash"))), .toolCallDelta(contentIndex: 2, path: [.key("command")], delta: "ls")]))
        #expect(state.running)
        #expect(state.streaming?.text == "Hello")
        #expect(state.streaming?.toolCalls.first?.arguments["command"]?.string == "ls")
        guard case .assistant(_, let messages, let streaming, _) = state.displayItems.last else { Issue.record("no reply"); return }
        #expect(streaming)
        #expect(messages.count == 1)

        let entry = EntryRecord(id: "9", kind: "pi.assistant", model: [.assistant(AssistantMessage(content: [.text("Hello")], timestamp: 1, durationMs: 10))])
        state.apply(.messageEnd(entry))
        state.apply(.messageEnd(entry)) // duplicates are ignored
        #expect(state.streaming == nil)
        #expect(state.entries.count == 1)
        state.apply(.runEnd)
        #expect(!state.running)
    }

    @Test func toolOutputWindow() {
        var state = TranscriptState.empty
        state.apply(.toolStart(callId: "c", name: "vm_exec", args: ["command": "ls"], parent: nil))
        state.apply(.toolUpdate(callId: "c", name: "vm_exec", output: .window(trimStart: 0, append: "abcdef"), details: nil, parent: nil))
        state.apply(.toolUpdate(callId: "c", name: "vm_exec", output: .window(trimStart: 2, append: "gh"), details: nil, parent: nil))
        #expect(state.tools["c"]?.output == "cdefgh")
        state.apply(.toolUpdate(callId: "c", name: "vm_exec", output: .set("new"), details: ["x": 1], parent: nil))
        #expect(state.tools["c"]?.output == "new")
        #expect(state.tools["c"]?.details?["x"]?.int == 1)
        // Nested calls don't show as their own steps.
        state.apply(.toolStart(callId: "c/1", name: "inner", args: [:], parent: "c"))
        #expect(state.tools["c/1"] == nil)
        state.apply(.toolEnd(callId: "c", name: "vm_exec", entry: nil, parent: nil))
        #expect(state.tools["c"]?.status == "done")
    }

    @Test func snapshotKeepsQueueAndArtifacts() {
        var state = TranscriptState.empty
        state.apply(ServerMessage.queue(sessionId: "s", items: [QueuedMessage(id: "q", text: "t", createdAt: 1)], held: true))
        let snapshot = SnapshotEvent(entries: [EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "hi"))])], run: .init(inputs: []),
                                     generation: .init(attempt: 1, message: AssistantMessage(content: [.text("partial")]), retry: .init(at: 5, error: "rate limited")),
                                     tools: [ToolSlot(callId: "c", name: "bash", status: "running", output: "out", details: nil)])
        state.apply(ServerMessage.snapshot(sessionId: "s", snapshot: snapshot))
        #expect(state.loaded)
        #expect(state.running)
        #expect(state.queue.count == 1 && state.queueHeld)
        #expect(state.streaming?.text == "partial")
        #expect(state.retry?.error == "rate limited")
        #expect(state.tools["c"]?.output == "out")
    }

    @Test func displayItemsGroupReplies() {
        var state = TranscriptState.empty
        state.entries = MockData.transcript(for: MockData.state().sessions[0])
        let items = state.displayItems
        #expect(items.count == 2)
        guard case .user(_, let text, _) = items[0], case .assistant(_, let messages, false, let ended) = items[1] else { Issue.record("wrong items"); return }
        #expect(text.contains("Lisbon"))
        #expect(messages.count == 2)
        #expect(ended != nil)
        #expect(state.toolResults["call-1"]?.toolName == "web_search")
    }

    @Test func dividers() {
        var state = TranscriptState.empty
        state.entries = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "a"))]),
            EntryRecord(id: "2", kind: "pi.compaction", model: [.user(UserMessage(text: "summary"))]),
            EntryRecord(id: "3", kind: "pi.reset")
        ]
        #expect(state.displayItems.map(\.id) == ["1:0", "2", "3"])
    }
}

@Suite struct ModelTests {
    let glm = MockData.catalog.model("cline-pass/glm-5.3")!
    let kimi = MockData.catalog.model("cline-pass/kimi-k3")!

    @Test func thinkingLevels() {
        #expect(glm.supportedThinkingLevels == ["low", "high", "xhigh"])
        #expect(glm.clampThinking("medium") == "low" || glm.clampThinking("medium") == "high")
        #expect(glm.clampThinking("off") == "low")
        #expect(kimi.supportedThinkingLevels == ["high"])
        #expect(MockData.catalog.model("cline-pass/deepseek-v4-pro")!.supportedThinkingLevels == ThinkingLevels.all.filter { $0 != "xhigh" })
    }

    @Test func usableModel() {
        let catalog = MockData.catalog
        #expect(catalog.usableModel("cline-pass/glm-5.3", connected: ["clinepass": true]) == "cline-pass/glm-5.3")
        #expect(catalog.usableModel("cline-pass/glm-5.3", connected: ["clinepass": false, "opencode-go": true]) == "opencode-go/glm-5.3")
        #expect(catalog.usableModel("cline-pass/kimi-k3", connected: ["opencode-go": true]) == "opencode-go/glm-5.3")
        #expect(catalog.provider(of: "opencode-go/unknown") == "opencode-go")
    }

    @Test func catalogRoundTripKeepsNulls() throws {
        let decoded = try JSONDecoder.dex.decode(ModelCatalog.self, from: JSONEncoder.dex.encode(MockData.catalog))
        #expect(decoded.model("cline-pass/kimi-k3")!.supportedThinkingLevels == ["high"])
    }
}

@Suite struct AuthTests {
    @Test func pkceMatchesRFC7636() {
        // RFC 7636, appendix B.
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let random = PKCE()
        #expect(random.verifier.count >= 43)
        #expect(random.challenge.count == 43)
    }

    @Test func normalizesServers() {
        #expect(AuthClient.normalize("dex.example.com")?.absoluteString == "https://dex.example.com")
        #expect(AuthClient.normalize(" https://dex.example.com/chat?x=1 ")?.absoluteString == "https://dex.example.com")
        #expect(AuthClient.normalize("localhost:5173")?.absoluteString == "http://localhost:5173")
        #expect(AuthClient.normalize("ftp://x") == nil)
        #expect(AuthClient.normalize("") == nil)
    }

    @Test func readsCallback() throws {
        #expect(try AuthClient.code(fromCallback: URL(string: "dex://auth/callback?code=abc.def")!) == "abc.def")
        #expect(throws: AuthError.self) { try AuthClient.code(fromCallback: URL(string: "dex://other/callback?code=x")!) }
        #expect(throws: AuthError.self) { try AuthClient.code(fromCallback: URL(string: "dex://auth/callback")!) }
    }

    @Test func refreshWindow() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let soon = Credentials(server: URL(string: "https://x")!, token: "t", user: Viewer(id: "u", login: "u", name: "U"), expiresAt: (1_000_000 + 3 * 86_400) * 1000)
        #expect(soon.needsRefresh(now: now))
        #expect(!soon.isExpired(now: now))
        let later = Credentials(server: URL(string: "https://x")!, token: "t", user: Viewer(id: "u", login: "u", name: "U"), expiresAt: (1_000_000 + 20 * 86_400) * 1000)
        #expect(!later.needsRefresh(now: now))
    }
}

@Suite struct FormatTests {
    @Test func bytesAndDurations() {
        #expect(Format.bytes(512) == "512 B")
        #expect(Format.bytes(35_021) == "34.2 KB")
        #expect(Format.duration(36_000) == "36s")
        #expect(Format.duration(252_000) == "4m 12s")
        #expect(Format.tokens(1_250_000) == "1.2M")
    }

    @Test func skillInvocation() {
        #expect(Format.invokedSkill("/release-notes for v2") == "release-notes")
        #expect(Format.invokedSkill("  /frontend-design") == "frontend-design")
        #expect(Format.invokedSkill("/Upper") == nil)
        #expect(Format.invokedSkill("hi /x") == nil)
        #expect(Format.invokedSkill("/a/b") == nil)
    }
}

@Suite struct InboxTests {
    @Test func groupsChats() {
        let now = Double.nowMs
        let state = MockData.state(now: now)
        let groups = Inbox.groups(state.sessions, now: now)
        #expect(groups.inbox.map(\.id) == [MockData.welcomeId, MockData.vmChatId, MockData.chartChatId])
        #expect(groups.snoozed.map(\.id) == ["s-snoozed"])
        #expect(groups.settled.map(\.id) == ["s-settled"])
        // A snooze that ended puts the chat back in the inbox.
        #expect(Inbox.place(of: state.sessions[3], now: now + 2 * 86_400_000) == .inbox)
    }

    @Test func snoozeChoices() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        // Wednesday 2026-10-14 10:00 UTC.
        let wednesday = Date(timeIntervalSince1970: 1_791_972_000)
        let options = Inbox.snoozeOptions(now: wednesday, calendar: calendar)
        #expect(options.map(\.label) == ["In 1 hour", "This evening", "Tomorrow", "This weekend", "Next week"])
        #expect(calendar.component(.weekday, from: options[3].at) == 7) // Saturday
        #expect(calendar.component(.weekday, from: options[4].at) == 2) // Monday
        #expect(calendar.component(.hour, from: options[2].at) == 9)
        // Saturday evening: no "this evening" (too close), no weekend.
        let saturday = Date(timeIntervalSince1970: 1_792_260_000 + 7 * 3600)
        #expect(!Inbox.snoozeOptions(now: saturday, calendar: calendar).map(\.label).contains("This weekend"))
    }
}

@Suite struct ReplyLayoutTests {
    @Test func foldsWorkAndKeepsAnswerAndCards() {
        let messages = [
            AssistantMessage(content: [.thinking("plan", redacted: false), .text("Let me check."), .toolCall(.init(id: "a", name: "bash", arguments: ["command": "ls -la\nmore"]))], timestamp: 0),
            AssistantMessage(content: [.toolCall(.init(id: "ui", name: "render_ui", arguments: ["code": "root = Card([])"])), .text("Here it is.")], timestamp: 0)
        ]
        let layout = ReplyLayout(messages: messages, streaming: false)
        #expect(layout.steps.map(\.id) == ["0:0", "0:1", "0:2"])
        #expect(layout.shown.map(\.id) == ["1:0", "1:1"])
        #expect(!layout.active)
        #expect(layout.counts(results: [:], startedAt: 0, now: 0) == "1 tool · 1 thought")
        #expect(ReplyLayout.summarize(["command": "ls -la\nmore"]) == "ls -la")
        #expect(ReplyLayout.activity("github__create_pr") == "Using github")
        #expect(ReplyLayout.activity("vm_exec") == "Running on the VM")
    }

    @Test func liveStatusFollowsTheRunningTool() {
        let message = AssistantMessage(content: [.thinking("**Plan**: run the tests", redacted: false), .toolCall(.init(id: "t", name: "vm_exec", arguments: ["command": "npm test"]))], timestamp: 0)
        let layout = ReplyLayout(messages: [message], streaming: true)
        #expect(layout.active)
        let status = layout.status(results: [:], startedAt: 0, endedAt: nil, now: 5_000)
        #expect(status.title == "Running on the VM")
        #expect(status.detail == "npm test")
        let thinking = ReplyLayout(messages: [AssistantMessage(content: [.thinking("one\n**two** _x_", redacted: false)], timestamp: 0)], streaming: true)
        #expect(thinking.status(results: [:], startedAt: 0, endedAt: nil, now: 0).detail == "two x")
        let done = ReplyLayout(messages: [message, AssistantMessage(content: [.text("ok")], timestamp: 0)], streaming: false)
        #expect(done.status(results: [:], startedAt: 0, endedAt: 36_000, now: 99_000).title == "Worked for 36s")
    }

    @Test func memoryEdits() {
        let write = AssistantMessage(content: [.toolCall(.init(id: "m", name: "write_file", arguments: ["path": "/workspace/MEMORY.md"]))], timestamp: 0)
        #expect(ReplyLayout(messages: [write], streaming: false).touchedMemory)
        let read = AssistantMessage(content: [.toolCall(.init(id: "m", name: "bash", arguments: ["command": "cat MEMORY.md"]))], timestamp: 0)
        #expect(!ReplyLayout(messages: [read], streaming: false).touchedMemory)
    }
}
