import Foundation
import Observation

// The Machines area: what the app shows about a VM, its activity log, peeks, the desktop stream's URL, and the
// agent's VM methods (`vmStart`, `vmRun`, … in apps/web/src/agent/dex-agent.ts).

// MARK: Status

public extension VmInfo {
    /// The web's VM_STATUS labels.
    static func statusLabel(_ status: String) -> String {
        switch status {
        case "none": "No VM yet"
        case "starting": "Starting"
        case "running": "Running"
        case "stopping": "Stopping"
        case "stopped": "Stopped · disk saved"
        case "error": "Error"
        default: status.capitalized
        }
    }

    var statusLabel: String { Self.statusLabel(status) }

    /// Stopped, failed, or never made: Start (or Resume, for a stopped one) brings it up.
    var canStart: Bool { status == "stopped" || status == "error" || status == "none" }
    var canStop: Bool { status == "running" }
    var startLabel: String { status == "stopped" ? "Resume" : "Start" }
    /// The VM is up or on its way: the desktop and the preview have something to show.
    var isLive: Bool { status == "running" || status == "starting" }
    var isSettingUp: Bool { setup.status == "running" }

    /// "Setting up: cloning octocat/dex", or nil when setup isn't running.
    var setupText: String? {
        switch setup.status {
        case "running": "Setting up: \(setup.step ?? "preparing")"
        case "error": "Setup failed" + (setup.step.map { " at “\($0)”" } ?? "")
        default: nil
        }
    }

    /// When a running VM will stop itself: "stops when idle in 3 min" (the web's idleText).
    func idleText(minutes: Int, now: Double = .nowMs) -> String {
        if busy { return "in use" }
        let left = Int((((lastActiveAt ?? now) + Double(minutes) * 60_000 - now) / 60_000).rounded(.up))
        return left > 0 ? "stops when idle in \(left) min" : "idle, stopping any moment now"
    }

    /// The status line under a VM's title: running ones say when they'll stop, others when they were last used.
    func activityText(minutes: Int, now: Double = .nowMs) -> String? {
        if status == "running" { return idleText(minutes: minutes, now: now) }
        return lastActiveAt.map { "used \(Format.ago($0, now: Date(timeIntervalSince1970: now / 1000)))" }
    }

    /// Running VMs first, then the most recently used (the web's byRecentUse).
    static func byRecentUse(_ a: VmInfo, _ b: VmInfo) -> Bool {
        if a.isRunning != b.isRunning { return a.isRunning }
        return (a.lastActiveAt ?? 0) > (b.lastActiveAt ?? 0)
    }
}

/// What a VM is shown as: its chat's title with the chat's agent and project, or what the special VMs are for.
public struct VmLabel: Sendable, Hashable {
    public var title: String
    public var subtitle: String?
    public var agent: AgentProfile?
    public var project: ProjectProfile?
    public var session: SessionMeta?

    /// "Dex · PR Author", the subtitle, or "Chat".
    public var detail: String {
        if let subtitle { return subtitle }
        let parts = [project?.name, agent?.name].compactMap { $0 }
        return parts.isEmpty ? "Chat" : parts.joined(separator: " · ")
    }
}

public extension DexState {
    func vmLabel(_ key: String) -> VmLabel {
        switch key {
        case VmKeys.shared: return VmLabel(title: "Shared VM", subtitle: "Not linked to a chat (from before VMs were per chat)")
        case VmKeys.mcp: return VmLabel(title: "MCP servers", subtitle: "Runs your local MCP servers; starts when a chat uses one")
        default:
            let session = session(key)
            return VmLabel(
                title: session?.title ?? "Deleted chat", subtitle: nil,
                agent: session?.agentId.flatMap { id in agents.first { $0.id == id } },
                project: session?.projectId.flatMap { id in projects.first { $0.id == id } },
                session: session
            )
        }
    }

    /// A chat's VM, or a "No VM yet" placeholder for a chat that hasn't needed one; nil for an unknown key.
    func machine(_ key: String) -> VmInfo? {
        if let vm = vm(key) { return vm }
        return session(key) != nil ? VmInfo(key: key) : nil
    }
}

// MARK: Activity

/// One VM's activity log, kept live from `dex.vm.activity` (new or finished entries) and `dex.vm.output` (output as
/// it streams). The web's useVmActivity.
public struct VmActivityLog: Sendable, Hashable {
    public static let maxOutput = 64_000
    public static let maxItems = 300

