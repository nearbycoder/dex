import Foundation

/// A message waiting for its chat to finish the current run.
public struct QueuedMessage: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var text: String
    public var createdAt: Double
    /// The files sent with it (names and types only).
    public var attachments: [AttachedFile]
    public init(id: String, text: String, createdAt: Double, attachments: [AttachedFile] = []) {
        self.id = id; self.text = text; self.createdAt = createdAt; self.attachments = attachments
    }
    enum CodingKeys: String, CodingKey { case id, text, createdAt, attachments }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); text = c.value(.text, default: ""); createdAt = c.value(.createdAt, default: 0)
        attachments = c.value(.attachments, default: [])
    }
}

/// A file a chat put in front of you, stored in Dex and served at /api/media/<key>.
public struct ChatArtifact: Codable, Sendable, Hashable, Identifiable {
    public var key: String
    public var url: String
    public var name: String
    /// video, audio, image
    public var kind: String
    public var size: Int
    public var source: String?
    public var createdAt: Double
    public var id: String { key }
    public init(key: String, url: String, name: String, kind: String, size: Int, source: String? = nil, createdAt: Double) {
        self.key = key; self.url = url; self.name = name; self.kind = kind; self.size = size; self.source = source; self.createdAt = createdAt
    }
}

/// Messages the app sends over the agent WebSocket, beside RPC calls.
public enum ClientMessage: Sendable, Hashable, Encodable {
    case subscribe(sessionId: String)
    case unsubscribe
    /// Sent every 20 seconds: re-opens the event stream if the object was evicted since.
    case ping(sessionId: String?)
    /// Whether Dex is visible on this connection and which chat it shows; notifications skip what you're looking at.
    case presence(visible: Bool, sessionId: String?)

    enum CodingKeys: String, CodingKey { case type, sessionId, visible }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .subscribe(let id): try c.encode("dex.subscribe", forKey: .type); try c.encode(id, forKey: .sessionId)
        case .unsubscribe: try c.encode("dex.unsubscribe", forKey: .type)
        case .ping(let id): try c.encode("dex.ping", forKey: .type); try c.encode(id, forKey: .sessionId)
        case .presence(let visible, let id): try c.encode("dex.presence", forKey: .type); try c.encode(visible, forKey: .visible); try c.encode(id, forKey: .sessionId)
        }
    }

    public var json: String { (try? JSONEncoder.dex.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}" }
}

/// Dex's own messages on the agent WebSocket (`dex.*`).
public enum ServerMessage: Sendable, Hashable, Decodable {
    case snapshot(sessionId: String, snapshot: SnapshotEvent)
    case events(sessionId: String, events: [AgentEvent])
    case error(sessionId: String?, message: String)
    case queue(sessionId: String, items: [QueuedMessage], held: Bool)
    case artifacts(sessionId: String, artifacts: [ChatArtifact], saving: [String])
    case vmActivity(vmKey: String, activity: VmActivity)
    case vmOutput(vmKey: String, id: Int, data: String)
    case unknown(String)

    enum CodingKeys: String, CodingKey { case type, sessionId, snapshot, events, message, items, held, artifacts, saving, vmKey, activity, id, data }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "dex.snapshot": self = .snapshot(sessionId: try c.decode(String.self, forKey: .sessionId), snapshot: try c.decode(SnapshotEvent.self, forKey: .snapshot))
        case "dex.events": self = .events(sessionId: try c.decode(String.self, forKey: .sessionId), events: c.value(.events, default: []))
        case "dex.error": self = .error(sessionId: c.value(.sessionId, default: nil), message: c.value(.message, default: "Something went wrong"))
        case "dex.queue": self = .queue(sessionId: try c.decode(String.self, forKey: .sessionId), items: c.value(.items, default: []), held: c.value(.held, default: false))
        case "dex.artifacts":
            self = .artifacts(sessionId: try c.decode(String.self, forKey: .sessionId), artifacts: c.value(.artifacts, default: []), saving: c.value(.saving, default: []))
        case "dex.vm.activity": self = .vmActivity(vmKey: try c.decode(String.self, forKey: .vmKey), activity: try c.decode(VmActivity.self, forKey: .activity))
        case "dex.vm.output": self = .vmOutput(vmKey: try c.decode(String.self, forKey: .vmKey), id: try c.decode(Int.self, forKey: .id), data: c.value(.data, default: ""))
        default: self = .unknown(type)
        }
    }

    /// The chat this message is about, if any.
    public var sessionId: String? {
        switch self {
        case .snapshot(let id, _), .events(let id, _), .queue(let id, _, _), .artifacts(let id, _, _): id
        case .error(let id, _): id
        default: nil
        }
    }
}
