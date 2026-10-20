import Foundation
import Testing
@testable import DexCore

/// Waits until `condition` holds (or fails the test after `timeout`).
@MainActor
func eventually(_ timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while !condition() {
        if clock.now > deadline {
            Issue.record("Timed out waiting for a condition", sourceLocation: sourceLocation)
            return
        }
        try? await Task.sleep(for: .milliseconds(10))
    }
}

@MainActor
@Suite struct ConnectionTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        agent.chunkDelay = .milliseconds(1)
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func connectsAndSyncsState() async {
        let (agent, client) = await connected()
        #expect(client.state?.sessions.count == agent.state.sessions.count)
        await eventually { !client.catalog.models.isEmpty }
        agent.state.sessions[0].title = "Renamed elsewhere"
        agent.publish()
        await eventually { client.state?.sessions[0].title == "Renamed elsewhere" }
    }

    @Test func rpcResultsAndErrors() async throws {
        let (_, client) = await connected()
        let session: SessionMeta = try await client.call("createSession", ["title": "Hello"])
        #expect(session.title == "Hello")
        await eventually { client.state?.sessions.first?.id == session.id }
        await #expect(throws: AgentError.remote("Method nope does not exist")) { try await client.run("nope") }
    }

    @Test func streamsAReplyIntoTheFeed() async throws {
        let (agent, client) = await connected()
        let feed = client.chat(MockData.welcomeId)
        await eventually { feed.transcript.loaded }
        let before = feed.transcript.entries.count
        try await feed.send("Hi there")
        await eventually { feed.transcript.running || feed.transcript.entries.count > before }
        await eventually(.seconds(10)) { !feed.transcript.running && feed.transcript.entries.count >= before + 2 }
        #expect(feed.pending.isEmpty)
        guard case .assistant(_, let messages, false, _) = feed.transcript.displayItems.last else { Issue.record("no reply"); return }
        #expect(messages.last?.text.contains("Hi there") == true)
        #expect(agent.calls.contains { $0.method == "sendMessage" })
    }

    @Test func queuesWhileBusyThenDrains() async throws {
        let (agent, client) = await connected()
        let feed = client.chat(MockData.welcomeId)
        await eventually { feed.transcript.loaded }
        try await feed.send("go slow please")
        await eventually { feed.transcript.running }
        try await feed.send("then this")
        await eventually { feed.transcript.queue.count == 1 }
        // Stopping holds the queue.
        try await feed.abort()
        await eventually { !feed.transcript.running && feed.transcript.queueHeld }
        let id = feed.transcript.queue[0].id
        try await feed.editQueued(id, text: "edited")
        await eventually { feed.transcript.queue.first?.text == "edited" }
        try await feed.steerQueued(id)
        await eventually { feed.transcript.queue.isEmpty }
        await eventually(.seconds(10)) { !feed.transcript.running }
        #expect(agent.entries[MockData.welcomeId]?.contains { entry in
            if case .user(let user) = entry.model?.first { return user.text == "edited" } else { return false }
        } == true)
    }

    @Test func reconnectsAndResubscribes() async throws {
        let (agent, client) = await connected()
        let feed = client.chat(MockData.vmChatId)
        await eventually { feed.transcript.loaded }
        agent.dropConnections()
        await eventually { !client.isConnected }
        await eventually(.seconds(10)) { client.isConnected }
        await eventually { agent.connections.first?.subscribed == MockData.vmChatId }
    }

    @Test func signedOutEverywhereStopsReconnecting() async {
        let (agent, client) = await connected()
        var signedOut = false
        client.connection.onSignedOut = { signedOut = true }
        agent.signOutEverywhere()
        await eventually { client.connection.status == .signedOut }
        #expect(signedOut)
        await #expect(throws: AgentError.connectionClosed) { try await client.run("modelCatalog") }
    }

    @Test func presenceFollowsTheOpenChat() async {
        let (agent, client) = await connected()
        _ = client.chat(MockData.chartChatId)
        await eventually { agent.connections.first?.presence.sessionId == MockData.chartChatId }
        client.setVisible(false)
        await eventually { agent.connections.first?.presence.visible == false }
        client.closeChat(MockData.chartChatId)
        await eventually { agent.connections.first?.presence.sessionId == nil }
    }

    @Test func triageAndRename() async throws {
        let (_, client) = await connected()
        let feed = client.chat(MockData.welcomeId)
        try await feed.settle(true)
        await eventually { client.state?.session(MockData.welcomeId)?.settledAt != nil }
        try await feed.snooze(until: .nowMs + 3_600_000)
        await eventually { client.state?.session(MockData.welcomeId)?.snoozedUntil != nil && client.state?.session(MockData.welcomeId)?.settledAt == nil }
        try await feed.rename("Lisbon trip")
        await eventually { client.state?.session(MockData.welcomeId)?.title == "Lisbon trip" }
        try await feed.configure(model: "cline-pass/kimi-k3", thinking: "high")
        await eventually { client.state?.session(MockData.welcomeId)?.model == "cline-pass/kimi-k3" }
        try await feed.delete()
        await eventually { client.state?.session(MockData.welcomeId) == nil }
    }
}

@Suite struct CacheTests {
    @Test func keepsStateAndRecentChats() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "dex-cache-\(UUID().uuidString)")
        let cache = LocalCache(root: root)
        cache.saveState(MockData.state(), userId: "u")
        var transcript = TranscriptState.empty
        transcript.entries = MockData.transcript(for: MockData.state().sessions[0])
        transcript.loaded = true
        for index in 0..<10 { cache.saveTranscript(transcript, userId: "u", sessionId: "s\(index)") }
        cache.flush()
        #expect(cache.loadState(userId: "u")?.sessions.count == 5)
        #expect(cache.loadState(userId: "other") == nil)
        #expect(cache.loadTranscript(userId: "u", sessionId: "s9")?.entries.count == transcript.entries.count)
        let kept = try FileManager.default.contentsOfDirectory(atPath: root.appending(path: "chats").path()).count
        #expect(kept == LocalCache.maxChats)
        cache.saveModels(MockData.catalog)
        cache.flush()
        cache.clear()
        #expect(cache.loadState(userId: "u") == nil)
        #expect(cache.loadModels() != nil)
    }
}
