import Foundation

// The agent's synced state and the records in it, mirroring apps/web/src/shared/protocol.ts and the shared types it
// imports. Every field an older agent might not send decodes to the same default `withStateDefaults` gives it, so
// state from any agent build decodes.

public typealias ThinkingLevel = String

public enum ThinkingLevels {
    public static let all: [ThinkingLevel] = ["off", "minimal", "low", "medium", "high", "xhigh"]
    public static func label(_ level: ThinkingLevel) -> String {
        switch level {
        case "off": "Off"
        case "minimal": "Minimal"
        case "low": "Low"
        case "medium": "Medium"
        case "high": "High"
        case "xhigh": "Extra high"
        default: level.capitalized
        }
    }
}

public struct SessionMeta: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var model: String
    public var thinking: ThinkingLevel
    public var createdAt: Double
    public var updatedAt: Double
    public var busy: Bool
    public var agentId: String?
    public var mcpServers: [String]
    public var projectId: String?
    /// The character this is a conversation with, if any: it lives under them, not in the chat list.
    public var characterId: String?
    /// A reply came in since you last looked at it (false from agents before unread).
    public var unread: Bool
    /// The latest reply, shortened (for lists, widgets, and notifications).
    public var lastReply: String?
    /// When the latest reply finished.
    public var repliedAt: Double?
    public var muted: Bool
    public var settledAt: Double?
    public var snoozedUntil: Double?

    public init(id: String, title: String, model: String, thinking: ThinkingLevel, createdAt: Double, updatedAt: Double,
                busy: Bool = false, agentId: String? = nil, mcpServers: [String] = [], projectId: String? = nil, characterId: String? = nil,
                unread: Bool = false, lastReply: String? = nil, repliedAt: Double? = nil,
                muted: Bool = false, settledAt: Double? = nil, snoozedUntil: Double? = nil) {
        self.id = id; self.title = title; self.model = model; self.thinking = thinking; self.createdAt = createdAt
        self.updatedAt = updatedAt; self.busy = busy; self.agentId = agentId; self.mcpServers = mcpServers
        self.projectId = projectId; self.characterId = characterId; self.unread = unread; self.lastReply = lastReply; self.repliedAt = repliedAt
        self.muted = muted; self.settledAt = settledAt; self.snoozedUntil = snoozedUntil
    }

    enum CodingKeys: String, CodingKey {
        case id, title, model, thinking, createdAt, updatedAt, busy, agentId, mcpServers, projectId, characterId, unread, lastReply, repliedAt, muted, settledAt, snoozedUntil
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.value(.title, default: "New chat")
        model = c.value(.model, default: "")
        thinking = c.value(.thinking, default: "low")
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
        busy = c.value(.busy, default: false)
        agentId = c.value(.agentId, default: nil)
        mcpServers = c.value(.mcpServers, default: [])
        projectId = c.value(.projectId, default: nil)
        characterId = c.value(.characterId, default: nil)
        unread = c.value(.unread, default: false)
        lastReply = c.value(.lastReply, default: nil)
        repliedAt = c.value(.repliedAt, default: nil)
        muted = c.value(.muted, default: false)
        settledAt = c.value(.settledAt, default: nil)
        snoozedUntil = c.value(.snoozedUntil, default: nil)
    }
}

public struct GitHubStatus: Codable, Sendable, Hashable {
    public var connected: Bool
    public var login: String?
    public var via: String?
    public var oauthAvailable: Bool?
    public var expired: Bool?
    public init(connected: Bool = false, login: String? = nil, via: String? = nil, oauthAvailable: Bool? = nil, expired: Bool? = nil) {
        self.connected = connected; self.login = login; self.via = via; self.oauthAvailable = oauthAvailable; self.expired = expired
    }
}

public struct BoatStatus: Codable, Sendable, Hashable {
    public var connected: Bool
    /// `user` (a key this user connected) or `server` (the deployment's key, owner only).
    public var source: String?
    public var keyHint: String?
    public init(connected: Bool = false, source: String? = nil, keyHint: String? = nil) {
        self.connected = connected; self.source = source; self.keyHint = keyHint
    }
}

