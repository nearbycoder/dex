import Foundation

// Requests and answers for Library: agents, projects (and their GitHub repos), skills, and MCP servers. Mirrors
// apps/web/src/shared/{agents,projects,skills,mcp,mcp-registry,mcp-templates}.ts.

// MARK: - Agents

/// What `saveAgent` takes: a new agent (no id) or an edit.
public struct AgentDraft: Codable, Sendable, Hashable {
    public var id: String?
    public var name: String
    public var description: String
    public var icon: String
    public var color: String
    public var instructions: String
    public var starter: String
    public var model: String
    public var thinking: ThinkingLevel
    public var mcpServers: [String]

    public init(id: String? = nil, name: String = "", description: String = "", icon: String = "bot", color: String = "emerald", instructions: String = "",
                starter: String = "", model: String, thinking: ThinkingLevel, mcpServers: [String] = []) {
        self.id = id; self.name = name; self.description = description; self.icon = icon; self.color = color; self.instructions = instructions
        self.starter = starter; self.model = model; self.thinking = thinking; self.mcpServers = mcpServers
    }

    public init(_ agent: AgentProfile) {
        self.init(id: agent.id, name: agent.name, description: agent.description, icon: agent.icon, color: agent.color, instructions: agent.instructions,
                  starter: agent.starter, model: agent.model, thinking: agent.thinking, mcpServers: agent.mcpServers)
    }

    /// The agent's name is required (the server trims it).
    public var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

// MARK: - Projects

/// What `saveProject` takes. `image` is always sent: null removes the picture (left out, the server keeps it).
public struct ProjectDraft: Codable, Sendable, Hashable {
    public var id: String?
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

    public init(id: String? = nil, name: String = "", description: String = "", icon: String = "briefcase", color: String = "sky", repos: [ProjectRepo] = [],
                setupScript: String = "", instructions: String = "", starter: String = "", vmSize: String? = nil, image: String? = nil) {
        self.id = id; self.name = name; self.description = description; self.icon = icon; self.color = color; self.repos = repos
        self.setupScript = setupScript; self.instructions = instructions; self.starter = starter; self.vmSize = vmSize; self.image = image
    }

    public init(_ project: ProjectProfile) {
        self.init(id: project.id, name: project.name, description: project.description, icon: project.icon, color: project.color, repos: project.repos,
                  setupScript: project.setupScript, instructions: project.instructions, starter: project.starter, vmSize: project.vmSize, image: project.image)
    }

    public var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    enum CodingKeys: String, CodingKey { case id, name, description, icon, color, repos, setupScript, instructions, starter, vmSize, image }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(name, forKey: .name); try c.encode(description, forKey: .description); try c.encode(icon, forKey: .icon)
        try c.encode(color, forKey: .color); try c.encode(repos, forKey: .repos); try c.encode(setupScript, forKey: .setupScript)
        try c.encode(instructions, forKey: .instructions); try c.encode(starter, forKey: .starter)
        if let vmSize { try c.encode(vmSize, forKey: .vmSize) } else { try c.encodeNil(forKey: .vmSize) }
        if let image { try c.encode(image, forKey: .image) } else { try c.encodeNil(forKey: .image) }
    }
}

/// A GitHub repo for the project editor's picker. `accessible`: the user's connection can clone it (private ones included).
public struct GitHubRepo: Codable, Sendable, Hashable, Identifiable {
    public var fullName: String
    public var isPrivate: Bool
    public var description: String
    public var defaultBranch: String
    public var pushedAt: String?
    public var fork: Bool
    public var archived: Bool
    public var owner: String
    public var ownerAvatar: String
    public var accessible: Bool
    public var language: String?
    public var stars: Int

