import Foundation
import Observation

/// One signed-in connection to Dex: the agent connection, its synced state, the model list, and the chat on screen.
/// Each window has its own (like a browser tab: the agent streams one chat per connection, and presence is per window).
@MainActor
@Observable
public final class DexClient {
    public let credentials: Credentials?
    public let connection: AgentConnection
    public let cache: LocalCache?
    public var viewer: Viewer? { credentials?.user }
    public var server: URL? { credentials?.server }

    /// The latest synced state, or the copy kept on the device until the socket connects.
    public var state: DexState? { connection.state }
    public var isConnected: Bool { connection.isConnected }
    public private(set) var catalog: ModelCatalog
    /// The chat whose events this connection streams (one at a time).
    public private(set) var activeChat: ChatFeed?
    /// A message for the user that no screen claimed (shown as a banner).
    public var notice: String?

    @ObservationIgnored private var subscriptions: [AgentConnection.Subscription] = []
    @ObservationIgnored private var visible = true
    @ObservationIgnored private var feeds: [String: ChatFeed] = [:]
    @ObservationIgnored private var saveStateTask: Task<Void, Never>?
    @ObservationIgnored private var fetchingModels = false

    /// Prepares a file for a message; the mock agent puts its own here (tests, the demo). Unset: `POST /api/attachments`.
    @ObservationIgnored public var uploader: (@Sendable (Data, String, String) async throws -> ChatAttachment)?

    /// Sends a file to be prepared for a message (an image scaled to fit the model, or a file's text).
    public func uploadAttachment(_ data: Data, name: String, mimeType: String) async throws -> ChatAttachment {
        if let uploader { return try await uploader(data, name, mimeType) }
        guard let credentials else { throw AttachmentError("Sign in again", status: 401) }
        return try await AttachmentUploader.upload(server: credentials.server, token: credentials.token, data: data, name: name, mimeType: mimeType)
    }

    public init(credentials: Credentials?, factory: AgentTransportFactory, cache: LocalCache?) {
        self.credentials = credentials
        self.cache = cache
        let userId = credentials?.user.id
        let cached = userId.flatMap { cache?.loadState(userId: $0) }
        connection = AgentConnection(factory: factory, initialState: cached)
        catalog = cache?.loadModels() ?? .empty
        connection.onStateChange = { [weak self] state in self?.stateChanged(state) }
        subscriptions.append(connection.onConnect { [weak self] in self?.connected() })
    }

    public func start() { connection.start() }
    public func stop() { connection.stop() }

    private func connected() {
        reportPresence()
        if let state { stateChanged(state) }
    }

