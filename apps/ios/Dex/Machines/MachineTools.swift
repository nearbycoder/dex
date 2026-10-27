import DexCore
import SwiftUI

/// Read-only looks inside a running VM (`vmPeek`): a folder, git status, listening ports, and the busiest processes.
/// Never starts or wakes the VM.
struct InspectView: View {
    @Environment(DexClient.self) private var client
    let vm: VmInfo
    /// Exposes a listening port (it opens the Ports panel with the URL).
    let onExpose: (Int) -> Void

    enum Look: String, CaseIterable, Identifiable {
        case files, git, ports, processes
        var id: String { rawValue }
        var title: String {
            switch self {
            case .files: "Files"
            case .git: "Git"
            // The machine page has a Ports panel of its own (for sharing one); these are the ports in use.
            case .ports: "Listening"
            case .processes: "Processes"
            }
        }
        var view: VmPeekView {
            switch self {
            case .files: .files
            case .git: .git
            case .ports: .ports
            case .processes: .processes
            }
        }
    }

    @SceneStorage("machine.inspect") private var look: Look = .files
    @State private var path = VmPaths.work
    @State private var gitPath = VmPaths.work
    @State private var result: VmPeekResult?
    @State private var loading = false
    @State private var error: String?
    @State private var generation = 0
    @State private var openFile: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("View", selection: $look) {
                ForEach(Look.allCases) { look in Text(look.title).tag(look) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("inspect.picker")

            if look == .files || look == .git {
                pathBar
            }
            content
        }
        .task(id: TaskKey(look: look, path: look == .git ? gitPath : path, running: vm.isRunning, generation: generation)) { await load() }
        .sheet(item: Binding(get: { openFile.map(FileRef.init) }, set: { openFile = $0?.path })) { file in
            FilePeekSheet(vmKey: vm.key, path: file.path)
        }
    }

    private struct TaskKey: Hashable {
        var look: Look
        var path: String
        var running: Bool
        var generation: Int
    }

    private struct FileRef: Identifiable {
        let path: String
        var id: String { path }
    }

    private var pathBar: some View {
        HStack(spacing: 8) {
            let current = look == .git ? gitPath : path
            Button {
                if let parent = VmPaths.parent(current) { setPath(parent) }
            } label: {
                Image(systemName: "chevron.up")
            }
            .disabled(VmPaths.parent(current) == nil)
            .accessibilityLabel("Enclosing Folder")
            .accessibilityIdentifier("inspect.up")
            Text(current)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.head)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("inspect.path")
            Button {
                generation += 1
            } label: {
                if loading { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
            }
            .accessibilityLabel("Refresh")
            .accessibilityIdentifier("inspect.refresh")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.background.secondary, in: .capsule)
    }

    private func setPath(_ next: String) {
        if look == .git { gitPath = next } else { path = next }
    }