    public var id: String { fullName }
    public var name: String { fullName.split(separator: "/").last.map(String.init) ?? fullName }
    /// When it was last pushed to, in milliseconds since 1970.
    public var pushedAtMs: Double? {
        guard let pushedAt else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: pushedAt) ?? ISO8601DateFormatter().date(from: pushedAt)
        return date.map { $0.timeIntervalSince1970 * 1000 }
    }

    public init(fullName: String, isPrivate: Bool = false, description: String = "", defaultBranch: String = "main", pushedAt: String? = nil, fork: Bool = false,
                archived: Bool = false, owner: String? = nil, ownerAvatar: String = "", accessible: Bool = true, language: String? = nil, stars: Int = 0) {
        self.fullName = fullName; self.isPrivate = isPrivate; self.description = description; self.defaultBranch = defaultBranch; self.pushedAt = pushedAt
        self.fork = fork; self.archived = archived; self.owner = owner ?? String(fullName.split(separator: "/").first ?? ""); self.ownerAvatar = ownerAvatar
        self.accessible = accessible; self.language = language; self.stars = stars
    }

    enum CodingKeys: String, CodingKey {
        case fullName, isPrivate = "private", description, defaultBranch, pushedAt, fork, archived, owner, ownerAvatar, accessible, language, stars
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fullName = try c.decode(String.self, forKey: .fullName)
        isPrivate = c.value(.isPrivate, default: false)
        description = c.value(.description, default: "")
        defaultBranch = c.value(.defaultBranch, default: "main")
        pushedAt = c.value(.pushedAt, default: nil)
        fork = c.value(.fork, default: false)
        archived = c.value(.archived, default: false)
        owner = c.value(.owner, default: String(fullName.split(separator: "/").first ?? ""))
        ownerAvatar = c.value(.ownerAvatar, default: "")
        accessible = c.value(.accessible, default: false)
        language = c.value(.language, default: nil)
        stars = c.value(.stars, default: 0)
    }
}

/// Who's connected to GitHub, the orgs Dex can see, and where to grant it more.
public struct GitHubAccess: Codable, Sendable, Hashable {
    public struct Org: Codable, Sendable, Hashable {
        public var login: String
        public var avatarUrl: String
        public init(login: String, avatarUrl: String) { self.login = login; self.avatarUrl = avatarUrl }
    }

    public var connected: Bool
    public var login: String?
    /// oauth or token
    public var via: String?
    public var orgs: [Org]
    public var manageUrl: String?

    public init(connected: Bool, login: String? = nil, via: String? = nil, orgs: [Org] = [], manageUrl: String? = nil) {
        self.connected = connected; self.login = login; self.via = via; self.orgs = orgs; self.manageUrl = manageUrl
    }

    enum CodingKeys: String, CodingKey { case connected, login, via, orgs, manageUrl }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        connected = c.value(.connected, default: false)
        login = c.value(.login, default: nil)
        via = c.value(.via, default: nil)
        orgs = c.value(.orgs, default: [])
        manageUrl = c.value(.manageUrl, default: nil)
    }
}

/// A picture a project can show: from one of its repo's files (`path`), or the owner's avatar (`path` is "avatar").
public struct ProjectImageCandidate: Codable, Sendable, Hashable, Identifiable {
    public var path: String
    public var dataUrl: String
    public var id: String { path }
    public var isAvatar: Bool { path == "avatar" }
    public init(path: String, dataUrl: String) { self.path = path; self.dataUrl = dataUrl }
}

/// Repo URLs as the server reads them (shared/projects.ts).
public enum Repos {
    private static let part = "[A-Za-z0-9_.-]"

    /// `owner/repo`, `github.com/owner/repo`, or a full https URL, as a clone URL; nil if it isn't a repo.
    public static func normalize(_ input: String) -> String? {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        if !value.contains(":"), let match = value.wholeMatch(of: try! Regex("(?:github\\.com/)?(\(part)+)/(\(part)+?)(?:\\.git)?")) {
            let owner = match.output[1].substring.map(String.init) ?? ""
            let name = match.output[2].substring.map(String.init) ?? ""
            return "https://github.com/\(owner)/\(name).git"
        }
        guard let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil, url.host() != nil,
              url.path().split(separator: "/").count >= 2 else { return nil }
        return url.absoluteString
    }

    /// The `owner/repo` of a GitHub clone URL; nil for other hosts.
    public static func githubFullName(_ url: String) -> String? {
        guard let match = url.wholeMatch(of: try! Regex("https://github\\.com/(\(part)+/\(part)+?)(?:\\.git)?/?")) else { return nil }
        return match.output[1].substring.map(String.init)
    }

    /// The GitHub `owner/repo` behind anything the editor accepts (`owner/repo` or a URL).
    public static func githubRepo(_ input: String) -> String? { normalize(input).flatMap(githubFullName) }

