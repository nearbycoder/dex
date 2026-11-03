import Foundation

// The chat's VM files (`vmFiles(key, view, path, offset)`): a folder, a file with its last committed version, and the
// uncommitted changes. Read-only, and it never starts a VM. Mirrors apps/web/src/agent/vm-files.ts.

public enum VmFilesView: String, Sendable { case directory, file, changes }

public struct VmFsEntry: Codable, Sendable, Hashable, Identifiable {
    public var path: String
    public var name: String
    public var directory: Bool
    public var size: Int
    public var modifiedAt: Double
    public var link: Bool
    public var id: String { path }
    public init(path: String, name: String, directory: Bool, size: Int = 0, modifiedAt: Double = 0, link: Bool = false) {
        self.path = path; self.name = name; self.directory = directory; self.size = size; self.modifiedAt = modifiedAt; self.link = link
    }

    enum CodingKeys: String, CodingKey { case path, name, directory, size, modifiedAt, link }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = c.value(.path, default: "")
        name = c.value(.name, default: (path as NSString).lastPathComponent)
        directory = c.value(.directory, default: false)
        size = c.value(.size, default: 0)
        modifiedAt = c.value(.modifiedAt, default: 0)
        link = c.value(.link, default: false)
    }
}

public struct VmFsChange: Codable, Sendable, Hashable, Identifiable {
    /// added, modified, deleted, renamed, untracked
    public var status: String
    public var path: String
    public var previousPath: String?
    public var id: String { path }
    public init(status: String, path: String, previousPath: String? = nil) { self.status = status; self.path = path; self.previousPath = previousPath }

    /// A, M, D, R, U (as git and the web show them).
    public var letter: String {
        switch status {
        case "added": "A"
        case "modified": "M"
        case "deleted": "D"
        case "renamed": "R"
        default: "U"
        }
    }
}

public struct VmDirectory: Codable, Sendable, Hashable {
    public var path: String
    public var parent: String
    public var entries: [VmFsEntry]
    /// Where the next page starts, when the folder has more.
    public var next: Int?
    public init(path: String, parent: String, entries: [VmFsEntry], next: Int? = nil) { self.path = path; self.parent = parent; self.entries = entries; self.next = next }

    enum CodingKeys: String, CodingKey { case path, parent, entries, next }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = c.value(.path, default: "/")
        parent = c.value(.parent, default: path)
        entries = c.value(.entries, default: [])
        next = c.value(.next, default: nil)
    }

    /// Folders first, then by name.
    public var sortedEntries: [VmFsEntry] {
        entries.sorted { a, b in
            if a.directory != b.directory { return a.directory }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

public struct VmChanges: Codable, Sendable, Hashable {
    public var path: String
    /// The repositories found at or under `path` (empty: not in a repository).
    public var repositories: [String]
    public var changes: [VmFsChange]
    public var truncated: Bool
    public init(path: String, repositories: [String], changes: [VmFsChange], truncated: Bool = false) {
        self.path = path; self.repositories = repositories; self.changes = changes; self.truncated = truncated
    }

    enum CodingKeys: String, CodingKey { case path, repositories, changes, truncated }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = c.value(.path, default: "/")
        repositories = c.value(.repositories, default: [])
        changes = c.value(.changes, default: [])
        truncated = c.value(.truncated, default: false)
    }
}

public struct VmFile: Codable, Sendable, Hashable {
    public var path: String
    public var size: Int
    public var modifiedAt: Double?
    /// The text (nil when binary, deleted, or not shown; `message` says why).
    public var content: String?
    /// The committed version, for a changed file.
    public var before: String?
    public var change: String?
    public var binary: Bool
    /// Only the first 64 KB.
    public var truncated: Bool
    public var message: String?
    public init(path: String, size: Int = 0, modifiedAt: Double? = nil, content: String?, before: String? = nil, change: String? = nil,
                binary: Bool = false, truncated: Bool = false, message: String? = nil) {
        self.path = path; self.size = size; self.modifiedAt = modifiedAt; self.content = content; self.before = before; self.change = change
        self.binary = binary; self.truncated = truncated; self.message = message
    }

    enum CodingKeys: String, CodingKey { case path, size, modifiedAt, content, before, change, binary, truncated, message }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = c.value(.path, default: "")
        size = c.value(.size, default: 0)
        modifiedAt = c.value(.modifiedAt, default: nil)
        content = c.value(.content, default: nil)
        before = c.value(.before, default: nil)
        change = c.value(.change, default: nil)
        binary = c.value(.binary, default: false)
        truncated = c.value(.truncated, default: false)
        message = c.value(.message, default: nil)
    }
}

