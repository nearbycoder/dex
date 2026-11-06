import Foundation

// Spaces: a coordinator chat that starts and directs other chats (its threads) for you, after Amp's Spaces. Mirrors
// apps/web/src/shared/spaces.ts.

/// A space: one conversation with a coordinator whose job is to start and direct other chats (its threads). Its chat is
/// an ordinary chat (`sessionId`) with extra tools; its threads are ordinary chats with `SessionMeta.spaceId` set.
public struct SpaceProfile: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// What the work is for; the coordinator keeps the threads pointed at it. May be empty.
    public var goal: String
    /// The project the threads work in (each gets its own VM with the repos), if any.
    public var projectId: String?
    /// The coordinator's chat.
    public var sessionId: String
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, name: String, goal: String = "", projectId: String? = nil, sessionId: String, createdAt: Double = 0, updatedAt: Double = 0) {
        self.id = id; self.name = name; self.goal = goal; self.projectId = projectId; self.sessionId = sessionId
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, goal, projectId, sessionId, createdAt, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        goal = c.value(.goal, default: "")
        projectId = c.value(.projectId, default: nil)
        sessionId = c.value(.sessionId, default: "")
        createdAt = c.value(.createdAt, default: 0)
        updatedAt = c.value(.updatedAt, default: 0)
    }
}

/// What `saveSpace` takes: a new space (no id) or an edit.
public struct SpaceDraft: Codable, Sendable, Hashable {
    public var id: String?
    public var name: String
    public var goal: String
    public var projectId: String?

    public init(id: String? = nil, name: String = "", goal: String = "", projectId: String? = nil) {
        self.id = id; self.name = name; self.goal = goal; self.projectId = projectId
    }

    public init(_ space: SpaceProfile) {
        self.init(id: space.id, name: space.name, goal: space.goal, projectId: space.projectId)
    }

    /// A name is required (the server trims it).
    public var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    enum CodingKeys: String, CodingKey { case id, name, goal, projectId }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(goal, forKey: .goal)
        // Null: no project (an edit can take it away).
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.value(.id, default: nil)
        name = c.value(.name, default: "")
        goal = c.value(.goal, default: "")
        projectId = c.value(.projectId, default: nil)
    }
}

/// Where a thread is, for its card and the space's thread list.
public enum ThreadStatus: String, Sendable, Hashable, CaseIterable, Identifiable {
    case needsYou = "needs_you", working, failed, done, new
    public var id: String { rawValue }

    /// THREAD_STATUS_LABELS.
    public var label: String {
        switch self {
        case .working: "Working"
        case .needsYou: "Needs you"
        case .failed: "Failed"
        case .done: "Done"
        case .new: "Not started"
        }
    }

    /// THREAD_STATUS_ORDER: what needs attention first (the case order).
    public static let order: [ThreadStatus] = allCases
}

/// One thread's run ending, as the coordinator is told it (a `[Space update] …` message in its chat).
public struct SpaceUpdate: Sendable, Hashable {
    public enum Outcome: String, Sendable, Hashable { case finished, failed, stopped }
    public var threadId: String
    public var title: String
    public var outcome: Outcome
    /// The thread's final reply, if it sent one.
    public var body: String

    public init(threadId: String, title: String, outcome: Outcome, body: String = "") {
        self.threadId = threadId; self.title = title; self.outcome = outcome; self.body = body
    }
}

public enum Spaces {
    public static let maxName = 60
    public static let maxGoal = 2_000
    public static let maxNotes = 8_000

    /// The tool the coordinator starts a thread with; its result's `details.thread` is `{ id, title }`.
    public static let startThreadTool = "space_start_thread"
    /// The coordinator's other tools.
    public static let tools: Set<String> = [startThreadTool, "space_message_thread", "space_list_threads", "space_read_thread", "space_stop_thread"]

    public static let updatePrefix = "[Space update] "
    public static let updateSeparator = "\n\n---\n\n"

    /// The coordinator's notes: a running summary, decisions, and a ledger of the work, kept in the workspace.
    public static func notesPath(_ id: String) -> String { "/workspace/spaces/\(id)/NOTES.md" }