    private func stateChanged(_ state: DexState) {
        // The agent refreshes the model list; when its version changes, fetch and keep it.
        if let latest = state.models?.version, latest != catalog.version, isConnected { Task { await refreshCatalog() } }
        else if catalog.models.isEmpty, isConnected { Task { await refreshCatalog() } }
        // Kept a moment after it settles, not on every streamed change.
        saveStateTask?.cancel()
        guard let userId = viewer?.id, let cache else { return }
        saveStateTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let state = self?.connection.state else { return }
            cache.saveState(state, userId: userId)
        }
    }

    public func refreshCatalog() async {
        guard !fetchingModels else { return }
        fetchingModels = true
        defer { fetchingModels = false }
        guard let catalog = try? await connection.call("modelCatalog", as: ModelCatalog.self), !catalog.models.isEmpty,
              catalog.updatedAt >= self.catalog.updatedAt || self.catalog.models.isEmpty else { return }
        self.catalog = catalog
        cache?.saveModels(catalog)
    }

    /// Installs a model list (previews and tests).
    public func setCatalog(_ catalog: ModelCatalog) { self.catalog = catalog }

    // MARK: Chats

    /// The live transcript of a chat; opening one makes it the connection's streamed chat.
    public func chat(_ sessionId: String) -> ChatFeed {
        if let feed = feeds[sessionId] {
            activate(feed)
            return feed
        }
        let cached = viewer.flatMap { cache?.loadTranscript(userId: $0.id, sessionId: sessionId) }
        let feed = ChatFeed(sessionId: sessionId, client: self, cached: cached)
        feeds[sessionId] = feed
        // Recently opened chats stay in memory so going back shows them at once.
        if feeds.count > 12, let oldest = feeds.values.filter({ $0 !== feed && $0 !== activeChat }).min(by: { $0.lastOpened < $1.lastOpened }) {
            feeds[oldest.sessionId] = nil
        }
        activate(feed)
        return feed
    }

    private func activate(_ feed: ChatFeed) {
        feed.lastOpened = .now
        guard activeChat !== feed else { return }
        activeChat?.deactivate()
        activeChat = feed
        feed.activate()
        reportPresence()
    }

    /// Leaves the chat (no chat on screen).
    public func closeChat(_ sessionId: String) {
        guard activeChat?.sessionId == sessionId else { return }
        activeChat?.deactivate()
        activeChat = nil
        reportPresence()
    }

    func remember(_ transcript: TranscriptState, sessionId: String) {
        guard let userId = viewer?.id else { return }
        cache?.saveTranscript(transcript, userId: userId, sessionId: sessionId)
    }

    func forget(sessionId: String) {
        feeds[sessionId] = nil
        if activeChat?.sessionId == sessionId { activeChat = nil }
        if let userId = viewer?.id { cache?.removeTranscript(userId: userId, sessionId: sessionId) }
    }

    // MARK: Presence

    /// Whether this window is in the foreground; notifications skip the chat you're looking at.
    public func setVisible(_ visible: Bool) {
        self.visible = visible
        if visible { connection.reconnectNow() }
        reportPresence()
    }

    private func reportPresence() {
        connection.send(.presence(visible: visible, sessionId: activeChat?.sessionId))
    }

    // MARK: Calls

    /// Calls an agent method, decoding its result.
    public func call<T: Decodable>(_ method: String, _ args: JSONValue..., as type: T.Type = T.self, timeout: Double? = 30) async throws -> T {
        try await connection.call(method, args, as: T.self, timeout: timeout)
    }

    /// Calls an agent method whose result doesn't matter.
    @discardableResult
    public func run(_ method: String, _ args: JSONValue..., timeout: Double? = 30) async throws -> JSONValue {
        try await connection.call(method, args, timeout: timeout)
    }

    /// Runs an action and shows its error, if any, as the notice.
    public func perform(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action() } catch { notice = error.localizedDescription }
        }
    }
}

/// One chat's live transcript and what you can do in it.
@MainActor
@Observable
public final class ChatFeed {
    public let sessionId: String
    public private(set) var transcript: TranscriptState
    /// What you just sent, shown at once until the agent records it (see the web's chat page).
    public private(set) var pending: [PendingMessage] = []

    public struct PendingMessage: Identifiable, Hashable, Sendable {
        public let id = UUID()
        public let text: String
        let after: Int
        let at: Date
    }

    @ObservationIgnored weak var client: DexClient?
    @ObservationIgnored var lastOpened = Date.now
    @ObservationIgnored private var subscriptions: [AgentConnection.Subscription] = []
    @ObservationIgnored private var ping: Task<Void, Never>?
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    public static let pingInterval: Double = 20

    init(sessionId: String, client: DexClient, cached: TranscriptState?) {
        self.sessionId = sessionId
        self.client = client
        self.transcript = cached ?? .empty
    }

    /// For previews and tests.
    public init(sessionId: String, transcript: TranscriptState) {
        self.sessionId = sessionId
        self.transcript = transcript
    }

    public var session: SessionMeta? { client?.state?.session(sessionId) }

