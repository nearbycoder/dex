import Foundation
import Testing
@testable import DexCore

@Suite struct SpaceModelTests {
    @Test func olderStateHasNoSpaces() throws {
        // An agent from before spaces: no `spaces`, no `spaceId` or `failed` on its sessions.
        let json = #"{"sessions":[{"id":"a","title":"Hi","model":"m","thinking":"low","createdAt":1,"updatedAt":2,"busy":false}]}"#
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(json.utf8))
        #expect(state.spaces.isEmpty)
        #expect(state.sessions[0].spaceId == nil && state.sessions[0].failed == false)
        #expect(state.chats.map(\.id) == ["a"])
    }

    /// A space with a coordinator and three threads, one of them waiting on a confirmation.
    static let json = #"""
    {"spaces":[{"id":"sp1","name":"Launch","goal":"Ship it\nby Friday","projectId":null,"sessionId":"c","createdAt":1,"updatedAt":2},{"id":"bare","sessionId":"c2"}],
     "sessions":[{"id":"plain","title":"Plain","model":"m","thinking":"low","createdAt":1,"updatedAt":2,"busy":false,"unread":true},
      {"id":"c","title":"Launch","model":"m","thinking":"low","createdAt":1,"updatedAt":9,"busy":false,"spaceId":"sp1","unread":true},
      {"id":"t1","title":"Old","model":"m","thinking":"low","createdAt":2,"updatedAt":3,"busy":false,"spaceId":"sp1","repliedAt":3,"unread":true},
      {"id":"t2","title":"Newer","model":"m","thinking":"low","createdAt":5,"updatedAt":6,"busy":true,"spaceId":"sp1"},
      {"id":"t3","title":"Newest","model":"m","thinking":"low","createdAt":7,"updatedAt":8,"busy":true,"spaceId":"sp1","failed":true}],
     "access":{"pending":[{"id":"p1","sessionId":"t3","operation":"op","summary":"Do it","createdAt":1,"status":"pending"}]}}
    """#

    @Test func decodesSpacesAndKeepsTheirChatsOutOfTheList() throws {
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(Self.json.utf8))
        let space = try #require(state.space("sp1"))
        #expect(space.name == "Launch" && space.goal == "Ship it\nby Friday" && space.projectId == nil && space.sessionId == "c")
        // Missing fields get defaults.
        let bare = try #require(state.space("bare"))
        #expect(bare.name.isEmpty && bare.goal.isEmpty && bare.createdAt == 0)
        #expect(state.coordinated(by: "c")?.id == "sp1" && state.coordinated(by: "t1") == nil)
        #expect(state.session("t3")?.failed == true)
        // Space chats live under their space.
        #expect(state.chats.map(\.id) == ["plain"])
        // The threads: newest first, never the coordinator.
        #expect(state.threads(of: space).map(\.id) == ["t3", "t2", "t1"])
        #expect(state.isThread(state.session("t1")!) && !state.isThread(state.session("c")!) && !state.isThread(state.session("plain")!))
        #expect(state.conversationsOutsideThreads.map(\.id) == ["plain", "c"])
        // Threads are muted and stay out of the badge; the coordinator counts, like any chat.
        #expect(state.unreadCount == 2)
        #expect(try JSONDecoder.dex.decode(DexState.self, from: JSONEncoder.dex.encode(state)) == state)
    }

    @Test func threadStatus() throws {
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(Self.json.utf8))
        let pending = state.access.pending
        func status(_ id: String) -> ThreadStatus { Spaces.status(of: state.session(id)!, pending: pending) }
        // Waiting on you beats working, and working beats failed.
        #expect(status("t3") == .needsYou)
        #expect(status("t2") == .working)
        #expect(status("t1") == .done)
        var session = state.session("t1")!
        session.repliedAt = nil
        #expect(Spaces.status(of: session) == .new)
        session.failed = true
        #expect(Spaces.status(of: session) == .failed)
        // An answered confirmation doesn't count.
        var answered = pending
        answered[0].status = "approved"
        #expect(Spaces.status(of: state.session("t3")!, pending: answered) == .working)
        #expect(ThreadStatus.order == [.needsYou, .working, .failed, .done, .new])
        #expect(ThreadStatus.order.map(\.label) == ["Needs you", "Working", "Failed", "Done", "Not started"])
        #expect(ThreadStatus.needsYou.rawValue == "needs_you")
    }

    @Test func groupsAndSummary() throws {
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(Self.json.utf8))
        let space = try #require(state.space("sp1"))
        let threads = state.threads(of: space)
        let groups = Spaces.grouped(threads, pending: state.access.pending)
        #expect(groups.map(\.status) == [.needsYou, .working, .done])
        #expect(groups.map { $0.threads.map(\.id) } == [["t3"], ["t2"], ["t1"]])
        #expect(Spaces.summary(space, threads: threads, pending: state.access.pending) == "1 needs you · 1 working")
        // Nothing going on: the goal's first line, then a count, then nothing yet.
        #expect(Spaces.summary(space, threads: [state.session("t1")!]) == "Ship it")
        #expect(Spaces.summary(SpaceProfile(id: "x", name: "X", sessionId: "c"), threads: [state.session("t1")!]) == "1 thread")
        #expect(Spaces.summary(SpaceProfile(id: "x", name: "X", sessionId: "c"), threads: []) == "No threads yet")
    }

    @Test func parsesUpdates() throws {
        let one = Spaces.update(thread: ("s-1", "Audit “speed”"), outcome: .finished, body: "  All good.\n\nDetails here.  ")
        #expect(one == "[Space update] Thread “Audit \"speed\"” (s-1) finished.\n\nAll good.\n\nDetails here.")
        #expect(Spaces.parseUpdates(one) == [SpaceUpdate(threadId: "s-1", title: "Audit \"speed\"", outcome: .finished, body: "All good.\n\nDetails here.")])
        let joined = [one, Spaces.update(thread: ("s-2", "Sitemap"), outcome: .failed, body: "Problem: 500"), Spaces.update(thread: ("s-3", "Post"), outcome: .stopped)]
            .joined(separator: Spaces.updateSeparator)
        let parsed = try #require(Spaces.parseUpdates(joined))
        #expect(parsed.map(\.threadId) == ["s-1", "s-2", "s-3"])
        #expect(parsed.map(\.outcome) == [.finished, .failed, .stopped])
        #expect(parsed[1].body == "Problem: 500" && parsed[2].body.isEmpty)
        // Not an update: nil. A malformed part is skipped.
        #expect(Spaces.parseUpdates("Hello [Space update] Thread “x” (y) finished.") == nil)
        #expect(Spaces.parseUpdates("[Space update] something else") == [])
        #expect(Spaces.parseUpdates("[Space update] Thread “x” (y z) finished.") == [])
    }

    @Test func draftsEncodeLikeTheServerExpects() throws {
        let new = try JSONValue(encoding: SpaceDraft(name: "Launch", goal: "Ship"))
        #expect(new["id"] == nil && new["name"] == "Launch" && new["goal"] == "Ship" && new["projectId"] == .null)
        let edit = try JSONValue(encoding: SpaceDraft(SpaceProfile(id: "sp1", name: "Launch", projectId: "p1", sessionId: "c")))
        #expect(edit["id"] == "sp1" && edit["projectId"] == "p1" && edit["sessionId"] == nil)
        #expect(!SpaceDraft(name: "  ").isValid && SpaceDraft(name: "x").isValid)
    }

    @Test func threadCardsComeFromStartThreadResults() {
        let call = ContentBlock.toolCall(.init(id: "c1", name: Spaces.startThreadTool, arguments: ["title": "Audit"]))
        let other = ContentBlock.toolCall(.init(id: "c2", name: "bash", arguments: ["command": "ls"]))
        let pendingCall = ContentBlock.toolCall(.init(id: "c3", name: Spaces.startThreadTool, arguments: ["title": "Later"]))
        let layout = ReplyLayout(messages: [AssistantMessage(content: [call, other, pendingCall, .text("Started.")], stopReason: "stop", timestamp: 0)], streaming: false)
        let results: [String: ToolResultMessage] = [
            "c1": ToolResultMessage(toolCallId: "c1", toolName: Spaces.startThreadTool, content: [.text("ok")], details: ["thread": ["id": "t1", "title": "Audit page speed"]], isError: false, timestamp: 0),
            "c2": ToolResultMessage(toolCallId: "c2", toolName: "bash", content: [.text("ok")], details: ["thread": ["id": "nope"]], isError: false, timestamp: 0)
        ]
        let threads = layout.startedThreads(results: results)
        #expect(threads.map(\.id) == ["t1"] && threads.map(\.title) == ["Audit page speed"])
        #expect(ReplyLayout.activity(Spaces.startThreadTool) == "Starting a thread")
    }
}

@MainActor
@Suite struct SpaceMockTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        agent.chunkDelay = .milliseconds(1)
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func seedsASpaceWithThreadsInEveryState() async throws {
        let (_, client) = await connected()
        await eventually { client.state?.spaces.isEmpty == false }
        let state = try #require(client.state)
        let space = try #require(state.space(MockAgent.spaceId))
        let ids = MockAgent.spaceThreadIds
        #expect(space.sessionId == MockAgent.spaceChatId)
        #expect(Set(state.threads(of: space).map(\.id)) == [ids.done, ids.working, ids.needsYou, ids.failed])
        #expect(Spaces.grouped(state.threads(of: space), pending: state.access.pending).map(\.status) == [.needsYou, .working, .failed, .done])
        #expect(state.chats.contains { $0.spaceId != nil } == false)
        #expect(try await client.spaceNotes(space.id) == MockAgent.spaceNotes)
    }

    @Test func createEditAndDelete() async throws {
        let (agent, client) = await connected()
        await eventually { client.state != nil }
        let space = try await client.saveSpace(SpaceDraft(name: "  Research  ", goal: "Find the best option", projectId: "p-dex"))
        #expect(space.name == "Research" && space.projectId == "p-dex" && !space.sessionId.isEmpty)
        await eventually { client.state?.session(space.sessionId)?.spaceId == space.id }
        #expect(client.state?.coordinated(by: space.sessionId)?.id == space.id)
        #expect(try await client.spaceNotes(space.id) == "")

        var draft = SpaceDraft(space)
        draft.name = "Deep research"
        draft.projectId = nil
        let edited = try await client.saveSpace(draft)
        #expect(edited.id == space.id && edited.sessionId == space.sessionId && edited.projectId == nil)
        await eventually { client.state?.session(space.sessionId)?.title == "Deep research" }
        await #expect(throws: AgentError.self) { _ = try await client.saveSpace(SpaceDraft(name: " ")) }

        // Asking the coordinator for a thread starts one, shown as a card in its reply.
        let feed = client.chat(space.sessionId)
        await eventually { feed.transcript.loaded }
        try await feed.send("Start a thread to compare the three vendors")
        await eventually(.seconds(10)) { feed.transcript.loaded && !feed.transcript.running && feed.toolResults.values.contains { $0.toolName == Spaces.startThreadTool } }
        let thread = try #require(client.state.flatMap { $0.threads(of: edited).first })
        #expect(thread.muted && thread.title == "Compare the three vendors")
        let reply: [AssistantMessage] = feed.displayItems.compactMap { item -> [AssistantMessage]? in
            if case .assistant(_, let messages, _, _) = item { messages } else { nil }
        }.last ?? []
        #expect(ReplyLayout(messages: reply, streaming: false).startedThreads(results: feed.toolResults).map(\.id) == [thread.id])

        // Deleting the space takes its chat and threads.
        try await client.deleteSpace(space.id)
        await eventually { client.state?.space(space.id) == nil }
        #expect(client.state?.session(space.sessionId) == nil && client.state?.session(thread.id) == nil)
        #expect(agent.calls.map(\.method).filter { $0.hasSuffix("Space") } == ["saveSpace", "saveSpace", "saveSpace", "deleteSpace"])
    }
}