    public var items: [VmActivity]
    public init(items: [VmActivity] = []) { self.items = items }

    /// Applies a message about `vmKey`; others are ignored. Returns whether anything changed.
    @discardableResult
    public mutating func apply(_ message: ServerMessage, vmKey: String) -> Bool {
        switch message {
        case .vmActivity(let key, let activity) where key == vmKey:
            if let index = items.firstIndex(where: { $0.id == activity.id }) {
                // A finished entry carries the full (tail of the) output; a running one may lag what streamed.
                var next = activity
                if activity.status == "running", activity.output.count < items[index].output.count { next.output = items[index].output }
                items[index] = next
            } else {
                items.append(activity)
                if items.count > Self.maxItems { items.removeFirst(items.count - Self.maxItems) }
            }
            return true
        case .vmOutput(let key, let id, let data) where key == vmKey:
            guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
            var output = items[index].output + data
            if output.count > Self.maxOutput { output = String(output.suffix(Self.maxOutput)) }
            items[index].output = output
            return true
        default:
            return false
        }
    }

    /// Merges a fetched history with what streamed in meanwhile (newer copies of an entry win).
    public mutating func merge(history: [VmActivity]) {
        var byId = Dictionary(history.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for item in items {
            if let fetched = byId[item.id], fetched.status != "running" || item.status == "running" && item.output.count <= fetched.output.count {
                continue
            }
            byId[item.id] = item
        }
        items = byId.values.sorted { $0.id < $1.id }.suffix(Self.maxItems)
    }
}

public extension VmActivity {
    var actorLabel: String {
        switch actor {
        case "agent": "Dex"
        case "user": "You"
        default: "VM"
        }
    }

    /// Commands and file paths read as code; lifecycle notes and screenshots as prose.
    var isCode: Bool { kind != "lifecycle" && kind != "screenshot" }
    var hasOutput: Bool { !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// "exit 1" or "failed" for a failed entry.
    var failureText: String? {
        guard status == "error" else { return nil }
        return exitCode.map { "exit \($0)" } ?? "failed"
    }
}

/// A VM's activity log on screen: fetched once, then kept live from the agent's broadcasts.
@MainActor
@Observable
public final class MachineFeed {
    public let vmKey: String
    public private(set) var log = VmActivityLog()
    /// Whether the history has arrived (the log shows a skeleton until then).
    public private(set) var loaded = false
    public private(set) var error: String?

    @ObservationIgnored private weak var client: DexClient?
    @ObservationIgnored private var subscriptions: [AgentConnection.Subscription] = []

    public init(vmKey: String, client: DexClient) {
        self.vmKey = vmKey
        self.client = client
    }

    /// For previews and tests.
    public init(vmKey: String, items: [VmActivity]) {
        self.vmKey = vmKey
        self.log = VmActivityLog(items: items)
        self.loaded = true
    }

    public var items: [VmActivity] { log.items }

    /// Starts listening, and fetches the history now and after every reconnect (messages sent while away are lost).
    public func start() {
        guard subscriptions.isEmpty, let connection = client?.connection else { return }
        subscriptions = [
            connection.listen { [weak self] message in
                guard let self else { return }
                self.log.apply(message, vmKey: self.vmKey)
            },
            connection.onConnect { [weak self] in
                Task { await self?.reload() }
            }
        ]
    }

    public func stop() { subscriptions = [] }