    /// A repo's default folder: the last path segment without `.git`.
    public static func dirName(_ url: String) -> String {
        let last = url.split(separator: "/").last.map(String.init) ?? "repo"
        let trimmed = last.hasSuffix(".git") ? String(last.dropLast(4)) : last
        let cleaned = trimmed.replacing(try! Regex("[^A-Za-z0-9_.-]"), with: "-")
        return cleaned.isEmpty ? "repo" : cleaned
    }

    /// A short label: `owner/repo` for GitHub, else the URL without `https://` and `.git`.
    public static func label(_ url: String) -> String {
        if let match = url.firstMatch(of: try! Regex("github\\.com/(\(part)+/\(part)+?)(?:\\.git)?$")), let name = match.output[1].substring {
            return String(name)
        }
        var label = url
        if label.hasPrefix("https://") { label.removeFirst(8) }
        if label.hasSuffix(".git") { label.removeLast(4) }
        return label
    }

    /// Whether the label is a GitHub `owner/repo`.
    public static func isGitHub(_ url: String) -> Bool {
        label(url).wholeMatch(of: try! Regex("\(part)+/\(part)+")) != nil
    }
}

// MARK: - Skills

/// A skill with its instructions, for viewing or editing.
public struct SkillDetail: Codable, Sendable, Hashable, Identifiable {
    public struct FileEntry: Codable, Sendable, Hashable {
        public var path: String
        public var size: Int
        public init(path: String, size: Int) { self.path = path; self.size = size }
    }

    public var id: String
    public var description: String
    public var source: String?
    public var path: String?
    public var auto: Bool
    public var files: Int
    public var size: Int
    public var installedAt: Double
    public var updatedAt: Double
    public var instructions: String
    public var fileList: [FileEntry]

    public init(id: String, description: String, source: String? = nil, path: String? = nil, auto: Bool = true, files: Int = 0, size: Int = 0,
                installedAt: Double = 0, updatedAt: Double = 0, instructions: String = "", fileList: [FileEntry] = []) {
        self.id = id; self.description = description; self.source = source; self.path = path; self.auto = auto; self.files = files; self.size = size
        self.installedAt = installedAt; self.updatedAt = updatedAt; self.instructions = instructions; self.fileList = fileList
    }

    enum CodingKeys: String, CodingKey { case id, description, source, path, auto, files, size, installedAt, updatedAt, instructions, fileList }
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
        instructions = c.value(.instructions, default: "")
        fileList = c.value(.fileList, default: [])
    }

    public var info: SkillInfo {
        SkillInfo(id: id, description: description, source: source, path: path, auto: auto, files: files, size: size, installedAt: installedAt, updatedAt: updatedAt)
    }

    /// Where it came from on GitHub.
    public var sourceURL: URL? {
        guard let source else { return nil }
        return URL(string: "https://github.com/\(source)\(path.map { "/tree/HEAD/\($0)" } ?? "")")
    }
}

/// A search result from skills.sh.
public struct DirectorySkill: Codable, Sendable, Hashable, Identifiable {
    /// `owner/repo/skill`.
    public var id: String
    public var source: String
    public var skillId: String
    public var name: String
    public var installs: Int
    public init(id: String? = nil, source: String, skillId: String, name: String? = nil, installs: Int = 0) {
        self.id = id ?? "\(source)/\(skillId)"; self.source = source; self.skillId = skillId; self.name = name ?? skillId; self.installs = installs
    }
}

/// What installing a skill would add, read from its repo first.
public struct SkillPreview: Codable, Sendable, Hashable {
    public var name: String
    public var description: String
    public var instructions: String
    public var source: String
    public var path: String
    public var url: String
    public var files: [SkillDetail.FileEntry]
    public var size: Int
    public init(name: String, description: String, instructions: String, source: String, path: String, url: String, files: [SkillDetail.FileEntry], size: Int) {
        self.name = name; self.description = description; self.instructions = instructions; self.source = source; self.path = path; self.url = url
        self.files = files; self.size = size
    }
}

/// What `saveSkill` takes: a new skill (no id) or an edit (renaming it with `name`).
public struct SkillInput: Codable, Sendable, Hashable {
    public var id: String?
    public var name: String
    public var description: String
    public var instructions: String
    public var auto: Bool?
    public init(id: String? = nil, name: String, description: String, instructions: String, auto: Bool? = nil) {
        self.id = id; self.name = name; self.description = description; self.instructions = instructions; self.auto = auto
    }
}