public struct ClineStatus: Codable, Sendable, Hashable {
    public var connected: Bool
    public var source: String?
    public var keyHint: String?
    public var verifiedAt: Double?
    public init(connected: Bool = false, source: String? = nil, keyHint: String? = nil, verifiedAt: Double? = nil) {
        self.connected = connected; self.source = source; self.keyHint = keyHint; self.verifiedAt = verifiedAt
    }
}

public struct DexSettings: Codable, Sendable, Hashable {
    public var defaultModel: String
    public var defaultThinking: ThinkingLevel
    public var instructions: String
    public var vmSize: String
    public var vmMinutes: Int

    public init(defaultModel: String = "cline-pass/glm-5.3", defaultThinking: ThinkingLevel = "low", instructions: String = "", vmSize: String = "small", vmMinutes: Int = 5) {
        self.defaultModel = defaultModel; self.defaultThinking = defaultThinking; self.instructions = instructions; self.vmSize = vmSize; self.vmMinutes = vmMinutes
    }

    enum CodingKeys: String, CodingKey { case defaultModel, defaultThinking, instructions, vmSize, vmMinutes }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        defaultModel = c.value(.defaultModel, default: "cline-pass/glm-5.3")
        defaultThinking = c.value(.defaultThinking, default: "low")
        instructions = c.value(.instructions, default: "")
        vmSize = c.value(.vmSize, default: "small")
        vmMinutes = c.value(.vmMinutes, default: 5)
    }
}

public enum VmSizes {
    public static let all: [(id: String, label: String)] = [
        ("small", "Small · 2 vCPU · 4 GB"),
        ("default", "Default · 4 vCPU · 8 GB"),
        ("large", "Large · 8 vCPU · 16 GB")
    ]
}

/// The VM key of the VM that runs local (stdio) MCP servers, and of the one from before VMs were per chat.
public enum VmKeys {
    public static let mcp = "mcp-host"
    public static let shared = "shared"
}

public struct VmSetup: Codable, Sendable, Hashable {
    /// none, running, done, error
    public var status: String
    public var step: String?
    public var error: String?
    public static let none = VmSetup(status: "none", step: nil, error: nil)
    public init(status: String, step: String?, error: String?) { self.status = status; self.step = step; self.error = error }
}

public struct VmInfo: Codable, Sendable, Hashable, Identifiable {
    public var key: String
    public var id: String?
    /// none, starting, running, stopping, stopped, error
    public var status: String
    public var size: String?
    public var archiveAfter: String?
    public var error: String?
    public var lastActiveAt: Double?
    public var busy: Bool
    public var setup: VmSetup

    public var vmID: String { key }

    public init(key: String, id: String? = nil, status: String = "none", size: String? = nil, archiveAfter: String? = nil, error: String? = nil, lastActiveAt: Double? = nil, busy: Bool = false, setup: VmSetup = .none) {
        self.key = key; self.id = id; self.status = status; self.size = size; self.archiveAfter = archiveAfter; self.error = error
        self.lastActiveAt = lastActiveAt; self.busy = busy; self.setup = setup
    }

    enum CodingKeys: String, CodingKey { case key, id, status, size, archiveAfter, error, lastActiveAt, busy, setup }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        id = c.value(.id, default: nil)
        status = c.value(.status, default: "none")
        size = c.value(.size, default: nil)
        archiveAfter = c.value(.archiveAfter, default: nil)
        error = c.value(.error, default: nil)
        lastActiveAt = c.value(.lastActiveAt, default: nil)
        busy = c.value(.busy, default: false)
        setup = c.value(.setup, default: .none)
    }

    public var isRunning: Bool { status == "running" }
}

