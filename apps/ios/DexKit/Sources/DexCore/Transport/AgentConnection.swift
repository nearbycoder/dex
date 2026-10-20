import Foundation
import Observation

public enum AgentError: LocalizedError, Equatable {
    /// The agent returned an error for an RPC call (its message).
    case remote(String)
    case timedOut(String)
    case connectionClosed
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .remote(let message): message
        case .timedOut(let method): "Dex didn't answer in time (\(method))."
        case .connectionClosed: "Lost the connection to Dex. Try again."
        case .decoding(let detail): "Dex sent something this app can't read: \(detail)"
        }
    }
}

/// One connection to the user's DexAgent: the Agents SDK protocol (identity, synced state, RPC) plus Dex's own
/// `dex.*` messages. Reconnects on its own with backoff, like the web's PartySocket.
@MainActor
@Observable
public final class AgentConnection {
    public enum Status: Equatable, Sendable {
        case idle
        case connecting
        /// Identified and the state has arrived.
        case connected
        /// Waiting to reconnect.
        case waiting(retryIn: Double)
        /// The session is no longer valid (signed out everywhere, or expired): sign in again.
        case signedOut
    }

    public private(set) var status: Status = .idle
    /// The latest synced state.
    public private(set) var state: DexState?
    /// Set when the agent last said who it is.
    public private(set) var identity: (name: String, agent: String)?
    public var isConnected: Bool { status == .connected }

    @ObservationIgnored private let factory: AgentTransportFactory
    @ObservationIgnored private var transport: AgentTransport?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var pending: [String: PendingCall] = [:]
    /// Frames sent while not connected, flushed once open (RPC calls made during a reconnect still go).
    @ObservationIgnored private var outbox: [String] = []
    @ObservationIgnored private var open = false
    @ObservationIgnored private var attempts = 0
    @ObservationIgnored private var reconnectTask: Task<Void, Never>?
    @ObservationIgnored private var listeners: [UUID: (ServerMessage) -> Void] = [:]
    @ObservationIgnored private var connectListeners: [UUID: () -> Void] = [:]
    @ObservationIgnored private var stateFollows = false
    @ObservationIgnored public var onSignedOut: (() -> Void)?
    @ObservationIgnored public var onStateChange: ((DexState) -> Void)?

    private struct PendingCall {
        let method: String
        let continuation: CheckedContinuation<JSONValue, Error>
        var transmitted: Bool
        let timeout: Task<Void, Never>?
    }

    public init(factory: AgentTransportFactory, initialState: DexState? = nil) {
        self.factory = factory
        self.state = initialState
    }

    // MARK: Lifecycle

    public func start() {
        guard transport == nil, status != .signedOut else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        connect()
    }

    /// Reconnects at once if it's waiting (the app came to the foreground).
    public func reconnectNow() {
        switch status {
        case .waiting, .idle:
            reconnectTask?.cancel()
            reconnectTask = nil
            attempts = 0
            if transport == nil { connect() }
        default: break
        }
    }

    public func stop() {
        reconnectTask?.cancel()
        reconnectTask = nil
        generation += 1
        transport?.close()
        transport = nil
        open = false
        rejectPending(onlyTransmitted: false)
        if status != .signedOut { status = .idle }
    }

    private func connect() {
        generation += 1
        let current = generation
        status = .connecting
        stateFollows = false
        let transport = factory.makeTransport()
        self.transport = transport
        transport.open { [weak self] event in
            Task { @MainActor [weak self] in self?.handle(event, generation: current) }
        }
    }

    private func handle(_ event: TransportEvent, generation current: Int) {
        guard current == generation else { return }
        switch event {
        case .opened:
            open = true
            attempts = 0
            for index in pending.keys { pending[index]?.transmitted = true }
            let frames = outbox
            outbox.removeAll()
            for frame in frames { transport?.send(frame) }
        case .message(let text):
            receive(text)
        case .closed(let code, _, let httpStatus):
            open = false
            transport = nil
            identity = nil
            if code == 4001 || httpStatus == 401 || httpStatus == 403 {
                status = .signedOut
                rejectPending(onlyTransmitted: false)
                onSignedOut?()
                return
            }
            rejectPending(onlyTransmitted: true)
            scheduleReconnect()
        }
    }