    public func reload() async {
        guard let client else { return }
        do {
            let history: [VmActivity] = try await client.call("vmActivity", .string(vmKey), .number(150))
            log.merge(history: history)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    /// Applies a message (tests).
    public func receive(_ message: ServerMessage) { log.apply(message, vmKey: vmKey) }
}

// MARK: Peeks

/// The read-only views of a running VM (apps/web/src/agent/vm-peek.ts).
public enum VmPeekView: String, Sendable, Hashable, CaseIterable, Identifiable, Codable {
    case files, file, ports, processes, git
    public var id: String { rawValue }
}

public struct VmFileEntry: Codable, Sendable, Hashable, Identifiable {
    public var name: String
    /// dir, file, link, other
    public var type: String
    public var size: Int
    public var modifiedAt: Double
    public var id: String { name }
    public var isDirectory: Bool { type == "dir" }
    public init(name: String, type: String, size: Int, modifiedAt: Double) { self.name = name; self.type = type; self.size = size; self.modifiedAt = modifiedAt }

    enum CodingKeys: String, CodingKey { case name, type, size, modifiedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.value(.name, default: "")
        type = c.value(.type, default: "other")
        size = c.value(.size, default: 0)
        modifiedAt = c.value(.modifiedAt, default: 0)
    }
}

public struct VmListeningPort: Codable, Sendable, Hashable, Identifiable {
    public var port: Int
    public var address: String
    public var process: String?
    public var id: String { "\(address)#\(port)" }
    public init(port: Int, address: String, process: String?) { self.port = port; self.address = address; self.process = process }
}

public struct VmProcess: Codable, Sendable, Hashable, Identifiable {
    public var pid: Int
    public var cpu: Double
    public var memory: Double
    public var seconds: Double
    public var command: String
    public var id: Int { pid }
    public init(pid: Int, cpu: Double, memory: Double, seconds: Double, command: String) {
        self.pid = pid; self.cpu = cpu; self.memory = memory; self.seconds = seconds; self.command = command
    }
}

public struct VmGitChange: Codable, Sendable, Hashable, Identifiable {
    public var status: String
    public var path: String
    public var id: String { path }
    public init(status: String, path: String) { self.status = status; self.path = path }

    /// "Modified", "Added", "Untracked", …
    public var label: String {
        switch status.first {
        case "M": "Modified"
        case "A": "Added"
        case "D": "Deleted"
        case "R": "Renamed"
        case "C": "Copied"
        case "U": "Conflict"
        case "?": "Untracked"
        default: status
        }
    }
}

public struct VmCommit: Codable, Sendable, Hashable, Identifiable {
    public var hash: String
    public var author: String
    public var at: Double
    public var subject: String
    public var id: String { hash }
    public init(hash: String, author: String, at: Double, subject: String) { self.hash = hash; self.author = author; self.at = at; self.subject = subject }
}

/// What `vmPeek` returns: `{ running: false, status, view }` when the VM is down, else the view's data.
public struct VmPeekResult: Decodable, Sendable, Hashable {
    public var running: Bool
    public var status: String
    public var view: VmPeekView?
    public var path: String?
    public var entries: [VmFileEntry]
    public var content: String?
    public var ports: [VmListeningPort]
    public var processes: [VmProcess]
    /// git: whether `path` is a repo (else `error` says why).
    public var repo: Bool?
    public var error: String?
    public var branch: String?
    public var tracking: String?
    public var changes: [VmGitChange]
    public var commits: [VmCommit]

    enum CodingKeys: String, CodingKey { case running, status, view, path, entries, content, ports, processes, repo, error, branch, tracking, changes, commits }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        running = c.value(.running, default: false)
        status = c.value(.status, default: running ? "running" : "none")
        view = c.value(.view, default: nil)
        path = c.value(.path, default: nil)
        entries = c.value(.entries, default: [])
        content = c.value(.content, default: nil)
        ports = c.value(.ports, default: [])
        processes = c.value(.processes, default: [])
        repo = c.value(.repo, default: nil)
        error = c.value(.error, default: nil)
        branch = c.value(.branch, default: nil)
        tracking = c.value(.tracking, default: nil)
        changes = c.value(.changes, default: [])
        commits = c.value(.commits, default: [])
    }

    /// Folders first, then by name (the server sorts by name only).
    public var sortedEntries: [VmFileEntry] {
        entries.sorted { a, b in
            if a.isDirectory != b.isDirectory { return a.isDirectory }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

public enum VmPaths {
    /// Where repos are cloned and peeks start.
    public static let work = "~/work"

    /// `parent/child`, without doubling slashes.
    public static func join(_ parent: String, _ child: String) -> String {
        parent.hasSuffix("/") ? parent + child : parent + "/" + child
    }

    /// The folder above `path` ("~" and "/" have none).
    public static func parent(_ path: String) -> String? {
        let trimmed = path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
        guard trimmed != "~", trimmed != "/", let slash = trimmed.lastIndex(of: "/") else { return nil }
        let parent = String(trimmed[..<slash])
        return parent.isEmpty ? "/" : parent
    }
}

// MARK: Desktop

/// How the desktop streams. Selkies (H.264 over a WebSocket, decoded by WebCodecs, relayed by Dex) plays on iPhone and
/// iPad; noVNC runs anywhere; boat's Stream needs Chromium's MediaStreamTrackGenerator, which WebKit lacks.
public enum DesktopMode: String, Sendable, Hashable, CaseIterable, Identifiable {
    case selkies, vnc, stream
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .selkies: "Selkies"
        case .vnc: "noVNC"
        case .stream: "Stream"
        }
    }

    /// Whether WebKit can play it (Stream hangs on "Connecting" there).
    public var playsInWebKit: Bool { self != .stream }

    /// A saved choice, falling back to Selkies.
    public init(saved: String?) {
        self = saved.flatMap(DesktopMode.init(rawValue:)).flatMap { $0.playsInWebKit ? $0 : nil } ?? .selkies
    }
}

public enum DesktopURL {
    /// The page to load for a `vmDesktopUrl` result: Dex's own `/vm-desktop/<key>/` resolved against the server (with
    /// `?view=watch` for a watch-only preview, which hides Selkies' touch controls), or boat's absolute URL as is.
    public static func resolve(_ raw: String, server: URL, watchOnly: Bool = false) -> URL? {
        if raw.hasPrefix("/") {
            guard var components = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
            let parts = raw.split(separator: "?", maxSplits: 1).map(String.init)
            components.percentEncodedPath = parts[0]
            var query = parts.count > 1 ? parts[1] : nil
            if watchOnly, raw.hasPrefix("/vm-desktop/") { query = [query, "view=watch"].compactMap { $0 }.joined(separator: "&") }
            components.percentEncodedQuery = query
            components.fragment = nil
            return components.url
        }
        return URL(string: raw)
    }

    /// Whether the page is served by Dex (and so needs the session cookie).
    public static func isOnServer(_ url: URL, server: URL) -> Bool {
        url.host() == server.host() && url.scheme == server.scheme
    }
}

public enum PortURL {
    /// A port's URL without its access token, for showing.
    public static func display(_ url: String) -> String {
        guard let range = url.range(of: #"[?&]_token=[^&#]*"#, options: .regularExpression) else { return url }
        var shown = url
        shown.removeSubrange(range)
        if shown.hasSuffix("?") || shown.hasSuffix("/?") { shown.removeLast() }
        return shown
    }

    /// Whether a typed port is valid (1–65535).
    public static func parse(_ text: String) -> Int? {
        guard let port = Int(text.trimmingCharacters(in: .whitespaces)), (1...65_535).contains(port) else { return nil }
        return port
    }
}

// MARK: Calls

public struct VmRunResult: Codable, Sendable, Hashable {
    public var exitCode: Int?
    public var output: String
    public init(exitCode: Int?, output: String) { self.exitCode = exitCode; self.output = output }
}

public extension DexClient {
    @discardableResult func vmRefresh(_ key: String) async throws -> VmInfo { try await call("vmRefresh", .string(key), timeout: 60) }
    @discardableResult func vmStart(_ key: String) async throws -> VmInfo { try await call("vmStart", .string(key), timeout: 300) }
    @discardableResult func vmStop(_ key: String) async throws -> VmInfo { try await call("vmStop", .string(key), timeout: 120) }
    @discardableResult func vmDestroy(_ key: String) async throws -> VmInfo { try await call("vmDestroy", .string(key), timeout: 120) }
    func vmRerunSetup(_ key: String) async throws { try await run("vmRerunSetup", .string(key), timeout: 900) }
    /// The heartbeat while you have control of the desktop, so the VM doesn't idle-stop under you.
    func vmTouch(_ key: String) async throws { try await run("vmTouch", .string(key)) }
    /// Runs a command as you; its output streams to the activity log. Starts the VM if needed.
    func vmRun(_ key: String, command: String) async throws -> VmRunResult { try await call("vmRun", .string(key), .string(command), timeout: 660) }
    func vmPeek(_ key: String, view: VmPeekView, path: String = VmPaths.work, lines: Int = 200) async throws -> VmPeekResult {
        try await call("vmPeek", .string(key), .string(view.rawValue), .string(path), .number(Double(lines)), timeout: 60)
    }
    /// The desktop page for a running VM, or nil while it (or its desktop) is still starting. Selkies may take ~30s
    /// the first time on a VM.
    func vmDesktopUrl(_ key: String, mode: DesktopMode) async throws -> String? {
        try await call("vmDesktopUrl", .string(key), .string(mode.rawValue), timeout: 120)
    }
    /// A URL that reaches a port on the VM (behind Dex's sign-in unless public).
    func vmExposePort(_ key: String, port: Int, isPublic: Bool = false) async throws -> String {
        try await call("vmExposePort", .string(key), .number(Double(port)), .bool(isPublic), timeout: 300)
    }
}
