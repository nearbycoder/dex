import DexCore
import SwiftUI

/// The chat's VM files (the web's Files panel): every file from ~/work down, folder by folder, and the uncommitted
/// changes; a file opens as its text, or (changed) as what changed since the last commit. Read-only, and it never starts
/// the VM by itself. A sheet over the chat.
struct VmFilesPanel: View {
    @Environment(DexClient.self) private var client
    let sessionId: String
    /// The chat is working: when it stops, what's shown is read again.
    let running: Bool
    let close: () -> Void
    @State private var tab = Tab.files
    @State private var folder = VmPaths.work
    @State private var pathField = VmPaths.work
    @State private var root: VmDirectory?
    @State private var changes: VmChanges?
    @State private var changesError: String?
    @State private var error: String?
    @State private var loading = false
    @State private var revision = 0
    @State private var path: [Route] = []

    enum Tab: Hashable { case files, changes }

    enum Route: Hashable {
        case folder(String)
        case file(String, changed: Bool)
    }

    var body: some View {
        let vm = client.state?.vm(sessionId)
        NavigationStack(path: $path) {
            Group {
                if vm?.status != "running" {
                    stopped(vm)
                } else {
                    List {
                        Section {
                            Picker("Show", selection: $tab) {
                                Text("All Files").tag(Tab.files)
                                Text(changes.map { "Changes \($0.changes.count)\($0.truncated ? "+" : "")" } ?? "Changes").tag(Tab.changes)
                            }
                            .pickerStyle(.segmented)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                            .accessibilityIdentifier("files.tab")
                        }
                        if let error {
                            Section {
                                InlineMessage(tone: .error, text: error)
                                Button("Retry") { revision += 1 }
                            }
                        }
                        if !client.isConnected {
                            Section { InlineMessage(tone: .warning, text: "Reconnecting… files may be out of date.") }
                        }
                        switch tab {
                        case .files: filesSection
                        case .changes: changesSection
                        }
                    }
                    .listSectionSpacing(.compact)
                    .refreshable { revision += 1 }
                }
            }
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .folder(let folder): VmFolderView(sessionId: sessionId, folder: folder, root: root?.path ?? folder, changes: changes, revision: revision)
                case .file(let file, let changed): VmFileView(sessionId: sessionId, path: file, showChanges: changed, revision: revision)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", action: close)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("files.close")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        revision += 1
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise").symbolEffect(.rotate, isActive: loading)
                    }
                    .disabled(vm?.status != "running" || loading)
                    .accessibilityIdentifier("files.refresh")
                }
            }
        }
        .task {
            // Brings the VM's status up to date (the web does the same); never starts it.
            _ = try? await client.vmRefresh(sessionId)
        }
        .task(id: LoadKey(folder: folder, revision: revision, running: vm?.status == "running", connected: client.isConnected)) { await load() }
        // The agent finished: what it changed shows.
        .onChange(of: running) { was, now in if was && !now { revision += 1 } }
        .accessibilityIdentifier("files")
    }

    private struct LoadKey: Equatable { let folder: String; let revision: Int; let running: Bool; let connected: Bool }

    @ViewBuilder private func stopped(_ vm: VmInfo?) -> some View {
        ContentUnavailableView {
            Label(vm?.status == "starting" ? "The VM is starting…" : "The VM isn't running", systemImage: "folder")
        } description: {
            Text(vm?.status == "starting" ? "Its files show once it's up." : "Start this chat's VM to browse its files.")
        } actions: {
            if vm?.status != "starting" {
                Button("Start VM") { client.perform { try await client.vmStart(sessionId) } }
                    .prominentButton()
                    .disabled(!client.isConnected || vm == nil)
                    .accessibilityIdentifier("files.start")
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }
    }

    @ViewBuilder private var filesSection: some View {
        Section {
            HStack(spacing: 8) {
                Button {
                    if let root, root.parent != root.path { go(root.parent) }
                } label: {
                    Image(systemName: "arrow.up").frame(width: 28, height: 28)
                }
                .buttonStyle(.borderless)
                .disabled(root == nil || root?.parent == root?.path)
                .accessibilityLabel("Parent folder")
                TextField("Folder", text: $pathField)
                    .font(.callout.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { if !pathField.trimmingCharacters(in: .whitespaces).isEmpty { go(pathField.trimmingCharacters(in: .whitespaces)) } }
                    .accessibilityLabel("VM folder path")
                    .accessibilityIdentifier("files.path")
            }
        }
        Section {
            if let root {
                if root.entries.isEmpty { Text("This folder is empty.").foregroundStyle(.secondary) }
                ForEach(root.sortedEntries) { entry in
                    VmEntryRow(entry: entry, change: change(of: entry, under: root.path))
                }
                if root.next != nil { Text("More files aren't shown. Open a folder to narrow it.").font(.footnote).foregroundStyle(.secondary) }
            } else if error == nil {
                ForEach(0..<6, id: \.self) { _ in LineBone(width: 200) }
            }
        }
    }

    @ViewBuilder private var changesSection: some View {
        Section {
            if let changesError {
                InlineMessage(tone: .error, text: changesError)
            } else if let changes {
                if changes.repositories.isEmpty {
                    Text("No Git repository here. Open a repository folder to see its changes.").foregroundStyle(.secondary)
                } else if changes.changes.isEmpty {
                    Text("No uncommitted changes.").foregroundStyle(.secondary)
                }
                ForEach(changes.changes) { change in
                    NavigationLink(value: Route.file(change.path, changed: true)) {
                        HStack(spacing: 10) {
                            ChangeLetter(change: change)
                            Text(vmRelativePath(change.path, to: root?.path ?? changes.path))
                                .font(.callout.monospaced())
                                .lineLimit(2)
                                .truncationMode(.head)
                        }
                    }
                    .accessibilityLabel("\(change.status.capitalized): \(vmRelativePath(change.path, to: root?.path ?? changes.path))")
                    .accessibilityIdentifier("files.change.\((change.path as NSString).lastPathComponent)")
                }
                if changes.truncated {
                    Text("More changes exist. Open a single repository to narrow the list.").font(.footnote).foregroundStyle(.orange)
                }
            } else {
                ForEach(0..<3, id: \.self) { _ in LineBone(width: 220) }
            }
        } footer: {
            Text("Staged, unstaged, and new files, compared with the last commit.")
        }
    }

    private func change(of entry: VmFsEntry, under _: String) -> VmFsChange? {
        changes?.changes.first { $0.path == entry.path }
    }

    private func go(_ next: String) {
        folder = next
        pathField = next
        path = []
    }

    /// The folder and the changes, each on its own (one failing doesn't hide the other).
    private func load() async {
        guard client.isConnected, client.state?.vm(sessionId)?.status == "running" else { return }
        loading = true
        defer { loading = false }
        async let directory: VmDirectory = client.vmFiles(sessionId, view: .directory, path: folder)
        async let changed: VmChanges = client.vmFiles(sessionId, view: .changes, path: folder)
        do {
            let result = try await directory
            root = result
            pathField = result.path
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        do {
            changes = try await changed
            changesError = nil
        } catch {
            changes = nil
            changesError = error.localizedDescription
        }
    }
}

/// A file or folder in a listing: folders open, files open their text; a changed file shows its letter.
private struct VmEntryRow: View {
    let entry: VmFsEntry
    let change: VmFsChange?

    var body: some View {
        NavigationLink(value: entry.directory ? VmFilesPanel.Route.folder(entry.path) : VmFilesPanel.Route.file(entry.path, changed: change != nil)) {
            HStack(spacing: 10) {
                Image(systemName: entry.directory ? "folder.fill" : entry.link ? "link" : "doc.text")
                    .foregroundStyle(entry.directory ? Color.dexAccent : .secondary)
                    .frame(width: 22)
                Text(entry.name).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if let change { ChangeLetter(change: change) }
                if !entry.directory {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(entry.size), countStyle: .file))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("files.entry.\(entry.name)")
    }
}

private struct ChangeLetter: View {
    let change: VmFsChange

    var body: some View {
        Text(change.letter)
            .font(.caption.monospaced().weight(.bold))
            .foregroundStyle(change.status == "deleted" ? .red : change.status == "modified" ? .orange : .green)
            .frame(width: 14)
            .accessibilityLabel(change.status.capitalized)
    }
}

/// A folder further down, listed when it's opened.
private struct VmFolderView: View {
    @Environment(DexClient.self) private var client
    let sessionId: String
    let folder: String
    let root: String
    let changes: VmChanges?
    let revision: Int
    @State private var directory: VmDirectory?
    @State private var error: String?

    var body: some View {
        List {
            if let error { InlineMessage(tone: .error, text: error) }
            if let directory {
                if directory.entries.isEmpty { Text("This folder is empty.").foregroundStyle(.secondary) }
                ForEach(directory.sortedEntries) { entry in
                    VmEntryRow(entry: entry, change: changes?.changes.first { $0.path == entry.path })
                }
                if let next = directory.next {
                    Button("Load More") { Task { await load(offset: next) } }
                }
            } else if error == nil {
                ForEach(0..<6, id: \.self) { _ in LineBone(width: 200) }
            }
        }
        .navigationTitle((folder as NSString).lastPathComponent)
        .navigationSubtitle(vmRelativePath(folder, to: root))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: revision) { await load() }
    }

    private func load(offset: Int = 0) async {
        do {
            let result: VmDirectory = try await client.vmFiles(sessionId, view: .directory, path: folder, offset: offset)
            if offset > 0, var current = directory {
                current.entries += result.entries
                current.next = result.next
                directory = current
            } else {
                directory = result
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A file's text with line numbers, or what changed since the last commit.
private struct VmFileView: View {
    @Environment(DexClient.self) private var client
    let sessionId: String
    let path: String
    let showChanges: Bool
    let revision: Int
    @State private var file: VmFile?
    @State private var error: String?
    @State private var view = "source"

    var body: some View {
        Group {
            if let error {
                ContentUnavailableView("Couldn't open it", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let file {
                content(file)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(0..<10, id: \.self) { index in LineBone(width: CGFloat(120 + (index * 37) % 180), font: .caption.monospaced()) }
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationSubtitle(file.map { ByteCountFormatter.string(fromByteCount: Int64($0.size), countStyle: .file) } ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let file, file.change != nil, !file.binary {
                ToolbarItem(placement: .primaryAction) {
                    Picker("View", selection: $view) {
                        Label("Source", systemImage: "doc.plaintext").tag("source")
                        Label("Changes", systemImage: "plus.forwardslash.minus").tag("diff")
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                    .accessibilityIdentifier("files.view")
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                if let content = file?.content {
                    Button { UIPasteboard.general.string = content } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
            }
        }
        .task(id: revision) {
            do {
                file = try await client.vmFiles(sessionId, view: .file, path: path)
                error = nil
                if showChanges, file?.change != nil { view = "diff" }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    @ViewBuilder private func content(_ file: VmFile) -> some View {
        VStack(spacing: 0) {
            if file.truncated {
                Label("Only the first 64 KB is shown; the changes may be incomplete.", systemImage: "scissors")
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
            Text(path).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(2).truncationMode(.head)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            Divider()
            if let message = file.message {
                ContentUnavailableView(message, systemImage: "doc")
            } else if view == "diff", file.change != nil {
                CodeLines(lines: LineDiff.unified(before: file.before, after: file.content))
            } else if let content = file.content {
                CodeLines(lines: LineDiff.lines(content).enumerated().map { LineDiff.Line(kind: .same, text: $1, old: nil, new: $0 + 1) })
            } else {
                ContentUnavailableView("This file was deleted", systemImage: "trash", description: Text("Changes shows what it was."))
            }
        }
        .accessibilityIdentifier("files.file")
    }
}

/// Monospaced lines with their numbers; a diff's added and removed lines tinted, unchanged runs folded.
private struct CodeLines: View {
    let lines: [LineDiff.Line]
    @ScaledMetric(relativeTo: .caption) private var gutter: CGFloat = 34

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(line.kind == .fold ? "⋯" : (line.new ?? line.old).map(String.init) ?? "")
                            .foregroundStyle(.tertiary)
                            .frame(width: gutter, alignment: .trailing)
                        Text(marker(line.kind)).foregroundStyle(color(line.kind)).frame(width: 10)
                        Text(line.text.isEmpty ? " " : line.text)
                            .foregroundStyle(line.kind == .fold ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .font(.caption.monospaced())
                    .padding(.vertical, 1)
                    .padding(.trailing, 12)
                    .background(background(line.kind))
                }
            }
            .padding(.vertical, 8)
            .textSelection(.enabled)
        }
    }

    private func marker(_ kind: LineDiff.Kind) -> String {
        switch kind {
        case .added: "+"
        case .removed: "−"
        default: " "
        }
    }

    private func color(_ kind: LineDiff.Kind) -> Color {
        switch kind {
        case .added: .green
        case .removed: .red
        default: .secondary
        }
    }

    private func background(_ kind: LineDiff.Kind) -> Color {
        switch kind {
        case .added: .green.opacity(0.14)
        case .removed: .red.opacity(0.14)
        case .fold: Color.secondary.opacity(0.08)
        case .same: .clear
        }
    }
}
