import DexCore
import SwiftUI

/// One workspace file: Markdown rendered, HTML previewed live, other text in a monospaced view, and an editor.
struct FileDetailView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(FilesModel.self) private var model
    let path: String
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var confirmDone = false
    @State private var saved = 0
    @FocusState private var editorFocused: Bool

    private var kind: Workspace.PreviewKind? { Workspace.previewKind(path) }

    var body: some View {
        @Bindable var model = model
        content
            .navigationTitle(Workspace.name(of: path))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarTitleMenu {
                Text(path)
                Button("Copy Path", systemImage: "doc.on.doc") { UIPasteboard.general.string = path }
            }
            .toolbar { toolbar }
            .task(id: TaskKey(path: path, connected: client.isConnected)) { await model.load(path, client: client) }
            .confirmationDialog("Delete \(Workspace.relative(path))?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    client.perform {
                        try await model.delete(path, client: client)
                        router.file = nil
                    }
                }
                .accessibilityIdentifier("file.confirmDelete")
            }
            .confirmationDialog("You have unsaved changes.", isPresented: $confirmDone, titleVisibility: .visible) {
                Button("Save") { Task { await save(); editing = false } }
                Button("Discard Changes", role: .destructive) {
                    model.discard()
                    editing = false
                }
                .accessibilityIdentifier("file.discardChanges")
            }
            .sensoryFeedback(.success, trigger: saved)
    }

    private struct TaskKey: Equatable { let path: String; let connected: Bool }

    @ViewBuilder
    private var content: some View {
        @Bindable var model = model
        if let open = model.open, open.path == path {
            if open.content == nil {
                ContentUnavailableView("Binary File", systemImage: "doc.zipper", description: Text("\(Format.bytes(open.size)). Dex can't show it here."))
            } else if editing {
                TextEditor(text: Binding(get: { model.open?.draft ?? "" }, set: { model.open?.draft = $0 }))
                    .font(.callout.monospaced())
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .scrollDismissesKeyboard(.interactively)
                    .focused($editorFocused)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("file.editor")
            } else {
                switch kind {
                case .markdown:
                    ScrollView {
                        MarkdownView(text: open.draft) { url in openLink(url) }
                            .padding(20)
                            .frame(maxWidth: 760)
                            .frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("file.markdown")
                case .html:
                    HTMLPreview(html: open.draft)
                        .ignoresSafeArea(edges: .bottom)
                        .accessibilityIdentifier("file.html")
                case nil:
                    ScrollView([.vertical]) {
                        Text(open.draft.isEmpty ? " " : open.draft)
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                    }
                    .overlay {
                        if open.draft.isEmpty {
                            ContentUnavailableView("Empty File", systemImage: "doc", description: Text("Tap Edit to write in it."))
                        }
                    }
                    .accessibilityIdentifier("file.text")
                }
            }
        } else if let error = model.openError {
            ContentUnavailableView {
                Label("Couldn't Open", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Try Again") { Task { await model.load(path, client: client) } }
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach([240, 300, 180, 260, 220, 140] as [CGFloat], id: \.self) { LineBone(width: $0) }
                Spacer()
            }
            .padding(20)
            .accessibilityIdentifier("file.loading")
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let open = model.open, open.path == path, open.content != nil {
            ToolbarItemGroup(placement: .primaryAction) {
                if editing {
                    Button {
                        Task { await save() }
                    } label: {
                        Label("Save", systemImage: "square.and.arrow.down")
                    }
                    .disabled(!model.dirty)
                    .keyboardShortcut("s", modifiers: .command)
                    .accessibilityIdentifier("file.save")
                    Button {
                        if model.dirty { confirmDone = true } else { editing = false }
                    } label: {
                        Text("Done").fontWeight(.semibold)
                    }
                    .keyboardShortcut("e", modifiers: .command)
                    .accessibilityIdentifier("file.done")
                } else {
                    Button {
                        editing = true
                        editorFocused = true
                    } label: {
                        Label(kind == nil ? "Edit" : "Edit Source", systemImage: "pencil")
                    }
                    .keyboardShortcut("e", modifiers: .command)
                    .accessibilityIdentifier("file.edit")
                }
            }
            ToolbarItemGroup(placement: .secondaryAction) {
                if let url = model.exportURL {
                    ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                Button("Reload", systemImage: "arrow.clockwise") { Task { await model.reload(client: client) } }
                Button("Copy Path", systemImage: "doc.on.doc") { UIPasteboard.general.string = path }
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    .keyboardShortcut(.delete, modifiers: .command)
                    .accessibilityIdentifier("file.delete")
            }
        } else if model.open?.path == path {
            ToolbarItem(placement: .secondaryAction) {
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
            }
        }
    }

    private func save() async {
        do {
            try await model.save(client: client)
            saved += 1
        } catch {
            client.notice = error.localizedDescription
        }
    }

    /// Links between workspace files open here; others open in the browser.
    private func openLink(_ url: URL) {
        if url.scheme == nil || url.scheme == "file" {
            let base = (path as NSString).deletingLastPathComponent
            router.openFile(Workspace.resolve(url.path().hasPrefix("/") ? url.path() : "\(base)/\(url.path())"))
        } else if url.scheme == "dex" {
            _ = router.handle(url)
        } else {
            UIApplication.shared.open(url)
        }
    }
}