public enum Skills {
    /// What a name becomes: lowercase letters, digits, and dashes (shared/skills.ts `skillSlug`).
    public static func slug(_ value: String) -> String {
        let dashed = value.lowercased().replacing(try! Regex("[^a-z0-9]+"), with: "-")
        let trimmed = dashed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String(trimmed.prefix(64))
    }

    public static func isValidName(_ name: String) -> Bool {
        name.wholeMatch(of: try! Regex("[a-z0-9][a-z0-9-]{0,63}")) != nil
    }

    /// "1.2M", "34K", "4.5K", "980".
    public static func formatInstalls(_ count: Int) -> String {
        let value = Double(count)
        if count >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
        if count >= 1_000 { return String(format: count >= 10_000 ? "%.0fK" : "%.1fK", value / 1_000) }
        return String(count)
    }

    /// The installed skill a skills.sh result is (`owner/repo/skill`), matched by source and folder.
    public static func installedKeys(_ skills: [SkillInfo]) -> Set<String> {
        Set(skills.map { "\($0.source ?? "null")/\($0.path?.split(separator: "/").last.map(String.init) ?? $0.id)" })
    }
}

// MARK: - MCP servers

public struct NameValue: Codable, Sendable, Hashable {
    public var name: String
    public var value: String
    public init(name: String, value: String) { self.name = name; self.value = value }
}

/// What `saveMcpServer` takes. For header auth and local env, an empty value keeps the saved one.
public struct McpServerDraft: Codable, Sendable, Hashable {
    public struct Local: Codable, Sendable, Hashable {
        public var command: String
        public var env: [NameValue]
        public init(command: String, env: [NameValue] = []) { self.command = command; self.env = env }
    }

    public var id: String?
    public var name: String
    public var url: String
    public var transport: String
    public var auth: String
    public var headers: [NameValue]
    public var local: Local?
    public var defaultOn: Bool

    public init(id: String? = nil, name: String, url: String = "", transport: String = "auto", auth: String = "none", headers: [NameValue] = [],
                local: Local? = nil, defaultOn: Bool = false) {
        self.id = id; self.name = name; self.url = url; self.transport = transport; self.auth = auth; self.headers = headers; self.local = local
        self.defaultOn = defaultOn
    }
}

/// `saveMcpServer` / `connectMcpServer`'s answer. `authUrl`: send the user there to sign in.
public struct McpConnectResult: Codable, Sendable, Hashable {
    public var ok: Bool
    public var id: String?
    public var authUrl: String?
    public var error: String?
    public init(ok: Bool, id: String? = nil, authUrl: String? = nil, error: String? = nil) { self.ok = ok; self.id = id; self.authUrl = authUrl; self.error = error }
}

public struct RegistryHeader: Codable, Sendable, Hashable {
    public var name: String
    public var description: String
    public var required: Bool
    public var secret: Bool
    /// A template like `Bearer {api_key}`.
    public var value: String?
    public init(name: String, description: String = "", required: Bool = false, secret: Bool = false, value: String? = nil) {
        self.name = name; self.description = description; self.required = required; self.secret = secret; self.value = value
    }
    enum CodingKeys: String, CodingKey { case name, description, required, secret, value }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        description = c.value(.description, default: "")
        required = c.value(.required, default: false)
        secret = c.value(.secret, default: false)
        value = c.value(.value, default: nil)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name); try c.encode(description, forKey: .description); try c.encode(required, forKey: .required)
        try c.encode(secret, forKey: .secret)
        if let value { try c.encode(value, forKey: .value) } else { try c.encodeNil(forKey: .value) }
    }
}

/// A server from Smithery or the official MCP Registry. Sent back as is to `checkMcpServer`, so nulls stay nulls.
public struct RegistryServer: Codable, Sendable, Hashable, Identifiable {
    public struct Run: Codable, Sendable, Hashable {
        public var command: String
        public var env: [RegistryHeader]
        public init(command: String, env: [RegistryHeader] = []) { self.command = command; self.env = env }
    }

    /// smithery or registry
    public var source: String
    public var name: String
    public var title: String
    public var description: String
    public var version: String
    public var repository: String?
    public var url: String
    /// streamable-http, sse, or stdio
    public var transport: String
    public var run: Run?
    public var headers: [RegistryHeader]
    public var templated: Bool
    public var updatedAt: String?
    public var status: String
    public var uses: Int?
    public var verified: Bool?

