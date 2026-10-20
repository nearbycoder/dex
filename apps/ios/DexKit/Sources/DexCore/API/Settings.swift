import Foundation

// Requests and answers for Settings, Secrets, Access & API, and Notifications (the callables in
// apps/web/src/agent/dex-agent.ts). The synced records themselves live in Protocol/DexState.swift.

/// What `connectCline`, `connectOpenCode`, `connectBoat`, `disconnectBoat`, and `connectGitHub` answer:
/// `{ ok: true, note?, login? }` or `{ ok: false, error }`.
public struct ConnectResult: Codable, Sendable, Hashable {
    public var ok: Bool
    /// A remark from the provider on success (e.g. about the plan).
    public var note: String?
    /// GitHub's login, from `connectGitHub`.
    public var login: String?
    public var error: String?

    public init(ok: Bool, note: String? = nil, login: String? = nil, error: String? = nil) {
        self.ok = ok; self.note = note; self.login = login; self.error = error
    }

    /// Decodes `null` or an empty answer (older agents' disconnects) as success.
    public static func from(_ value: JSONValue) -> ConnectResult {
        guard value.object != nil else { return ConnectResult(ok: true) }
        return (try? value.decode(ConnectResult.self)) ?? ConnectResult(ok: true)
    }
}

/// `createAccessToken` → the token's record and its secret, which is shown once and never again.
public struct CreatedAccessToken: Codable, Sendable, Hashable {
    public var token: AccessToken
    public var secret: String
    public init(token: AccessToken, secret: String) { self.token = token; self.secret = secret }
}

public extension AccessToken {
    func isExpired(now: Double = .nowMs) -> Bool { expiresAt.map { $0 < now } ?? false }
    var scopeLabel: String { AccessRisks.all.first { $0.id == scope }?.label ?? scope.capitalized }
}

/// Token lifetimes the Access page offers (`nil`: never expires).
public enum AccessExpiry {
    public static let all: [(days: Int?, label: String)] = [(30, "30 days"), (90, "90 days"), (365, "1 year"), (nil, "Never")]
}

/// Setting up an MCP client with a Dex token.
public enum McpSetup {
    /// `<server>/api/mcp`, the Streamable HTTP endpoint.
    public static func endpoint(server: URL) -> String {
        var base = server.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return base + "/api/mcp"
    }

    public static func claudeCommand(endpoint: String, token: String) -> String {
        "claude mcp add --transport http dex \(endpoint) --header \"Authorization: Bearer \(token)\""
    }

    public static func jsonConfig(endpoint: String, token: String) -> String {
        let value: JSONValue = ["mcpServers": ["dex": ["type": "http", "url": .string(endpoint), "headers": ["Authorization": .string("Bearer \(token)")]]]]
        return value.prettyText
    }
}

public extension PendingAction {
    /// Still waiting for an answer: pending and under an hour old (the agent expires older ones).
    func isWaiting(now: Double = .nowMs) -> Bool { status == "pending" && now - createdAt < 3_600_000 }
}

/// A prompt Dex will run later (`listScheduledPrompts`).
public struct ScheduledPrompt: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var prompt: String
    public var sessionId: String?
    /// ISO 8601: the next run.
    public var when: String
    /// Set for a repeating one.
    public var cron: String?

    public init(id: String, prompt: String, sessionId: String? = nil, when: String, cron: String? = nil) {
        self.id = id; self.prompt = prompt; self.sessionId = sessionId; self.when = when; self.cron = cron
    }

    /// The next run as a date (ISO 8601, with or without fractional seconds).
    public var date: Date? { ISODates.parse(when) }
}

enum ISODates {
    static func parse(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }
}

/// Account secrets' names: environment variables on every VM (apps/web/src/agent/secrets.ts).
public enum SecretName {
    public static let maxLength = 64
    private static let reserved: Set<String> = ["PATH", "HOME", "USER", "SHELL", "PWD", "LANG", "TERM", "DISPLAY", "HOSTNAME"]

    /// What the name field keeps while typing: capitals, digits, and underscores (anything else becomes `_`), as the web does.
    public static func sanitize(_ text: String) -> String {
        String(text.uppercased().map { $0.isASCII && ($0.isUppercase || $0.isNumber || $0 == "_") ? $0 : "_" }.prefix(maxLength))
    }

    /// Why a name can't be saved, or nil when it can.
    public static func problem(_ name: String) -> String? {
        let key = name.trimmingCharacters(in: .whitespaces).uppercased()
        if key.isEmpty { return "Enter a name." }
        guard key.count <= maxLength, let first = key.first, first == "_" || (first.isASCII && first.isUppercase),
              key.allSatisfy({ $0.isASCII && ($0.isUppercase || $0.isNumber || $0 == "_") }) else {
            return "Use an environment variable name: capital letters, digits, and underscores (e.g. MY_API_KEY)."
        }
        if reserved.contains(key) || key.hasPrefix("DEX_SECRET_") { return "\(key) is reserved on VMs; pick another name." }
        return nil
    }

    public static func isValid(_ name: String) -> Bool { problem(name) == nil }
}

/// A notification kind's settings (`pushUpdate`'s patch).
public struct PushDevicePatch: Codable, Sendable, Hashable {
    public var kinds: [String]?
    public var onlyWhenAway: Bool?
    public init(kinds: [String]? = nil, onlyWhenAway: Bool? = nil) { self.kinds = kinds; self.onlyWhenAway = onlyWhenAway }
}

public extension PushDevice {
    /// The device's kinds with `kind` turned on or off, in NOTIFY_KINDS order.
    func kinds(setting kind: String, on: Bool) -> [String] {
        let next = on ? Set(kinds).union([kind]) : Set(kinds).subtracting([kind])
        return NotifyKinds.all.map(\.id).filter(next.contains)
    }
}

public extension NotifyKinds {
    static let defaults: [String] = all.map(\.id)
}