    func activate() {
        guard let connection = client?.connection else { return }
        subscriptions = [
            connection.listen { [weak self] message in
                guard let self, message.sessionId == self.sessionId else { return }
                self.receive(message)
            },
            connection.onConnect { [weak self] in
                guard let self else { return }
                self.client?.connection.send(.subscribe(sessionId: self.sessionId))
            }
        ]
        ping?.cancel()
        ping = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.pingInterval))
                guard let self, !Task.isCancelled else { return }
                self.client?.connection.send(.ping(sessionId: self.sessionId))
            }
        }
    }

    func deactivate() {
        ping?.cancel()
        ping = nil
        subscriptions = []
        client?.connection.send(.unsubscribe)
    }

    /// Applies a message about this chat (also used by tests).
    public func receive(_ message: ServerMessage) {
        transcript.apply(message)
        settlePending()
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard let self, !Task.isCancelled else { return }
            self.client?.remember(self.transcript, sessionId: self.sessionId)
        }
    }

    private var userCount: Int { transcript.entries.filter { $0.kind == "pi.user" }.count }

    private func settlePending() {
        guard !pending.isEmpty else { return }
        // Each pending message matches the next one the agent records (not by text: skills and secrets change it).
        let recorded = max(0, userCount - pending[0].after)
        var next = Array(pending.dropFirst(min(recorded, pending.count))).filter { Date.now.timeIntervalSince($0.at) < 20 }
        if !transcript.queue.isEmpty { next = [] }
        if next != pending { pending = next }
    }

    // MARK: Actions

    /// Sends a message: it runs now, or waits in the queue while the chat is busy. `attachments` are as
    /// `DexClient.uploadAttachment` returned them; left out of the call when there are none, as the web does.
    public func send(_ text: String, attachments: [ChatAttachment] = []) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty, let client else { return }
        // Shown until the agent records it; a message of only files shows their names.
        let label = trimmed.isEmpty ? "Attached: \(attachmentSummary(attachments.map(\.name)))" : trimmed
        let willQueue = transcript.running || !transcript.queue.isEmpty
        if !willQueue { pending.append(PendingMessage(text: label, after: userCount + pending.count, at: .now)) }
        do {
            if attachments.isEmpty {
                try await client.run("sendMessage", .string(sessionId), .string(trimmed))
            } else {
                try await client.run("sendMessage", .string(sessionId), .string(trimmed), .array(attachments.map(\.json)))
            }
        } catch {
            pending.removeAll { $0.text == label }
            throw error
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(20.5))
            self?.settlePending()
        }
    }

    public func abort() async throws { try await client?.run("abort", .string(sessionId)) }
    public func editQueued(_ id: String, text: String) async throws { try await client?.run("editQueued", .string(sessionId), .string(id), .string(text)) }
    public func removeQueued(_ id: String) async throws { try await client?.run("removeQueued", .string(sessionId), .string(id)) }
    public func moveQueued(_ id: String, to index: Int) async throws { try await client?.run("moveQueued", .string(sessionId), .string(id), .number(Double(index))) }
    public func steerQueued(_ id: String) async throws { try await client?.run("steerQueued", .string(sessionId), .string(id)) }

    /// Changes the chat's model, thinking level, or MCP servers (from the next model request).
    public func configure(model: String? = nil, thinking: ThinkingLevel? = nil, mcpServers: [String]? = nil) async throws {
        var options: [String: JSONValue] = [:]
        if let model { options["model"] = .string(model) }
        if let thinking { options["thinking"] = .string(thinking) }
        if let mcpServers { options["mcpServers"] = .array(mcpServers.map(JSONValue.string)) }
        try await client?.run("configureSession", .string(sessionId), .object(options))
    }

    public func rename(_ title: String) async throws { try await client?.run("renameSession", .string(sessionId), .string(title)) }
    public func regenerateTitle() async throws -> String { try await client?.call("regenerateSessionTitle", .string(sessionId), timeout: 60) ?? "" }
    public func setMuted(_ muted: Bool) async throws { try await client?.run("setSessionMuted", .string(sessionId), .bool(muted)) }
    public func settle(_ settled: Bool) async throws { try await client?.run("triageSession", .string(sessionId), ["settled": .bool(settled)]) }
    public func snooze(until: Double?) async throws {
        try await client?.run("triageSession", .string(sessionId), ["snoozedUntil": until.map(JSONValue.number) ?? .null])
    }

    public func delete() async throws {
        try await client?.run("deleteSession", .string(sessionId), timeout: 60)
        client?.forget(sessionId: sessionId)
    }

    /// A screenshot left out of the transcript, loaded when shown.
    public func image(ref: String) async throws -> (data: Data, mimeType: String)? {
        struct Image: Decodable { let data: String; let mimeType: String }
        guard let image: Image? = try await client?.call("transcriptImage", .string(sessionId), .string(ref)), let image,
              let data = Data(base64Encoded: image.data) else { return nil }
        return (data, image.mimeType)
    }

    public func storeSecret(field: String, value: String) async throws -> String {
        try await client?.call("storeChatSecret", .string(sessionId), .string(field), .string(value)) ?? field
    }

    public func saveArtifact(url: String) async throws { try await client?.run("saveArtifact", .string(sessionId), .string(url), timeout: 120) }
}