public struct VmActivity: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var at: Double
    /// agent, user, system
    public var actor: String
    /// exec, spawn, file, port, screenshot, lifecycle
    public var kind: String
    public var title: String
    /// running, done, error
    public var status: String
    public var exitCode: Int?
    public var output: String
    public init(id: Int, at: Double, actor: String, kind: String, title: String, status: String, exitCode: Int?, output: String) {
        self.id = id; self.at = at; self.actor = actor; self.kind = kind; self.title = title; self.status = status; self.exitCode = exitCode; self.output = output
    }
}

public struct ProjectRepo: Codable, Sendable, Hashable {
    public var url: String
    public var branch: String
    public var dir: String
    public init(url: String, branch: String = "", dir: String = "") { self.url = url; self.branch = branch; self.dir = dir }
}

public struct ProjectProfile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var icon: String
    public var color: String
    public var repos: [ProjectRepo]
    public var setupScript: String
    public var instructions: String
    public var starter: String
    public var vmSize: String?
    public var image: String?
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, name: String, description: String = "", icon: String = "code", color: String = "emerald", repos: [ProjectRepo] = [], setupScript: String = "", instructions: String = "", starter: String = "", vmSize: String? = nil, image: String? = nil, createdAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.name = name; self.description = description; self.icon = icon; self.color = color; self.repos = repos
        self.setupScript = setupScript; self.instructions = instructions; self.starter = starter; self.vmSize = vmSize; self.image = image
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, description, icon, color, repos, setupScript, instructions, starter, vmSize, image, createdAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        description = c.value(.description, default: "")
        icon = c.value(.icon, default: "code")
        color = c.value(.color, default: "emerald")
        repos = c.value(.repos, default: [])
        setupScript = c.value(.setupScript, default: "")
        instructions = c.value(.instructions, default: "")
        starter = c.value(.starter, default: "")
        vmSize = c.value(.vmSize, default: nil)
        image = c.value(.image, default: nil)
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }
}

public struct AgentProfile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var icon: String
    public var color: String
    public var instructions: String
    public var starter: String
    public var model: String
    public var thinking: ThinkingLevel
    public var mcpServers: [String]
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, name: String, description: String = "", icon: String = "bot", color: String = "emerald", instructions: String = "", starter: String = "", model: String = "", thinking: ThinkingLevel = "low", mcpServers: [String] = [], createdAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.name = name; self.description = description; self.icon = icon; self.color = color; self.instructions = instructions
        self.starter = starter; self.model = model; self.thinking = thinking; self.mcpServers = mcpServers; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, description, icon, color, instructions, starter, model, thinking, mcpServers, createdAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        description = c.value(.description, default: "")
        icon = c.value(.icon, default: "bot")
        color = c.value(.color, default: "emerald")
        instructions = c.value(.instructions, default: "")
        starter = c.value(.starter, default: "")
        model = c.value(.model, default: "")
        thinking = c.value(.thinking, default: "low")
        mcpServers = c.value(.mcpServers, default: [])
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }
}