    @ViewBuilder
    private var content: some View {
        if let result, !result.running {
            Label(vm.status == "starting" ? "The VM is starting…" : "Start the VM to look inside. Looking never wakes it.", systemImage: "moon.zzz")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 80)
                .accessibilityIdentifier("inspect.notRunning")
        } else if let error {
            Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red)
        } else if let result, result.view == look.view {
            switch look {
            case .files: files(result)
            case .git: git(result)
            case .ports: ports(result)
            case .processes: processes(result)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(0..<4, id: \.self) { _ in LineBone(font: .footnote) }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: Views

    private func files(_ result: VmPeekResult) -> some View {
        rows(result.sortedEntries, empty: "This folder is empty or doesn't exist.") { entry in
            Button {
                let full = VmPaths.join(result.path ?? path, entry.name)
                if entry.isDirectory { path = full } else { openFile = full }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: entry.isDirectory ? "folder.fill" : entry.type == "link" ? "link" : "doc")
                        .foregroundStyle(entry.isDirectory ? Color.accentColor : .secondary)
                        .frame(width: 22)
                    Text(entry.name).font(.callout).lineLimit(1)
                    Spacer()
                    if !entry.isDirectory { Text(Format.bytes(entry.size)).font(.caption).foregroundStyle(.secondary) }
                    Text(Format.ago(entry.modifiedAt)).font(.caption).foregroundStyle(.tertiary)
                    if entry.isDirectory { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityIdentifier("inspect.file.\(entry.name)")
        }
    }

    @ViewBuilder
    private func git(_ result: VmPeekResult) -> some View {
        if result.repo == false {
            VStack(alignment: .leading, spacing: 6) {
                Text("Not a git repository. Open a repo's folder (in Files) or go up.").font(.footnote).foregroundStyle(.secondary)
                if let error = result.error { Text(error).font(.caption.monospaced()).foregroundStyle(.secondary) }
            }
            .accessibilityIdentifier("inspect.git.notRepo")
        } else {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.branch")
                    Text(result.branch ?? "").font(.callout.monospaced().weight(.semibold))
                    if let tracking = result.tracking { Text("→ \(tracking)").font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("inspect.git.branch")
                section("Changes") {
                    rows(result.changes, empty: "No uncommitted changes.") { change in
                        HStack(spacing: 10) {
                            Text(change.status)
                                .font(.caption.monospaced().weight(.bold))
                                .foregroundStyle(change.status.hasPrefix("?") ? Color.secondary : change.status.hasPrefix("D") ? .red : .orange)
                                .frame(width: 24, alignment: .leading)
                            Text(change.path).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle)
                            Spacer()
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(change.label): \(change.path)")
                    }
                }
                section("Recent Commits") {
                    rows(result.commits, empty: "No commits yet.") { commit in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(commit.subject).font(.callout).lineLimit(2)
                            Text("\(commit.hash) · \(commit.author) · \(Format.ago(commit.at))").font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func ports(_ result: VmPeekResult) -> some View {
        rows(result.ports, empty: "Nothing is listening.") { port in
            HStack(spacing: 10) {
                Text(String(port.port)).font(.callout.monospaced().weight(.semibold)).frame(minWidth: 52, alignment: .leading)
                VStack(alignment: .leading, spacing: 1) {
                    Text(port.process ?? "Unknown process").font(.callout)
                    Text(port.address).font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Get URL") { onExpose(port.port) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityIdentifier("inspect.port.\(port.port)")
            }
        }
    }

    private func processes(_ result: VmPeekResult) -> some View {
        rows(result.processes, empty: "No processes.") { process in
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(process.command).font(.callout.monospaced()).lineLimit(1)
                    Text("PID \(process.pid) · up \(Format.duration(process.seconds * 1000))").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(String(format: "%.1f%% CPU", process.cpu)).font(.caption.monospacedDigit())
                    Text(String(format: "%.1f%% mem", process.memory)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            content()
        }
    }

    private func rows<Item: Identifiable, Row: View>(_ items: [Item], empty: String, @ViewBuilder row: @escaping (Item) -> Row) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
                Text(empty).font(.footnote).foregroundStyle(.secondary).padding(.vertical, 6)
            }
            ForEach(items) { item in
                row(item).padding(.vertical, 8)
                if item.id != items.last?.id { Divider() }
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let next = try await client.vmPeek(vm.key, view: look.view, path: look == .git ? gitPath : path)
            guard !Task.isCancelled else { return }
            result = next
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

/// The end of a file on the VM.
struct FilePeekSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let vmKey: String
    let path: String
    @State private var content: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let content {
                    ScrollView([.vertical, .horizontal]) {
                        Text(content.isEmpty ? "(empty)" : content)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("filePeek.content")
                    }
                } else if let error {
                    EmptyStateView(title: "Couldn't read the file", symbol: "doc.questionmark", message: error)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle((path as NSString).lastPathComponent)
            .navigationSubtitle("Last 200 lines")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("filePeek.done") }
                if let content {
                    ToolbarItem(placement: .primaryAction) { ShareLink(item: content) }
                }
            }
        }
        .task {
            do {
                let result = try await client.vmPeek(vmKey, view: .file, path: path, lines: 200)
                if result.running { content = result.content ?? "" } else { error = "The VM isn't running." }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// Opens a port on the VM to the web (`vmExposePort`): the URL, to open, copy, or share.
struct PortsView: View {
    @Environment(DexClient.self) private var client
    let vm: VmInfo
    @Binding var port: String
    @Binding var exposed: ExposedPort?
    @State private var working = false
    @State private var copied = false
    @FocusState private var focused: Bool

    struct ExposedPort: Equatable {
        var port: Int
        var url: String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Get a URL for a server running on the VM, like a dev server on port 3000. It's behind your Dex sign-in.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                TextField("3000", text: $port)
                    // iPad shows a number pad as a popover that eats the next tap (on Get URL); its full keyboard's
                    // numbers have Return, which submits.
                    .keyboardType(UIDevice.current.userInterfaceIdiom == .pad ? .numbersAndPunctuation : .numberPad)
                    .submitLabel(.go)
                    .font(.body.monospacedDigit())
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: 120)
                    .background(.background.secondary, in: .capsule)
                    .onSubmit(expose)
                    .accessibilityIdentifier("ports.field")
                Button(action: expose) {
                    if working { ProgressView().controlSize(.small) } else { Text("Get URL") }
                }
                .buttonStyle(.glassProminent)
                .disabled(PortURL.parse(port) == nil || working)
                .accessibilityIdentifier("ports.expose")
            }
            if let exposed {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Port \(String(exposed.port))", systemImage: "network").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(PortURL.display(exposed.url))
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                        .lineLimit(2)
                        .accessibilityIdentifier("ports.url")
                    HStack(spacing: 8) {
                        Button {
                            if let url = URL(string: exposed.url) { InAppBrowser.open(url) }
                        } label: { Label("Open", systemImage: "safari") }
                            .accessibilityIdentifier("ports.open")
                        Button {
                            UIPasteboard.general.string = exposed.url
                            copied = true
                        } label: { Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") }
                            .accessibilityIdentifier("ports.copy")
                        if let url = URL(string: exposed.url) {
                            ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                                .accessibilityIdentifier("ports.share")
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .sensoryFeedback(.success, trigger: copied) { _, new in new }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.green.opacity(0.08), in: .rect(cornerRadius: 14))
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(2))
                    copied = false
                }
            }
        }
        .animation(.smooth, value: exposed)
    }

    private func expose() {
        guard let number = PortURL.parse(port) else { return }
        focused = false
        working = true
        let key = vm.key
        Task {
            defer { working = false }
            do {
                exposed = ExposedPort(port: number, url: try await client.vmExposePort(key, port: number))
            } catch {
                client.notice = error.localizedDescription
            }
        }
    }
}
