import DexCore
import SwiftUI

/// The Files tab: the agent's /workspace (files kept across chats, MEMORY.md among them) as folders beside the open
/// file, with a shell to run commands in it. `router.file` holds the open path; `router.openFile(_:)` deep-links.
struct FilesView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var model = FilesModel()
    @State private var search = ""
    @AppStorage("dex.files.sort") private var sort: WorkspaceSort = .name
    @State private var newFile = false
    @State private var newPath = ""
    @State private var deleting: WorkspaceNode?
    @State private var leavingTo: String??
    @State private var terminal = false

    var body: some View {
        NavigationSplitView {
            browser
                .listColumn()
        } detail: {
            NavigationStack {
                if let path = router.file {
                    FileDetailView(path: path)
                        .id(path)
                } else {
                    EmptyStateView(title: "No File Selected", symbol: "doc.text", message: "Pick a file from the workspace.")
                }
            }
        }
        .environment(model)
        .task(id: client.isConnected) { await model.refresh(client) }
        .onChange(of: router.file, initial: true) { _, path in
            guard let path else { return }
            // `dex://file/notes/a.md` arrives as /notes/a.md: a path below the workspace.
            let resolved = path.hasPrefix(Workspace.root + "/") ? path : Workspace.resolve(String(path.drop { $0 == "/" }))
            if resolved != path { router.file = resolved }
        }
        .confirmationDialog("Discard your changes to \(model.open.map { Workspace.name(of: $0.path) } ?? "this file")?", isPresented: Binding(get: { leavingTo != nil }, set: { if !$0 { leavingTo = nil } }), titleVisibility: .visible) {
            Button("Save") {
                let target = leavingTo
                client.perform {
                    try await model.save(client: client)
                    if let target { router.file = target }
                }
            }
            Button("Discard Changes", role: .destructive) {
                model.discard()
                if let target = leavingTo { router.file = target }
            }
            .accessibilityIdentifier("files.discard")
        }
    }

    /// Selecting another file (or going back) with unsaved edits asks first.
    private var selection: Binding<String?> {
        Binding(get: { router.file }, set: { path in
            if let path, model.file(path) == nil { return } // a folder
            if path != router.file, model.dirty { leavingTo = .some(path); return }
            router.file = path
        })
    }

    private var browser: some View {
        let files = model.files ?? []
        let nodes = search.isEmpty ? WorkspaceTree.build(files, sort: sort) : WorkspaceTree.search(files, search, sort: sort)
        return List(selection: selection) {
            if model.files == nil {
                if let error = model.listError {
                    InlineMessage(tone: .error, text: error)
                } else {
                    ForEach([170, 120, 200, 90, 150] as [CGFloat], id: \.self) { width in
                        HStack(spacing: 10) {
                            Image(systemName: "doc").foregroundStyle(.quaternary)
                            LineBone(width: width)
                        }
                    }
                }
            } else if files.isEmpty {
                ContentUnavailableView("Empty Workspace", systemImage: "folder", description: Text("Files Dex creates with its tools show up here."))
                    .listRowSeparator(.hidden)
            } else if nodes.isEmpty {
                ContentUnavailableView.search(text: search)
            }
            Section {
                OutlineGroup(nodes, children: \.children) { node in
                    FileRow(node: node)
                        .tag(node.path)
                        .swipeActions {
                            Button("Delete", systemImage: "trash") { deleting = node }.tint(.red)
                        }
                        .contextMenu {
                            if !node.isFolder {
                                Button("Open", systemImage: "doc.text") { selection.wrappedValue = node.path }
                            }
                            Button("Copy Path", systemImage: "doc.on.doc") { UIPasteboard.general.string = node.path }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = node }
                        }
                }
            } footer: {
                if !files.isEmpty, search.isEmpty {
                    Text("\(files.count) files · \(Format.bytes(files.reduce(0) { $0 + $1.size })). MEMORY.md is Dex's long-term memory, added to every chat.")
                }
            }
        }
        .listStyle(.sidebar)
        .tint(.selectionAccent)
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search files")
        .refreshable { await model.refresh(client) }
        .navigationTitle("Files")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("Sort By", selection: $sort) {
                        ForEach(WorkspaceSort.allCases) { Text($0.label).tag($0) }
                    }
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh(client) } }
                        .keyboardShortcut("r", modifiers: .command)
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
                .accessibilityIdentifier("files.sort")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    terminal = true
                } label: {
                    Label("Run Command", systemImage: "apple.terminal")
                }
                .keyboardShortcut("`", modifiers: .control)
                .accessibilityIdentifier("files.terminal")
                Button {
                    newPath = ""
                    newFile = true
                } label: {
                    Label("New File", systemImage: "doc.badge.plus")
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .accessibilityIdentifier("files.new")
            }
        }
        .alert("New File", isPresented: $newFile) {
            TextField("notes.md", text: $newPath)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("files.newPath")
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                let path = newPath
                client.perform {
                    let created = try await model.create(path, client: client)
                    selection.wrappedValue = created
                }
            }
            .accessibilityIdentifier("files.create")
        } message: {
            Text("A path in /workspace, like notes/ideas.md. Folders are made as needed.")
        }
        .confirmationDialog(deleteTitle, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { node in
            Button("Delete", role: .destructive) {
                client.perform {
                    try await model.delete(node.path, client: client)
                    if let open = router.file, open == node.path || open.hasPrefix(node.path + "/") { router.file = nil }
                }
            }
            .accessibilityIdentifier("files.confirmDelete")
        }
        .sheet(isPresented: $terminal) {
            TerminalSheet()
                .environment(model)
        }
    }

    private var deleteTitle: String {
        guard let deleting else { return "" }
        return deleting.isFolder ? "Delete \(deleting.name) and its \(deleting.fileCount == 1 ? "file" : "\(deleting.fileCount) files")?" : "Delete \(Workspace.relative(deleting.path))?"
    }
}

private struct FileRow: View {
    let node: WorkspaceNode

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(node.isFolder ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(node.name).lineLimit(1)
                Text(node.isFolder ? (node.fileCount == 1 ? "1 file" : "\(node.fileCount) files") : "\(Format.bytes(node.size)) · \(Format.ago(node.mtime))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("file.\(Workspace.relative(node.path))")
    }

    private var symbol: String {
        if node.isFolder { return "folder.fill" }
        if node.path == Workspace.memory { return "brain" }
        switch Workspace.previewKind(node.path) {
        case .markdown: return "doc.richtext"
        case .html: return "globe"
        case nil:
            let ext = (node.name as NSString).pathExtension.lowercased()
            if ["sh", "js", "ts", "py", "swift", "json", "rb", "go", "rs", "css", "yml", "yaml", "toml"].contains(ext) { return "chevron.left.forwardslash.chevron.right" }
            if ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(ext) { return "photo" }
            if ["csv", "tsv"].contains(ext) { return "tablecells" }
            return "doc.text"
        }
    }
}