    public var id: String { "\(source):\(name)" }

    public init(source: String, name: String, title: String? = nil, description: String = "", version: String = "", repository: String? = nil, url: String = "",
                transport: String = "streamable-http", run: Run? = nil, headers: [RegistryHeader] = [], templated: Bool = false, updatedAt: String? = nil,
                status: String = "active", uses: Int? = nil, verified: Bool? = nil) {
        self.source = source; self.name = name; self.title = title ?? McpRegistry.title(name); self.description = description; self.version = version
        self.repository = repository; self.url = url; self.transport = transport; self.run = run; self.headers = headers; self.templated = templated
        self.updatedAt = updatedAt; self.status = status; self.uses = uses; self.verified = verified
    }

    enum CodingKeys: String, CodingKey { case source, name, title, description, version, repository, url, transport, run, headers, templated, updatedAt, status, uses, verified }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = c.value(.source, default: "registry")
        name = try c.decode(String.self, forKey: .name)
        title = c.value(.title, default: McpRegistry.title(name))
        description = c.value(.description, default: "")
        version = c.value(.version, default: "")
        repository = c.value(.repository, default: nil)
        url = c.value(.url, default: "")
        transport = c.value(.transport, default: "streamable-http")
        run = c.value(.run, default: nil)
        headers = c.value(.headers, default: [])
        templated = c.value(.templated, default: false)
        updatedAt = c.value(.updatedAt, default: nil)
        status = c.value(.status, default: "active")
        uses = c.value(.uses, default: nil)
        verified = c.value(.verified, default: nil)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        func optional<T: Encodable>(_ value: T?, _ key: CodingKeys) throws {
            if let value { try c.encode(value, forKey: key) } else { try c.encodeNil(forKey: key) }
        }
        try c.encode(source, forKey: .source); try c.encode(name, forKey: .name); try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description); try c.encode(version, forKey: .version); try optional(repository, .repository)
        try c.encode(url, forKey: .url); try c.encode(transport, forKey: .transport); try optional(run, .run); try c.encode(headers, forKey: .headers)
        try c.encode(templated, forKey: .templated); try optional(updatedAt, .updatedAt); try c.encode(status, forKey: .status)
        try optional(uses, .uses); try optional(verified, .verified)
    }

    /// It needs an API key (a required header, or a secret variable for a package).
    public var needsKey: Bool { headers.contains { $0.required } || (run?.env.contains { $0.required && $0.secret } ?? false) }
}

public struct McpCheck: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var label: String
    /// pass, warn, fail, info
    public var status: String
    public var detail: String
    public init(id: String, label: String, status: String, detail: String) { self.id = id; self.label = label; self.status = status; self.detail = detail }
}

public struct McpCheckReport: Codable, Sendable, Hashable {
    /// The endpoint that was checked (for Smithery, found during the check).
    public var url: String
    public var checks: [McpCheck]
    /// none, headers, or oauth: how to connect it.
    public var auth: String
    public var header: String?
    public var tools: [String]
    public var checkedAt: Double
    public init(url: String, checks: [McpCheck], auth: String, header: String? = nil, tools: [String] = [], checkedAt: Double = 0) {
        self.url = url; self.checks = checks; self.auth = auth; self.header = header; self.tools = tools; self.checkedAt = checkedAt
    }

    public var failed: Bool { checks.contains { $0.status == "fail" } }
}