public enum VmFilesError: LocalizedError {
    case stopped
    public var errorDescription: String? { "The VM is stopped. Start it to browse its files." }
}

/// `path` under `root`, without it ("src/app.ts"), or the whole path when it's elsewhere.
public func vmRelativePath(_ path: String, to root: String) -> String {
    let prefix = root == "/" ? "/" : root + "/"
    return path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : path
}

/// A line diff of two texts, shown unified: unchanged lines near a change as context, the rest folded.
public enum LineDiff {
    public enum Kind: Sendable, Hashable { case same, added, removed, fold }

    public struct Line: Sendable, Hashable, Identifiable {
        public var kind: Kind
        public var text: String
        /// Line numbers in the old and new text (nil where the line isn't in that side, and for folds).
        public var old: Int?
        public var new: Int?
        public var id: String { "\(old ?? -1):\(new ?? -1):\(kind)" }
        public init(kind: Kind, text: String, old: Int?, new: Int?) { self.kind = kind; self.text = text; self.old = old; self.new = new }
    }

    public static func unified(before: String?, after: String?, context: Int = 3) -> [Line] {
        let a = lines(before)
        let b = lines(after)
        let difference = b.difference(from: a)
        var removed = Set<Int>()
        var inserted = Set<Int>()
        for change in difference {
            switch change {
            case .remove(let offset, _, _): removed.insert(offset)
            case .insert(let offset, _, _): inserted.insert(offset)
            }
        }
        // Walk both sides together: removals before insertions at each point.
        var all: [Line] = []
        var i = 0
        var j = 0
        while i < a.count || j < b.count {
            if i < a.count, removed.contains(i) {
                all.append(Line(kind: .removed, text: a[i], old: i + 1, new: nil)); i += 1
            } else if j < b.count, inserted.contains(j) {
                all.append(Line(kind: .added, text: b[j], old: nil, new: j + 1)); j += 1
            } else if i < a.count, j < b.count {
                all.append(Line(kind: .same, text: b[j], old: i + 1, new: j + 1)); i += 1; j += 1
            } else if i < a.count {
                all.append(Line(kind: .removed, text: a[i], old: i + 1, new: nil)); i += 1
            } else {
                all.append(Line(kind: .added, text: b[j], old: nil, new: j + 1)); j += 1
            }
        }
        // Keep `context` unchanged lines around each change; fold longer runs.
        let changed = all.indices.filter { all[$0].kind != .same }
        guard !changed.isEmpty else { return all }
        var keep = Set<Int>()
        for index in changed { for near in max(0, index - context)...min(all.count - 1, index + context) { keep.insert(near) } }
        var result: [Line] = []
        var folded = 0
        for index in all.indices {
            if keep.contains(index) {
                if folded > 0 {
                    result.append(Line(kind: .fold, text: "\(folded) unchanged line\(folded == 1 ? "" : "s")", old: nil, new: index))
                    folded = 0
                }
                result.append(all[index])
            } else {
                folded += 1
            }
        }
        if folded > 0 { result.append(Line(kind: .fold, text: "\(folded) unchanged line\(folded == 1 ? "" : "s")", old: nil, new: all.count)) }
        return result
    }

    public static func lines(_ text: String?) -> [String] {
        guard let text, !text.isEmpty else { return [] }
        var lines = text.components(separatedBy: "\n")
        if lines.last == "" { lines.removeLast() }
        return lines
    }
}

/// `{ running: false, status }`, or `{ running: true, data }`.
struct VmFilesResult: Decodable {
    let running: Bool
    let data: JSONValue?
}

public extension DexClient {
    /// One look inside the chat's VM; throws `VmFilesError.stopped` when it isn't running (this never starts it).
    func vmFiles<T: Decodable>(_ key: String, view: VmFilesView, path: String, offset: Int = 0, as type: T.Type = T.self) async throws -> T {
        let result: VmFilesResult = try await call("vmFiles", .string(key), .string(view.rawValue), .string(path), .number(Double(offset)), timeout: 60)
        guard result.running, let data = result.data else { throw VmFilesError.stopped }
        return try data.decode(T.self)
    }
}
