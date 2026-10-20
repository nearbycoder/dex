import DexCore
import Foundation
import Observation

/// One window's Files tab: the workspace listing, the open file with its unsaved edits, and the shell's history.
@MainActor
@Observable
final class FilesModel {
    struct OpenFile: Equatable {
        let path: String
        /// What's saved; nil for a binary file.
        var content: String?
        var size: Int
        /// What you've typed.
        var draft: String
    }

    struct TerminalLine: Identifiable, Equatable {
        let id = UUID()
        let command: String
        let output: String
        let exitCode: Int
    }

    var files: [WorkspaceFile]?
    var listError: String?
    var loadingList = false
    var open: OpenFile?
    var openError: String?
    var loadingFile = false
    var terminal: [TerminalLine] = []
    var running = false
    /// The saved file as a temporary copy, for the share sheet.
    private(set) var exportURL: URL?

    /// The open file has edits that aren't saved.
    var dirty: Bool {
        guard let open, let content = open.content else { return false }
        return open.draft != content
    }

    func file(_ path: String) -> WorkspaceFile? { files?.first { $0.path == path } }

    func refresh(_ client: DexClient) async {
        guard client.isConnected else { return }
        loadingList = true
        defer { loadingList = false }
        do {
            files = try await client.call("listFiles", as: [WorkspaceFile].self)
            listError = nil
        } catch {
            listError = error.localizedDescription
        }
    }

    /// Opens `path` (keeps the open one if it's the same file, so edits survive a size-class change).
    func load(_ path: String, client: DexClient) async {
        if open?.path == path { return }
        open = nil
        openError = nil
        exportURL = nil
        guard client.isConnected else { return }
        loadingFile = true
        defer { loadingFile = false }
        do {
            let file = try await client.call("readFile", .string(path), as: WorkspaceFileContent.self)
            open = OpenFile(path: path, content: file.content, size: file.size, draft: file.content ?? "")
            export()
        } catch {
            openError = error.localizedDescription
        }
    }

    /// Reloads the open file from the agent, dropping unsaved edits.
    func reload(client: DexClient) async {
        guard let path = open?.path else { return }
        open = nil
        await load(path, client: client)
    }

    func close() {
        open = nil
        openError = nil
        exportURL = nil
    }

    func save(client: DexClient) async throws {
        guard let open, open.content != nil else { return }
        try await client.run("writeFile", .string(open.path), .string(open.draft))
        self.open?.content = open.draft
        self.open?.size = open.draft.utf8.count
        export()
        await refresh(client)
    }

    func discard() {
        guard let content = open?.content else { return }
        open?.draft = content
    }

    func delete(_ path: String, client: DexClient) async throws {
        try await client.run("deleteFile", .string(path))
        if open?.path == path || open?.path.hasPrefix(path + "/") == true { close() }
        files?.removeAll { $0.path == path || $0.path.hasPrefix(path + "/") }
        await refresh(client)
    }

    /// Creates an empty file and returns its absolute path.
    func create(_ path: String, client: DexClient) async throws -> String {
        if let problem = Workspace.problem(path) { throw AgentError.remote(problem) }
        let resolved = Workspace.resolve(path)
        if file(resolved) == nil { try await client.run("writeFile", .string(resolved), "") }
        await refresh(client)
        return resolved
    }

    func run(_ command: String, client: DexClient) async {
        let value = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !running else { return }
        running = true
        defer { running = false }
        do {
            let result = try await client.call("runCommand", .string(value), as: CommandResult.self, timeout: 120)
            terminal = Array((terminal + [TerminalLine(command: value, output: result.output, exitCode: result.exitCode)]).suffix(30))
            await refresh(client)
            // A command may have changed the open file; show its new text unless you're editing it.
            if let open, !dirty { self.open = nil; await load(open.path, client: client) }
        } catch {
            terminal.append(TerminalLine(command: value, output: error.localizedDescription, exitCode: 1))
        }
    }

    private func export() {
        guard let open, let content = open.content else { exportURL = nil; return }
        let folder = FileManager.default.temporaryDirectory.appending(path: "DexExport", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: Workspace.name(of: open.path))
        exportURL = (try? Data(content.utf8).write(to: url, options: .atomic)) != nil ? url : nil
    }
}
