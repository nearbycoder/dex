import Foundation

/// An in-process stand-in for a DexAgent, speaking the same wire protocol as the real one (Agents SDK frames and
/// `dex.*` messages). The app runs on it for UI tests and previews (`-DexMock`), so every screen can be driven
/// without a server. Feature areas install their methods in `installHandlers()`; see the Mock*Handlers files.
@MainActor
public final class MockAgent {
    public typealias Handler = @MainActor (_ args: [JSONValue], _ connection: MockConnection) async throws -> JSONValue

    public var state: DexState
    /// Each chat's transcript entries.
    public var entries: [String: [EntryRecord]] = [:]
    public var queues: [String: [QueuedMessage]] = [:]
    /// Queued messages' attachments, by queue item id.
    var queuedFiles: [String: [ChatAttachment]] = [:]
    public var heldQueues: Set<String> = []
    public var artifacts: [String: [ChatArtifact]] = [:]
    public var running: Set<String> = []
    public var catalog: ModelCatalog
    /// Everything called, in order (tests read it).
    public private(set) var calls: [(method: String, args: [JSONValue])] = []
    /// Free-form storage for feature handlers.
    public var store: [String: JSONValue] = [:]
    /// How long a streamed reply waits between chunks.
    public var chunkDelay: Duration = .milliseconds(25)

    var handlers: [String: Handler] = [:]
    var connections: [MockConnection] = []
    private var nextEntry = 1000

    public init(state: DexState = MockData.state(), catalog: ModelCatalog = MockData.catalog) {
        self.state = state
        self.catalog = catalog
        for session in state.sessions { entries[session.id] = MockData.transcript(for: session) }
        installHandlers()
    }

    /// Adds or replaces a method.
    public func register(_ method: String, _ handler: @escaping Handler) { handlers[method] = handler }

    private func installHandlers() {
        installCoreHandlers()
        installChatHandlers()
        installLibraryHandlers()
        installCharacterHandlers()
        installMachineHandlers()
        installSettingsHandlers()
        installOpenUIHandlers()
    }

    public func entryId() -> String {
        nextEntry += 1
        return String(nextEntry)
    }

    // MARK: Publishing

    /// Sends the state to every connection (the agent's `setState`).
    public func publish() {
        for connection in connections { connection.sendState() }
    }

    /// Sends a Dex message to the connections watching `sessionId` (or all, for nil).
    public func broadcast(_ message: JSONValue, sessionId: String?) {
        for connection in connections where sessionId == nil || connection.subscribed == sessionId { connection.deliver(message) }
    }

    func snapshot(_ sessionId: String) -> JSONValue {
        let records = entries[sessionId] ?? []
        var snapshot: [String: JSONValue] = [
            "type": "snapshot",
            "entries": (try? JSONValue(encoding: records)) ?? .array([]),
            "tools": .array([]),
            "nestedTools": .array([]),
            "compactions": .array([]),
            "inbox": .array([]),
            "agent": .object([:]),
            "usage": .object([:])
        ]
        if running.contains(sessionId) { snapshot["run"] = ["inputs": .array([])] }
        return ["type": "dex.snapshot", "sessionId": .string(sessionId), "snapshot": .object(snapshot)]
    }

    func queueMessage(_ sessionId: String) -> JSONValue {
        ["type": "dex.queue", "sessionId": .string(sessionId), "items": (try? JSONValue(encoding: queues[sessionId] ?? [])) ?? [], "held": .bool(heldQueues.contains(sessionId))]
    }

    func artifactsMessage(_ sessionId: String) -> JSONValue {
        ["type": "dex.artifacts", "sessionId": .string(sessionId), "artifacts": (try? JSONValue(encoding: artifacts[sessionId] ?? [])) ?? [], "saving": []]
    }

    public func events(_ sessionId: String, _ events: [JSONValue]) {
        broadcast(["type": "dex.events", "sessionId": .string(sessionId), "events": .array(events)], sessionId: sessionId)
    }

    public func publishQueue(_ sessionId: String) { broadcast(queueMessage(sessionId), sessionId: sessionId) }

    // MARK: Requests