/// A well-known remote server, for one-tap setup (shared/mcp-templates.ts).
public struct McpTemplate: Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var url: String
    public var auth: String
    public var note: String
    public var header: (name: String, placeholder: String)?

    public static func == (lhs: McpTemplate, rhs: McpTemplate) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }

    public static let all: [McpTemplate] = [
        McpTemplate(id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", auth: "none", note: "Docs and Q&A for public GitHub repos."),
        McpTemplate(id: "cloudflare-docs", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none", note: "Search Cloudflare's documentation."),
        McpTemplate(id: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "headers", note: "Repos, issues, and pull requests.",
                    header: ("Authorization", "Bearer github_pat_…")),
        McpTemplate(id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", note: "Issues and projects."),
        McpTemplate(id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", note: "Pages and databases."),
        McpTemplate(id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth", note: "Errors and performance.")
    ]
}

public enum McpRegistry {
    /// `io.github.owner/my-server` → `My server`.
    public static func title(_ name: String) -> String {
        let last = name.split(separator: "/").last.map(String.init) ?? name
        let words = last.replacing(try! Regex("[-_.]+"), with: " ").trimmingCharacters(in: .whitespaces)
        guard let first = words.first else { return name }
        return first.uppercased() + words.dropFirst()
    }

    /// Who published it, from the namespace the registry verified: a GitHub account or a domain.
    public static func publisher(_ name: String) -> (kind: String, id: String) {
        let namespace = name.split(separator: "/").first.map(String.init) ?? ""
        if namespace.hasPrefix("io.github.") { return ("github", String(namespace.dropFirst("io.github.".count))) }
        let parts = namespace.split(separator: ".")
        if parts.count >= 2 { return ("domain", parts.reversed().joined(separator: ".")) }
        return ("unknown", namespace)
    }

    public static let authLabels: [String: String] = ["none": "No auth", "headers": "API key", "oauth": "OAuth"]
    public static func authLabel(_ auth: String) -> String { authLabels[auth] ?? auth }
}

// MARK: - Calls

/// Library's agent methods, typed.
public extension DexClient {
    func saveAgent(_ draft: AgentDraft) async throws -> AgentProfile { try await call("saveAgent", JSONValue(encoding: draft)) }
    func deleteAgent(_ id: String) async throws { try await run("deleteAgent", .string(id)) }

    func saveProject(_ draft: ProjectDraft) async throws -> ProjectProfile { try await call("saveProject", JSONValue(encoding: draft)) }
    func deleteProject(_ id: String) async throws { try await run("deleteProject", .string(id)) }
    func searchGitHubRepos(_ query: String, owner: String? = nil) async throws -> [GitHubRepo] {
        if let owner { return try await call("searchGitHubRepos", .string(query), .string(owner)) }
        return try await call("searchGitHubRepos", .string(query))
    }
    func listGitHubBranches(_ fullName: String) async throws -> [String] { try await call("listGitHubBranches", .string(fullName)) }
    func githubRepoAccess() async throws -> GitHubAccess { try await call("githubRepoAccess") }
    func projectImageCandidates(_ repo: String) async throws -> [ProjectImageCandidate] { try await call("projectImageCandidates", .string(repo), timeout: 60) }

    func searchSkills(_ query: String) async throws -> [DirectorySkill] { try await call("searchSkills", .string(query)) }
    func previewSkill(source: String, skillId: String) async throws -> SkillPreview { try await call("previewSkill", .string(source), .string(skillId), timeout: 60) }
    func installSkill(source: String, skillId: String, auto: Bool) async throws -> SkillDetail {
        try await call("installSkill", .string(source), .string(skillId), .bool(auto), timeout: 60)
    }
    func getSkill(_ id: String) async throws -> SkillDetail? { try await call("getSkill", .string(id)) }
    func saveSkill(_ input: SkillInput) async throws -> SkillDetail { try await call("saveSkill", JSONValue(encoding: input)) }
    func setSkillAuto(_ id: String, _ auto: Bool) async throws { try await run("setSkillAuto", .string(id), .bool(auto)) }
    func updateSkill(_ id: String) async throws -> SkillDetail { try await call("updateSkill", .string(id), timeout: 60) }
    func removeSkill(_ id: String) async throws { try await run("removeSkill", .string(id)) }

    func saveMcpServer(_ draft: McpServerDraft) async throws -> McpConnectResult { try await call("saveMcpServer", JSONValue(encoding: draft), timeout: 90) }
    func connectMcpServer(_ id: String) async throws -> McpConnectResult { try await call("connectMcpServer", .string(id), timeout: 90) }
    func setMcpServerDefault(_ id: String, _ on: Bool) async throws { try await run("setMcpServerDefault", .string(id), .bool(on)) }
    func deleteMcpServer(_ id: String) async throws { try await run("deleteMcpServer", .string(id)) }
    func searchMcpRegistry(_ query: String, source: String) async throws -> [RegistryServer] {
        try await call("searchMcpRegistry", .string(query), .string(source), timeout: 45)
    }
    func checkMcpServer(_ server: RegistryServer) async throws -> McpCheckReport { try await call("checkMcpServer", JSONValue(encoding: server), timeout: 60) }
}