/// A sidekick (`character` in code and on the wire): a named companion with one long conversation of their own, pinned
/// above the chats. Their conversation is an ordinary chat (`SessionMeta.characterId`); `sessionId` is the current one
/// (Start over replaces it).
public struct CharacterProfile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// One line under the name in the chat list.
    public var tagline: String
    /// Who they are: personality, voice, backstory ("character profile").
    public var persona: String
    /// What they do for you, and their rules ("prompt").
    public var instructions: String
    /// Their first words, shown at the top of the conversation.
    public var greeting: String
    /// An emoji, from before sidekicks had looks; empty shows the name's initial.
    public var avatar: String
    /// Their little character, drawn from parts ({ body, skin, eyes, mouth, extra, blush }). The web draws it; the
    /// app shows `image`, the PNG saved with it. Missing on ones saved before looks.
    public var look: JSONValue?
    /// A picture as a data: URL: the PNG of their look, or a photo. Shown instead of the emoji.
    public var image: String?
    public var color: String
    public var model: String
    public var thinking: ThinkingLevel
    public var mcpServers: [String]
    /// Which of their messages notify you: "all", "reachouts" (only ones they start themselves, like check-ins), or
    /// "off" (`SidekickNotify`). Missing from older agents: all.
    public var notify: String
    public var sessionId: String
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, name: String, tagline: String = "", persona: String = "", instructions: String = "", greeting: String = "", avatar: String = "",
                look: JSONValue? = nil, image: String? = nil, color: String = "violet", model: String = "", thinking: ThinkingLevel = "low", mcpServers: [String] = [],
                notify: String = "all", sessionId: String, createdAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.name = name; self.tagline = tagline; self.persona = persona; self.instructions = instructions; self.greeting = greeting
        self.avatar = avatar; self.look = look; self.image = image; self.color = color; self.model = model; self.thinking = thinking; self.mcpServers = mcpServers
        self.notify = notify; self.sessionId = sessionId; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, tagline, persona, instructions, greeting, avatar, look, image, color, model, thinking, mcpServers, notify, sessionId, createdAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        tagline = c.value(.tagline, default: "")
        persona = c.value(.persona, default: "")
        instructions = c.value(.instructions, default: "")
        greeting = c.value(.greeting, default: "")
        avatar = c.value(.avatar, default: "")
        // Only an object is a look (null, or anything else, is none).
        look = c.value(.look, default: JSONValue?.none).flatMap { if case .object = $0 { $0 } else { nil } }
        image = c.value(.image, default: nil)
        color = c.value(.color, default: "violet")
        model = c.value(.model, default: "")
        thinking = c.value(.thinking, default: "low")
        mcpServers = c.value(.mcpServers, default: [])
        notify = c.value(.notify, default: "all")
        sessionId = c.value(.sessionId, default: "")
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }

    /// Their notification setting; an unknown one reads as every message, as the agent treats it.
    public var notifyLevel: SidekickNotify { SidekickNotify(rawValue: notify) ?? .all }

    /// What the avatar shows without a picture: the emoji, else the name's first letter.
    public var glyph: String {
        if !avatar.isEmpty { return avatar }
        return name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
    }
}

public struct McpToolInfo: Codable, Sendable, Hashable {
    public var name: String
    public var description: String
    public init(name: String, description: String) { self.name = name; self.description = description }
}

public struct McpLocal: Codable, Sendable, Hashable {
    public var command: String
    public var envNames: [String]
    public init(command: String, envNames: [String] = []) { self.command = command; self.envNames = envNames }
}

public struct McpServerInfo: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var url: String
    /// auto, streamable-http, sse
    public var transport: String
    /// none, headers, oauth
    public var auth: String
    public var headerNames: [String]
    public var local: McpLocal?
    public var defaultOn: Bool
    public var prefix: String
    /// connecting, authenticating, connected, discovering, ready, failed, disconnected
    public var status: String
    public var error: String?
    public var tools: [McpToolInfo]
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, name: String, url: String, transport: String = "auto", auth: String = "none", headerNames: [String] = [], local: McpLocal? = nil, defaultOn: Bool = false, prefix: String = "", status: String = "ready", error: String? = nil, tools: [McpToolInfo] = [], createdAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.name = name; self.url = url; self.transport = transport; self.auth = auth; self.headerNames = headerNames; self.local = local
        self.defaultOn = defaultOn; self.prefix = prefix; self.status = status; self.error = error; self.tools = tools; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, url, transport, auth, headerNames, local, defaultOn, prefix, status, error, tools, createdAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        url = c.value(.url, default: "")
        transport = c.value(.transport, default: "auto")
        auth = c.value(.auth, default: "none")
        headerNames = c.value(.headerNames, default: [])
        local = c.value(.local, default: nil)
        defaultOn = c.value(.defaultOn, default: false)
        prefix = c.value(.prefix, default: "")
        status = c.value(.status, default: "disconnected")
        error = c.value(.error, default: nil)
        tools = c.value(.tools, default: [])
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }

    public var statusLabel: String {
        switch status {
        case "connecting", "connected": "Connecting"
        case "authenticating": "Needs sign-in"
        case "discovering": "Loading tools"
        case "ready": "Ready"
        case "failed": "Failed"
        default: "Not connected"
        }
    }
}