    func handle(rpc frame: JSONValue, from connection: MockConnection) async {
        guard let id = frame["id"]?.string, let method = frame["method"]?.string else { return }
        let args = frame["args"]?.array ?? []
        calls.append((method, args))
        do {
            guard let handler = handlers[method] else { throw AgentError.remote("Method \(method) does not exist") }
            let result = try await handler(args, connection)
            connection.deliver(["type": "rpc", "id": .string(id), "success": true, "done": true, "result": result])
        } catch {
            connection.deliver(["type": "rpc", "id": .string(id), "success": false, "error": .string(error.localizedDescription)])
        }
    }

    func handle(message frame: JSONValue, from connection: MockConnection) {
        switch frame["type"]?.string {
        case "dex.subscribe", "dex.ping":
            guard let sessionId = frame["sessionId"]?.string else { connection.subscribed = nil; return }
            if frame["type"]?.string == "dex.ping", connection.subscribed == sessionId { return }
            connection.subscribed = sessionId
            guard state.session(sessionId) != nil else {
                connection.deliver(["type": "dex.error", "sessionId": .string(sessionId), "message": "Chat not found"])
                return
            }
            connection.deliver(snapshot(sessionId))
            connection.deliver(artifactsMessage(sessionId))
            connection.deliver(queueMessage(sessionId))
        case "dex.unsubscribe":
            connection.subscribed = nil
        case "dex.presence":
            connection.presence = (frame["visible"]?.bool ?? true, frame["sessionId"]?.string)
            // A chat on screen in a visible window has been seen.
            if connection.presence.visible { markRead(connection.presence.sessionId) }
        default:
            break
        }
    }

    /// Ends every connection as "signed out everywhere" does (close code 4001).
    public func signOutEverywhere() {
        for connection in connections { connection.closeConnection(code: 4001) }
    }

    /// Drops every connection, as a network blip does; the app reconnects.
    public func dropConnections() {
        for connection in connections { connection.closeConnection(code: 1006) }
    }
}

/// One app connection to the mock agent.
public final class MockConnection: AgentTransport, @unchecked Sendable {
    weak var agent: MockAgent?
    private var handler: (@Sendable (TransportEvent) -> Void)?
    @MainActor public var subscribed: String?
    @MainActor public var presence: (visible: Bool, sessionId: String?) = (true, nil)
    private var closed = false

    init(agent: MockAgent) { self.agent = agent }

    public func open(_ handler: @escaping @Sendable (TransportEvent) -> Void) {
        self.handler = handler
        Task { @MainActor [weak self] in
            guard let self, let agent = self.agent else { return }
            agent.connections.append(self)
            handler(.opened)
            self.deliver(["type": "cf_agent_identity", "name": "mock", "agent": "dex-agent", "stateFollows": true])
            self.sendState()
        }
    }

    public func send(_ text: String) {
        Task { @MainActor [weak self] in
            guard let self, !self.closed, let agent = self.agent, let frame = try? JSONValue.parse(text) else { return }
            if frame["type"]?.string == "rpc" { await agent.handle(rpc: frame, from: self) } else { agent.handle(message: frame, from: self) }
        }
    }

    public func close() {
        Task { @MainActor [weak self] in self?.closeConnection(code: 1000) }
    }

    @MainActor func closeConnection(code: Int) {
        guard !closed else { return }
        closed = true
        agent?.connections.removeAll { $0 === self }
        handler?(.closed(code: code, reason: nil, httpStatus: nil))
    }

    @MainActor func sendState() {
        guard let agent, let state = try? JSONValue(encoding: agent.state) else { return }
        deliver(["type": "cf_agent_state", "state": state])
    }

    @MainActor func deliver(_ frame: JSONValue) {
        guard !closed else { return }
        handler?(.message(frame.jsonText))
    }
}

/// Makes connections to one mock agent.
public struct MockTransportFactory: AgentTransportFactory, @unchecked Sendable {
    public let agent: MockAgent
    public init(agent: MockAgent) { self.agent = agent }
    public func makeTransport() -> AgentTransport { MockConnection(agent: agent) }
}

public extension Array where Element == JSONValue {
    func string(_ index: Int) -> String? { indices.contains(index) ? self[index].string : nil }
    func value(_ index: Int) -> JSONValue { indices.contains(index) ? self[index] : .null }
}