    private func scheduleReconnect() {
        attempts += 1
        let delay = min(30, pow(1.6, Double(min(attempts, 10))) * 0.6)
        status = .waiting(retryIn: delay)
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.reconnectTask = nil
            self?.connect()
        }
    }

    // MARK: Receiving

    private func receive(_ text: String) {
        // Dex's own messages put their type first; anything else is parsed to find its type.
        if text.hasPrefix("{\"type\":\"dex.") {
            deliver(text)
            return
        }
        guard let frame = try? JSONValue.parse(text), let type = frame["type"]?.string else { return }
        if type.hasPrefix("dex.") {
            deliver(text)
            return
        }
        switch type {
        case "cf_agent_identity":
            identity = (frame["name"]?.string ?? "", frame["agent"]?.string ?? "")
            stateFollows = frame["stateFollows"]?.bool == true
            if !stateFollows { becameConnected() }
        case "cf_agent_state":
            if let raw = frame["state"], let decoded = try? raw.decode(DexState.self) {
                state = decoded
                onStateChange?(decoded)
            }
            if stateFollows || status != .connected {
                stateFollows = false
                if identity != nil { becameConnected() }
            }
        case "rpc":
            guard let id = frame["id"]?.string, let call = pending[id] else { return }
            if frame["success"]?.bool == false {
                pending[id] = nil
                call.timeout?.cancel()
                call.continuation.resume(throwing: AgentError.remote(frame["error"]?.string ?? "Something went wrong"))
                return
            }
            // Streaming calls send chunks with done: false; only the last one resolves.
            if frame["done"]?.bool == false { return }
            pending[id] = nil
            call.timeout?.cancel()
            call.continuation.resume(returning: frame["result"] ?? .null)
        default:
            break
        }
    }

    private func deliver(_ text: String) {
        do {
            let message = try JSONDecoder.dex.decode(ServerMessage.self, from: Data(text.utf8))
            for listener in listeners.values { listener(message) }
        } catch {
            print("[Dex] Could not read a Dex message: \(error)")
        }
    }

    private func becameConnected() {
        guard status != .connected else { return }
        status = .connected
        for listener in connectListeners.values { listener() }
    }

    // MARK: Sending

    /// Sends a Dex message (subscribe, ping, presence). Dropped while disconnected: subscriptions are renewed on
    /// connect by their owners.
    public func send(_ message: ClientMessage) {
        guard open else { return }
        transport?.send(message.json)
    }

    /// Calls a `@callable()` method on the agent.
    @discardableResult
    public func call(_ method: String, _ args: [JSONValue] = [], timeout: Double? = 30) async throws -> JSONValue {
        if status == .signedOut { throw AgentError.connectionClosed }
        let id = UUID().uuidString
        let frame = JSONValue.object(["type": "rpc", "id": .string(id), "method": .string(method), "args": .array(args)]).jsonText
        return try await withCheckedThrowingContinuation { continuation in
            let timer: Task<Void, Never>? = timeout.map { seconds in
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(seconds))
                    guard !Task.isCancelled, let self, let call = self.pending.removeValue(forKey: id) else { return }
                    call.continuation.resume(throwing: AgentError.timedOut(method))
                }
            }
            pending[id] = PendingCall(method: method, continuation: continuation, transmitted: open, timeout: timer)
            if open { transport?.send(frame) } else {
                outbox.append(frame)
                if transport == nil, case .idle = status { start() }
            }
        }
    }

    /// Calls a method and decodes its result.
    public func call<T: Decodable>(_ method: String, _ args: [JSONValue] = [], as type: T.Type = T.self, timeout: Double? = 30) async throws -> T {
        let result = try await call(method, args, timeout: timeout)
        do {
            return try result.decode(T.self)
        } catch {
            throw AgentError.decoding("\(method): \(error)")
        }
    }

    private func rejectPending(onlyTransmitted: Bool) {
        for (id, call) in pending where !onlyTransmitted || call.transmitted {
            pending[id] = nil
            call.timeout?.cancel()
            call.continuation.resume(throwing: AgentError.connectionClosed)
        }
        if !onlyTransmitted { outbox.removeAll() }
    }

    // MARK: Listening

    public final class Subscription {
        private let cancel: () -> Void
        init(_ cancel: @escaping () -> Void) { self.cancel = cancel }
        public func cancelNow() { cancel() }
        deinit { cancel() }
    }

    /// Calls `handler` for every `dex.*` message until the returned subscription goes away.
    public func listen(_ handler: @escaping (ServerMessage) -> Void) -> Subscription {
        let id = UUID()
        listeners[id] = handler
        return Subscription { [weak self] in
            Task { @MainActor [weak self] in self?.listeners[id] = nil }
        }
    }

    /// Calls `handler` every time the connection is ready (after each reconnect).
    public func onConnect(_ handler: @escaping () -> Void) -> Subscription {
        let id = UUID()
        connectListeners[id] = handler
        if status == .connected { handler() }
        return Subscription { [weak self] in
            Task { @MainActor [weak self] in self?.connectListeners[id] = nil }
        }
    }

    /// Replaces the shown state (the copy kept on the device, before the socket connects).
    public func showCachedState(_ cached: DexState) {
        if state == nil { state = cached }
    }
}