public struct AccessToken: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var label: String
    /// read, write, admin
    public var scope: String
    public var createdAt: Double
    public var lastUsedAt: Double?
    public var expiresAt: Double?
    public init(id: String, label: String, scope: String, createdAt: Double, lastUsedAt: Double? = nil, expiresAt: Double? = nil) {
        self.id = id; self.label = label; self.scope = scope; self.createdAt = createdAt; self.lastUsedAt = lastUsedAt; self.expiresAt = expiresAt
    }
}

public struct AuditEntry: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var at: Double
    /// chat, mcp, user, ui
    public var actor: String
    public var actorLabel: String
    public var operation: String
    public var summary: String
    public var ok: Bool
    public var error: String?
    public init(id: Int, at: Double, actor: String, actorLabel: String, operation: String, summary: String, ok: Bool, error: String? = nil) {
        self.id = id; self.at = at; self.actor = actor; self.actorLabel = actorLabel; self.operation = operation; self.summary = summary; self.ok = ok; self.error = error
    }
}

public struct PendingAction: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var sessionId: String
    public var operation: String
    public var summary: String
    public var createdAt: Double
    /// pending, approved, declined, expired, failed
    public var status: String
    public var result: String?
    public init(id: String, sessionId: String, operation: String, summary: String, createdAt: Double, status: String, result: String? = nil) {
        self.id = id; self.sessionId = sessionId; self.operation = operation; self.summary = summary; self.createdAt = createdAt; self.status = status; self.result = result
    }
}

public struct AccessState: Codable, Sendable, Hashable {
    public var tokens: [AccessToken]
    public var audit: [AuditEntry]
    public var pending: [PendingAction]
    public init(tokens: [AccessToken] = [], audit: [AuditEntry] = [], pending: [PendingAction] = []) { self.tokens = tokens; self.audit = audit; self.pending = pending }
    enum CodingKeys: String, CodingKey { case tokens, audit, pending }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tokens = c.value(.tokens, default: []); audit = c.value(.audit, default: []); pending = c.value(.pending, default: [])
    }
}

public enum AccessRisks {
    public static let all: [(id: String, label: String, description: String)] = [
        ("read", "Read", "See chats, agents, projects, machines, usage, and settings."),
        ("write", "Read & write", "Also start and message chats, create agents and projects, run commands on VMs."),
        ("admin", "Full", "Also delete things and change settings, existing agents and projects, and MCP servers.")
    ]
}

public struct SkillInfo: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var description: String
    public var source: String?
    public var path: String?
    public var auto: Bool
    public var files: Int
    public var size: Int
    public var installedAt: Double
    public var updatedAt: Double
    public init(id: String, description: String, source: String? = nil, path: String? = nil, auto: Bool = true, files: Int = 0, size: Int = 0, installedAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.description = description; self.source = source; self.path = path; self.auto = auto; self.files = files; self.size = size
        self.installedAt = installedAt; self.updatedAt = updatedAt
    }
    enum CodingKeys: String, CodingKey { case id, description, source, path, auto, files, size, installedAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        description = c.value(.description, default: "")
        source = c.value(.source, default: nil)
        path = c.value(.path, default: nil)
        auto = c.value(.auto, default: true)
        files = c.value(.files, default: 0)
        size = c.value(.size, default: 0)
        installedAt = c.value(.installedAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }
}

