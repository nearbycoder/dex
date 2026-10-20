import Foundation

// The agent's /workspace (`listFiles`, `readFile`, `writeFile`, `deleteFile`, `runCommand`): files kept across chats,
// MEMORY.md among them, and a simulated shell over them.

public struct WorkspaceFile: Codable, Sendable, Hashable, Identifiable {
    /// Absolute: `/workspace/notes/a.md`.
    public var path: String
    public var size: Int
    public var mtime: Double
    public var id: String { path }
    public init(path: String, size: Int, mtime: Double) { self.path = path; self.size = size; self.mtime = mtime }

    public var name: String { Workspace.name(of: path) }
    /// The path below /workspace: `notes/a.md`.
    public var relativePath: String { Workspace.relative(path) }
}

/// `readFile` → the text, or `content: nil` for a binary file.
public struct WorkspaceFileContent: Codable, Sendable, Hashable {
    public var path: String
    public var content: String?
    public var size: Int
    public init(path: String, content: String?, size: Int) { self.path = path; self.content = content; self.size = size }
}

/// `runCommand` → what the workspace shell printed.
public struct CommandResult: Codable, Sendable, Hashable {
    public var stdout: String
    public var stderr: String
    public var exitCode: Int
    public init(stdout: String, stderr: String, exitCode: Int) { self.stdout = stdout; self.stderr = stderr; self.exitCode = exitCode }
    public var output: String { stdout + stderr }
}

public enum Workspace {
    public static let root = "/workspace"
    public static let memory = "/workspace/MEMORY.md"

    /// `notes/a.md`, `./notes/a.md`, and `/workspace/notes/a.md` all name `/workspace/notes/a.md` (the agent's own rule).
    public static func resolve(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        let absolute = trimmed.hasPrefix("/") ? trimmed : "\(root)/\(trimmed)"
        var parts: [Substring] = []
        for part in absolute.split(separator: "/") {
            if part == "." || part.isEmpty { continue }
            if part == ".." { _ = parts.popLast() } else { parts.append(part) }
        }
        return "/" + parts.joined(separator: "/")
    }

    /// Why a new file's path won't do, or nil.
    public static func problem(_ path: String) -> String? {
        let resolved = resolve(path)
        if path.trimmingCharacters(in: .whitespaces).isEmpty { return "Enter a file name." }
        if resolved == root || !resolved.hasPrefix(root + "/") { return "Files live in /workspace." }
        if path.hasSuffix("/") { return "Enter a file name, not a folder." }
        return nil
    }

    public static func relative(_ path: String) -> String {
        path.hasPrefix(root + "/") ? String(path.dropFirst(root.count + 1)) : path
    }

    public static func name(of path: String) -> String { path.split(separator: "/").last.map(String.init) ?? path }

    /// How a file is shown: rendered Markdown, a live HTML preview, or text.
    public enum PreviewKind: Sendable { case markdown, html }

    public static func previewKind(_ path: String) -> PreviewKind? {
        let lower = path.lowercased()
        if lower.hasSuffix(".md") || lower.hasSuffix(".markdown") { return .markdown }
        if lower.hasSuffix(".html") || lower.hasSuffix(".htm") { return .html }
        return nil
    }
}

/// A folder or file in the workspace tree, built from the flat paths `listFiles` returns (folders have no records of
/// their own: they exist while a file is in them).
public struct WorkspaceNode: Sendable, Hashable, Identifiable {
    /// The file's or folder's absolute path.
    public var path: String
    public var name: String
    /// Set for a file.
    public var file: WorkspaceFile?
    /// Set for a folder (files and subfolders, folders first).
    public var children: [WorkspaceNode]?
    public var id: String { path }

    public var isFolder: Bool { children != nil }
    /// A folder's total size and newest change.
    public var size: Int { file?.size ?? (children ?? []).reduce(0) { $0 + $1.size } }
    public var mtime: Double { file?.mtime ?? (children ?? []).map(\.mtime).max() ?? 0 }
    public var fileCount: Int { file != nil ? 1 : (children ?? []).reduce(0) { $0 + $1.fileCount } }

    public init(path: String, name: String, file: WorkspaceFile? = nil, children: [WorkspaceNode]? = nil) {
        self.path = path; self.name = name; self.file = file; self.children = children
    }
}

public enum WorkspaceSort: String, Sendable, Hashable, CaseIterable, Identifiable {
    case name, modified, size
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .name: "Name"
        case .modified: "Date Modified"
        case .size: "Size"
        }
    }
}

public enum WorkspaceTree {
    /// The top level of /workspace as a tree; each level has folders first, then files, in `sort` order.
    public static func build(_ files: [WorkspaceFile], sort: WorkspaceSort = .name) -> [WorkspaceNode] {
        final class Folder {
            var folders: [String: Folder] = [:]
            var files: [WorkspaceFile] = []
        }
        let top = Folder()
        for file in files {
            let parts = Workspace.relative(file.path).split(separator: "/").map(String.init)
            guard !parts.isEmpty else { continue }
            var folder = top
            for part in parts.dropLast() {
                if folder.folders[part] == nil { folder.folders[part] = Folder() }
                folder = folder.folders[part]!
            }
            folder.files.append(file)
        }
        func nodes(_ folder: Folder, at path: String) -> [WorkspaceNode] {
            let folders = folder.folders.map { name, child in
                WorkspaceNode(path: "\(path)/\(name)", name: name, children: nodes(child, at: "\(path)/\(name)"))
            }
            let files = folder.files.map { WorkspaceNode(path: $0.path, name: $0.name, file: $0) }
            return ordered(folders, sort) + ordered(files, sort)
        }
        return nodes(top, at: Workspace.root)
    }

    static func ordered(_ nodes: [WorkspaceNode], _ sort: WorkspaceSort) -> [WorkspaceNode] {
        nodes.sorted { a, b in
            switch sort {
            case .name: a.name.localizedStandardCompare(b.name) == .orderedAscending
            case .modified: a.mtime != b.mtime ? a.mtime > b.mtime : a.name.localizedStandardCompare(b.name) == .orderedAscending
            case .size: a.size != b.size ? a.size > b.size : a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        }
    }

    /// Files whose path matches `query`, flat, in `sort` order.
    public static func search(_ files: [WorkspaceFile], _ query: String, sort: WorkspaceSort = .name) -> [WorkspaceNode] {
        let matches = files.filter { $0.relativePath.localizedCaseInsensitiveContains(query) }
        return ordered(matches.map { WorkspaceNode(path: $0.path, name: $0.name, file: $0) }, sort)
    }
}