    /// A thread's status: needs you while it waits on your confirmation; working while it runs; failed when its last
    /// reply hit a problem; done once it has replied; new before that.
    public static func status(of session: SessionMeta, pending: [PendingAction] = []) -> ThreadStatus {
        if pending.contains(where: { $0.sessionId == session.id && $0.status == "pending" }) { return .needsYou }
        if session.busy { return .working }
        if session.failed { return .failed }
        return session.repliedAt != nil ? .done : .new
    }

    /// A space's threads: its chats other than the coordinator's, newest first.
    public static func threads(of space: SpaceProfile, in sessions: [SessionMeta]) -> [SessionMeta] {
        sessions.filter { $0.spaceId == space.id && $0.id != space.sessionId }.sorted { $0.createdAt > $1.createdAt }
    }

    /// Threads grouped by status, in `ThreadStatus.order`, empty groups left out.
    public static func grouped(_ threads: [SessionMeta], pending: [PendingAction] = []) -> [(status: ThreadStatus, threads: [SessionMeta])] {
        let statuses = Dictionary(threads.map { ($0.id, status(of: $0, pending: pending)) }, uniquingKeysWith: { first, _ in first })
        return ThreadStatus.order.compactMap { status in
            let matching = threads.filter { statuses[$0.id] == status }
            return matching.isEmpty ? nil : (status, matching)
        }
    }

    /// A space's line in the list: "2 working · 1 needs you" (attention first), else its goal, else "No threads yet".
    public static func summary(_ space: SpaceProfile, threads: [SessionMeta], pending: [PendingAction] = []) -> String {
        let counts = grouped(threads, pending: pending).filter { [.needsYou, .working, .failed].contains($0.status) }
        if !counts.isEmpty {
            return counts.map { "\($0.threads.count) \($0.status.label.lowercased())" }.joined(separator: " · ")
        }
        let goal = space.goal.split(separator: "\n").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        if !goal.isEmpty { return goal }
        if !threads.isEmpty { return threads.count == 1 ? "1 thread" : "\(threads.count) threads" }
        return "No threads yet"
    }

    /// The thread updates in a coordinator message, or nil if it isn't one (parseSpaceUpdates).
    public static func parseUpdates(_ text: String) -> [SpaceUpdate]? {
        guard text.hasPrefix(updatePrefix) else { return nil }
        return text.components(separatedBy: updateSeparator).compactMap { part in
            let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let match = trimmed.wholeMatch(of: /\[Space update\] Thread “(.*?)” \(([^)\s]+)\) (finished|failed|stopped)\.(?:\n\n([\s\S]*))?/),
                  let outcome = SpaceUpdate.Outcome(rawValue: String(match.3)) else { return nil }
            return SpaceUpdate(threadId: String(match.2), title: String(match.1), outcome: outcome, body: match.4.map(String.init) ?? "")
        }
    }

    /// A coordinator message about a thread (spaceUpdate): what the mock agent sends, as the agent does.
    public static func update(thread: (id: String, title: String), outcome: SpaceUpdate.Outcome, body: String = "") -> String {
        let title = thread.title.replacingOccurrences(of: "“", with: "\"").replacingOccurrences(of: "”", with: "\"")
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(updatePrefix)Thread “\(title)” (\(thread.id)) \(outcome.rawValue).\(trimmed.isEmpty ? "" : "\n\n\(trimmed)")"
    }
}

public extension DexClient {
    /// Creates a space (no id; its coordinator chat comes with it) or changes one.
    func saveSpace(_ draft: SpaceDraft) async throws -> SpaceProfile { try await call("saveSpace", JSONValue(encoding: draft)) }
    /// Deletes the space, its coordinator chat, and all its threads (their VMs too).
    func deleteSpace(_ id: String) async throws { try await run("deleteSpace", .string(id), timeout: 60) }
    /// The coordinator's notes, as Markdown (may be empty).
    func spaceNotes(_ id: String) async throws -> String { try await call("spaceNotes", .string(id)) }
}