/// A browser (Web Push) or an installed app (APNs, Firebase) that gets push notifications.
public struct PushDevice: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// "web", "ios", or "android". Missing on devices saved before the apps had push: web.
    public var platform: String
    public var label: String
    public var kinds: [String]
    public var onlyWhenAway: Bool
    public var createdAt: Double
    public var lastSentAt: Double?
    public var error: String?
    public init(id: String, platform: String = "web", label: String, kinds: [String], onlyWhenAway: Bool, createdAt: Double, lastSentAt: Double? = nil, error: String? = nil) {
        self.id = id; self.platform = platform; self.label = label; self.kinds = kinds; self.onlyWhenAway = onlyWhenAway; self.createdAt = createdAt
        self.lastSentAt = lastSentAt; self.error = error
    }

    enum CodingKeys: String, CodingKey { case id, platform, label, kinds, onlyWhenAway, createdAt, lastSentAt, error }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        platform = c.value(.platform, default: "web")
        label = c.value(.label, default: "Device")
        kinds = c.value(.kinds, default: [])
        onlyWhenAway = c.value(.onlyWhenAway, default: true)
        createdAt = c.value(.createdAt, default: 0)
        lastSentAt = c.value(.lastSentAt, default: nil)
        error = c.value(.error, default: nil)
    }
}

/// Which apps this deployment can push to: APNs for iPhone and iPad, Firebase for Android.
public struct NativePush: Codable, Sendable, Hashable {
    public var ios: Bool
    public var android: Bool
    public init(ios: Bool = false, android: Bool = false) { self.ios = ios; self.android = android }

    enum CodingKeys: String, CodingKey { case ios, android }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ios = c.value(.ios, default: false)
        android = c.value(.android, default: false)
    }
}

public struct PushStatus: Codable, Sendable, Hashable {
    /// Whether this deployment has VAPID keys (Web Push, for browsers).
    public var configured: Bool
    public var publicKey: String?
    public var devices: [PushDevice]
    /// Missing from agents before the apps had push: neither.
    public var native: NativePush
    public init(configured: Bool = false, publicKey: String? = nil, devices: [PushDevice] = [], native: NativePush = .init()) {
        self.configured = configured; self.publicKey = publicKey; self.devices = devices; self.native = native
    }

    enum CodingKeys: String, CodingKey { case configured, publicKey, devices, native }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        configured = c.value(.configured, default: false)
        publicKey = c.value(.publicKey, default: nil)
        devices = c.value(.devices, default: [])
        native = c.value(.native, default: .init())
    }
}

public enum NotifyKinds {
    public static let all: [(id: String, label: String, description: String)] = [
        ("sidekick", "Sidekicks", "When a sidekick messages you (each sidekick's own setting decides which messages)."),
        ("reply", "Replies", "When Dex finishes answering in a chat."),
        ("error", "Problems", "When a reply fails."),
        ("scheduled", "Scheduled tasks", "When a scheduled prompt has run."),
        ("machine", "Machines", "When a project chat's VM is ready, or its setup fails."),
        ("mcp", "MCP sign-in", "When an MCP server needs you to sign in again."),
        ("snooze", "Snoozed chats", "When a chat you snoozed comes back.")
    ]
}

public struct SavedSecret: Codable, Sendable, Hashable, Identifiable {
    public var name: String
    public var note: String
    public var updatedAt: Double
    public var id: String { name }
    public init(name: String, note: String, updatedAt: Double) { self.name = name; self.note = note; self.updatedAt = updatedAt }
}

public struct ModelListVersion: Codable, Sendable, Hashable {
    public var version: String
    public var updatedAt: Double
    public init(version: String, updatedAt: Double) { self.version = version; self.updatedAt = updatedAt }
}

/// Synced to every connected client through the Agents SDK state channel. Never holds secrets.
public struct DexState: Codable, Sendable, Hashable {
    public var cline: ClineStatus
    public var opencode: ClineStatus
    /// Sign in with ChatGPT; `keyHint` is the account's email. Missing in state an older agent saved.
    public var chatgpt: ClineStatus
    public var boat: BoatStatus
    public var settings: DexSettings
    public var sessions: [SessionMeta]
    public var vms: [VmInfo]
    public var vmConfigured: Bool
    public var projects: [ProjectProfile]
    public var github: GitHubStatus
    public var push: PushStatus
    public var agents: [AgentProfile]
    /// Characters, pinned above the chats. Missing in state an older agent saved.
    public var characters: [CharacterProfile]
    public var mcp: [McpServerInfo]
    public var access: AccessState
    public var secrets: [SavedSecret]
    public var skills: [SkillInfo]
    public var build: String?
    public var models: ModelListVersion?

    public init(cline: ClineStatus = .init(), opencode: ClineStatus = .init(), chatgpt: ClineStatus = .init(), boat: BoatStatus = .init(), settings: DexSettings = .init(),
                sessions: [SessionMeta] = [], vms: [VmInfo] = [], vmConfigured: Bool = false, projects: [ProjectProfile] = [],
                github: GitHubStatus = .init(), push: PushStatus = .init(), agents: [AgentProfile] = [], characters: [CharacterProfile] = [], mcp: [McpServerInfo] = [],
                access: AccessState = .init(), secrets: [SavedSecret] = [], skills: [SkillInfo] = [], build: String? = nil, models: ModelListVersion? = nil) {
        self.cline = cline; self.opencode = opencode; self.chatgpt = chatgpt; self.boat = boat; self.settings = settings; self.sessions = sessions; self.vms = vms
        self.vmConfigured = vmConfigured; self.projects = projects; self.github = github; self.push = push; self.agents = agents; self.characters = characters; self.mcp = mcp
        self.access = access; self.secrets = secrets; self.skills = skills; self.build = build; self.models = models
    }

    enum CodingKeys: String, CodingKey { case cline, opencode, chatgpt, boat, settings, sessions, vms, vmConfigured, projects, github, push, agents, characters, mcp, access, secrets, skills, build, models }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cline = c.value(.cline, default: .init())
        opencode = c.value(.opencode, default: .init())
        chatgpt = c.value(.chatgpt, default: .init())
        boat = c.value(.boat, default: .init())
        settings = c.value(.settings, default: .init())
        sessions = c.value(.sessions, default: [])
        vms = c.value(.vms, default: [])
        vmConfigured = c.value(.vmConfigured, default: false)
        projects = c.value(.projects, default: [])
        github = c.value(.github, default: .init())
        push = c.value(.push, default: .init())
        agents = c.value(.agents, default: [])
        characters = c.value(.characters, default: [])
        mcp = c.value(.mcp, default: [])
        access = c.value(.access, default: .init())
        secrets = c.value(.secrets, default: [])
        skills = c.value(.skills, default: [])
        build = c.value(.build, default: nil)
        models = c.value(.models, default: nil)
    }

    /// Which model subscriptions this user can run on.
    public var connectedProviders: [String: Bool] { ["clinepass": cline.connected, "opencode-go": opencode.connected, "chatgpt": chatgpt.connected] }

    /// Whether any model subscription is connected (nothing can answer otherwise).
    public var anyProviderConnected: Bool { cline.connected || opencode.connected || chatgpt.connected }

    public func session(_ id: String) -> SessionMeta? { sessions.first { $0.id == id } }
    public func vm(_ key: String) -> VmInfo? { vms.first { $0.key == key } }
    public func agent(_ id: String?) -> AgentProfile? { id.flatMap { id in agents.first { $0.id == id } } }
    public func project(_ id: String?) -> ProjectProfile? { id.flatMap { id in projects.first { $0.id == id } } }
    public func character(_ id: String?) -> CharacterProfile? { id.flatMap { id in characters.first { $0.id == id } } }

    /// Ordinary chats: everything but characters' conversations, which live under them.
    public var chats: [SessionMeta] { sessions.filter { $0.characterId == nil } }

    /// Chats (sidekicks' conversations too) with a reply you haven't seen: the app icon's badge, as the agent counts it.
    public var unreadCount: Int { sessions.filter(\.unread).count }

    /// A character's conversations, the newest first (the current one, and any from before Start over).
    public func conversations(of characterId: String) -> [SessionMeta] {
        sessions.filter { $0.characterId == characterId }.sorted { $0.createdAt > $1.createdAt }
    }
}
