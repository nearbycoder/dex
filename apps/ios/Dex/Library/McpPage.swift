import DexCore
import SwiftUI

/// MCP servers: remote tools for Dex. Each chat and agent picks the servers it uses; servers that are on for new
/// chats attach to plain new chats.
struct McpList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var removing: McpServerInfo?
    @State private var adding: McpPrefill?
    /// The server just added, opened once its sheet has gone.
    @State private var added: String?

    var body: some View {
        let servers = client.state?.mcp ?? []
        let unused = McpTemplate.all.filter { template in !servers.contains { $0.url == template.url } }
        List(selection: selection) {
            Section {
                NavigationLink(value: LibraryRoute.mcpSearch) {
                    Label("Find Servers", systemImage: "magnifyingglass")
                }
                .accessibilityIdentifier("mcp.search")
            }
            Section("Servers") {
                if client.state == nil {
                    ForEach(0..<3, id: \.self) { _ in LibraryRowSkeleton(avatar: false) }
                } else if servers.isEmpty {
                    EmptyStateView(title: "No MCP Servers", symbol: AppTab.mcp.symbol, message: "Find one, add a popular one below, or add one by URL.", actionTitle: "Add Server") {
                        open(.newMcpServer)
                    }
                    .libraryEmptyRow()
                }
                ForEach(servers) { server in
                    NavigationLink(value: LibraryRoute.mcpServer(server.id)) { McpServerRow(server: server) }
                        .accessibilityIdentifier("mcp.row.\(server.id)")
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            Button { setDefault(server, !server.defaultOn) } label: {
                                server.defaultOn ? Label("Off for New Chats", systemImage: "minus.circle") : Label("On for New Chats", systemImage: "plus.circle")
                            }
                            .tint(server.defaultOn ? .gray : .dexAccent)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { removing = server } label: { Label("Remove", systemImage: "trash") }
                            Button { reconnect(server) } label: { Label("Reconnect", systemImage: "arrow.clockwise") }.tint(.blue)
                        }
                        .contextMenu {
                            Button { reconnect(server) } label: {
                                server.status == "authenticating" ? Label("Sign In", systemImage: "person.badge.key") : Label("Reconnect", systemImage: "arrow.clockwise")
                            }
                            Toggle(isOn: Binding(get: { server.defaultOn }, set: { setDefault(server, $0) })) { Label("On for New Chats", systemImage: "plus.bubble") }
                            Divider()
                            Button(role: .destructive) { removing = server } label: { Label("Remove", systemImage: "trash") }
                        }
                }
            }
            if !unused.isEmpty && client.state != nil {
                Section {
                    ForEach(unused) { template in
                        Button { adding = McpPrefill(template: template) } label: { McpTemplateRow(template: template) }
                            .tint(.primary)
                            .accessibilityIdentifier("mcp.template.\(template.id)")
                    }
                } header: {
                    Text("Popular Servers")
                }
            }
        }
        .navigationTitle("MCP Servers")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { open(.newMcpServer) } label: { Label("Add by URL or Command", systemImage: "link") }
                    Button { open(.mcpSearch) } label: { Label("Find Servers", systemImage: "magnifyingglass") }
                } label: {
                    Label("Add Server", systemImage: "plus")
                } primaryAction: {
                    open(.newMcpServer)
                }
                .accessibilityIdentifier("mcp.new")
            }
        }
        .sheet(item: $adding, onDismiss: {
            if let id = added { added = nil; open(.mcpServer(id)) }
        }) { prefill in
            NavigationStack {
                McpServerEditor(existing: nil, prefill: prefill) { id in
                    added = id
                    adding = nil
                } onCancel: { adding = nil }
            }
        }
        .confirmationDialog("Remove “\(removing?.name ?? "")”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { server in
            Button("Remove Server", role: .destructive) {
                router.closeLibrary(.mcpServer(server.id))
                client.perform { try await client.deleteMcpServer(server.id) }
            }
        } message: { _ in
            Text("Chats and agents using it lose its tools, and its sign-in is forgotten.")
        }
        // The selected row (iPad): white text on the darker accent, readable in dark mode too.
        .tint(Color.selectionAccent)
        .accessibilityIdentifier("mcp.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }

    private func setDefault(_ server: McpServerInfo, _ on: Bool) {
        client.perform { try await client.setMcpServerDefault(server.id, on) }
    }

    private func reconnect(_ server: McpServerInfo) {
        client.perform {
            let result = try await client.connectMcpServer(server.id)
            if let authUrl = result.authUrl { _ = await McpSignIn.run(authUrl, serverId: server.id, client: client) }
            if !result.ok, let error = result.error { client.notice = error }
        }
    }
}

extension McpServerInfo {
    /// A local server's VM stops when idle; its dropped connection isn't a failure.
    func asleep(in state: DexState?) -> Bool {
        local != nil && status != "ready" && status != "connecting" && state?.vm(VmKeys.mcp)?.status != "running"
    }
}

struct McpServerRow: View {
    @Environment(DexClient.self) private var client
    let server: McpServerInfo

    var body: some View {
        let asleep = server.asleep(in: client.state)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(server.name).font(.body.weight(.medium)).lineLimit(1)
                if server.local != nil {
                    Tag(text: "Runs on VM", symbol: "desktopcomputer")
                } else if server.auth != "none" {
                    Tag(text: McpRegistry.authLabel(server.auth), symbol: server.auth == "oauth" ? "checkmark.shield" : "key")
                }
            }
            Text(server.local?.command ?? server.url).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            HStack(spacing: 6) {
                McpStatusDot(status: asleep ? "disconnected" : server.status)
                Text([asleep ? "Starts when a chat uses it" : server.statusLabel,
                      server.tools.isEmpty ? nil : "\(server.tools.count) \(server.tools.count == 1 ? "tool" : "tools")",
                      server.defaultOn ? "On for new chats" : nil].compactMap { $0 }.joined(separator: " · "))
            }
            .font(.caption)
            .foregroundStyle(server.status == "failed" && !asleep ? .red : .secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

struct McpTemplateRow: View {
    let template: McpTemplate

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(template.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Tag(text: McpRegistry.authLabel(template.auth))
                }
                Text(template.note).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Color.dexAccent)
        }
        .contentShape(.rect)
    }
}

/// A server's page: its state, tools, sign-in, and being on for new chats.
struct McpServerDetail: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let serverId: String
    @State private var editing = false
    @State private var confirmRemove = false
    @State private var busy = false
    @State private var message: String?

    private var server: McpServerInfo? { client.state?.mcp.first { $0.id == serverId } }

    var body: some View {
        Group {
            if client.state == nil {
                EditorSkeleton()
            } else if let server {
                content(server)
            } else {
                ContentUnavailableView("Server Not Found", systemImage: AppTab.mcp.symbol, description: Text("This server no longer exists."))
            }
        }
        .navigationTitle(server?.name ?? "MCP Server")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if server != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit") { editing = true }
                        .accessibilityIdentifier("mcp.edit")
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let server {
                NavigationStack {
                    McpServerEditor(existing: server, prefill: nil) { _ in editing = false } onCancel: { editing = false }
                }
            }
        }
        .confirmationDialog("Remove “\(server?.name ?? "")”?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Server", role: .destructive) {
                router.closeLibrary(.mcpServer(serverId))
                client.perform { try await client.deleteMcpServer(serverId) }
            }
        } message: {
            Text("Chats and agents using it lose its tools, and its sign-in is forgotten.")
        }
    }

    private func content(_ server: McpServerInfo) -> some View {
        let asleep = server.asleep(in: client.state)
        return List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(server.name).font(.title2.bold())
                        if server.local != nil { Tag(text: "Runs on VM", symbol: "desktopcomputer") } else { Tag(text: McpRegistry.authLabel(server.auth)) }
                    }
                    Text(server.local?.command ?? server.url).font(.callout.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    HStack(spacing: 6) {
                        McpStatusDot(status: asleep ? "disconnected" : server.status)
                        Text(asleep ? "Starts when a chat uses it" : server.status == "ready"
                             ? "\(server.statusLabel) · \(server.tools.count) \(server.tools.count == 1 ? "tool" : "tools")" : server.statusLabel)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("mcp.status")
                    if let error = server.error, server.status != "ready", !asleep {
                        FieldProblem(text: error)
                    }
                    if let message {
                        Text(message).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mcp.message")
                    }
                }
                .padding(.vertical, 4)
                if server.status == "authenticating" {
                    Button { Task { await connect(server) } } label: {
                        Label(busy ? "Signing In…" : "Sign In", systemImage: "person.badge.key").frame(maxWidth: .infinity)
                    }
                    .prominentButton()
                    .disabled(busy)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("mcp.signIn")
                }
            }

            Section {
                Toggle(isOn: Binding(get: { server.defaultOn }, set: { on in client.perform { try await client.setMcpServerDefault(server.id, on) } })) {
                    Label("On for New Chats", systemImage: "plus.bubble")
                }
                .accessibilityIdentifier("mcp.defaultOn")
            } footer: {
                Text("Attached to new chats that don't use an agent. Agents choose their own servers.")
            }

            if !server.tools.isEmpty {
                Section {
                    ForEach(server.tools, id: \.name) { tool in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tool.name).font(.callout.monospaced().weight(.medium))
                            if !tool.description.isEmpty { Text(tool.description).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                        }
                    }
                } header: {
                    Text("Tools")
                } footer: {
                    Text("Chats call them as \(server.prefix)__<tool>.")
                }
            }

            Section {
                if server.status != "authenticating" {
                    Button { Task { await connect(server) } } label: {
                        HStack {
                            Label("Reconnect", systemImage: "arrow.clockwise")
                            if busy { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("mcp.reconnect")
                }
                Button(role: .destructive) { confirmRemove = true } label: { Label("Remove Server", systemImage: "trash").foregroundStyle(.red) }
                    .accessibilityIdentifier("mcp.remove")
            }
        }
    }

    private func connect(_ server: McpServerInfo) async {
        busy = true
        message = nil
        defer { busy = false }
        do {
            let result = try await client.connectMcpServer(server.id)
            if let authUrl = result.authUrl {
                let ready = await McpSignIn.run(authUrl, serverId: server.id, client: client)
                message = ready ? "Signed in to \(server.name). Its tools are loading." : "Not signed in yet. Sign in again when you're ready."
            } else if !result.ok {
                message = result.error
            }
        } catch {
            client.notice = error.localizedDescription
        }
    }
}

/// What a new server's editor starts with: a popular server, a registry result, or nothing.
struct McpPrefill: Identifiable, Hashable {
    var name = ""
    var url = ""
    var auth = "none"
    var header: String?
    var headerPlaceholder: String?
    /// A registry package to run on the MCP VM, and the environment variables it reads.
    var command: String?
    var env: [String] = []
    var id: String { "\(name)|\(url)|\(command ?? "")" }

    init(name: String = "", url: String = "", auth: String = "none", header: String? = nil, headerPlaceholder: String? = nil, command: String? = nil, env: [String] = []) {
        self.name = name; self.url = url; self.auth = auth; self.header = header; self.headerPlaceholder = headerPlaceholder; self.command = command; self.env = env
    }

    init(template: McpTemplate) {
        self.init(name: template.name, url: template.url, auth: template.auth, header: template.header?.name, headerPlaceholder: template.header?.placeholder)
    }
}

/// Adding or editing a server: a remote URL (with no auth, headers, or OAuth) or a command run on the MCP VM.
struct McpServerEditor: View {
    @Environment(DexClient.self) private var client
    let existing: McpServerInfo?
    let prefill: McpPrefill?
    /// Called with the server's id once it's saved (and signed in, for OAuth).
    let onDone: (String) -> Void
    let onCancel: () -> Void

    struct Row: Identifiable, Equatable {
        let id = UUID()
        var name: String
        var value: String
        /// The server has a value for it: empty keeps it.
        var saved: Bool
    }

    @State private var savedId: String?
    @State private var name = ""
    @State private var kind = "remote"
    @State private var url = ""
    @State private var transport = "auto"
    @State private var auth = "none"
    @State private var headers: [Row] = []
    @State private var command = ""
    @State private var env: [Row] = []
    @State private var defaultOn = false
    @State private var loaded = false
    @State private var saving = false
    @State private var signingIn = false
    @State private var tried = false
    @State private var error: String?

    private var isNew: Bool { existing == nil && savedId == nil }
    private var urlProblem: String? {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return tried ? "Enter the server's URL." : nil }
        guard let parsed = URL(string: trimmed), parsed.host() != nil, ["https", "http"].contains(parsed.scheme ?? "") else { return "Enter the server's full URL, e.g. https://example.com/mcp." }
        return parsed.scheme == "https" ? nil : "MCP servers need an https:// URL."
    }
    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (kind == "local" ? !command.trimmingCharacters(in: .whitespaces).isEmpty : !url.trimmingCharacters(in: .whitespaces).isEmpty && urlProblem == nil)
    }

    var body: some View {
        Form {
            Section {
                Picker("Kind", selection: $kind) {
                    Text("Remote URL").tag("remote")
                    Text("Run on a VM").tag("local")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("mcp.kind")
            }

            Section {
                TextField("Name", text: $name, prompt: Text("GitHub"))
                    .accessibilityIdentifier("mcp.name")
                if kind == "remote" {
                    TextField("URL", text: $url, prompt: Text("https://example.com/mcp"))
                        .font(.body.monospaced())
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("mcp.url")
                }
            } footer: {
                if tried && name.trimmingCharacters(in: .whitespaces).isEmpty {
                    FieldProblem(text: "Give the server a name.")
                } else if kind == "remote", let urlProblem {
                    FieldProblem(text: urlProblem)
                }
            }

            if kind == "local" {
                localSections
            } else {
                remoteSections
            }

            Section {
                Toggle("On for New Chats", isOn: $defaultOn).accessibilityIdentifier("mcp.editor.defaultOn")
            } footer: {
                Text("Attach it to new chats that don't use an agent. Agents choose their own servers.")
            }

            if let error {
                Section { FieldProblem(text: error).accessibilityIdentifier("mcp.error") }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(existing.map { "Edit \($0.name)" } ?? "Add MCP Server")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(saving || signingIn)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel).accessibilityIdentifier("mcp.cancel")
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if saving || signingIn { ProgressView() } else { Text(saveTitle) }
                }
                .disabled(saving || signingIn)
                .keyboardShortcut("s", modifiers: .command)
                .accessibilityIdentifier("mcp.save")
            }
        }
        .onAppear(perform: load)
    }

    private var saveTitle: String {
        if kind == "remote" && auth == "oauth" && (isNew || existing?.status != "ready") { return "Sign In" }
        return isNew ? "Add" : "Save"
    }

    private var authHint: String {
        switch auth {
        case "headers": "Sent with every request: an API key, a bearer token, or any custom header."
        case "oauth": "After saving you sign in on the provider's page; Dex registers itself and keeps the token fresh."
        default: "For public servers that need no credentials."
        }
    }

    @ViewBuilder private var remoteSections: some View {
        Section {
            Picker("Authentication", selection: $auth) {
                Text("None").tag("none")
                Text("API Key").tag("headers")
                Text("OAuth").tag("oauth")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("mcp.auth")
        } header: {
            Text("Authentication")
        } footer: {
            Text(authHint)
        }

        if auth == "headers" {
            Section {
                ForEach($headers) { $row in
                    PairRow(name: $row.name, value: $row.value, namePrompt: "Authorization",
                            valuePrompt: row.saved ? "•••••••• saved" : (prefill?.headerPlaceholder ?? "Bearer sk-…"), nameCapitalization: .never,
                            identifier: "mcp.header.\(headers.firstIndex { $0.id == row.id } ?? 0)") {
                        row.saved = false
                    }
                }
                .onDelete { headers.remove(atOffsets: $0) }
                Button { headers.append(Row(name: "", value: "", saved: false)) } label: { Label("Add Header", systemImage: "plus") }
                    .accessibilityIdentifier("mcp.addHeader")
            } header: {
                Text("Headers")
            } footer: {
                Text("Values are encrypted and never shown again; leave a saved value empty to keep it.")
            }
        }

        Section {
            Picker("Transport", selection: $transport) {
                Text("Auto").tag("auto")
                Text("Streamable HTTP").tag("streamable-http")
                Text("SSE (Legacy)").tag("sse")
            }
            .accessibilityIdentifier("mcp.transport")
        } header: {
            Text("Advanced")
        } footer: {
            Text("Auto tries Streamable HTTP, then falls back to SSE.")
        }
    }

    @ViewBuilder private var localSections: some View {
        if prefill?.command != nil && existing == nil {
            Section {
                Label("This command was filled in for you. Check it before saving: it runs on your MCP VM, with the variables you give it.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
        Section {
            TextField("Command", text: $command, prompt: Text("npx -y @modelcontextprotocol/server-everything"), axis: .vertical)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("mcp.command")
        } header: {
            Text("Command")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if client.state?.vmConfigured == false { FieldProblem(text: "Needs a boat.dev account: connect one in Settings → Cloud VMs.") }
                if tried && command.trimmingCharacters(in: .whitespaces).isEmpty { FieldProblem(text: "Enter the command that starts the server.") }
                Text("Starts a stdio MCP server, e.g. npx -y <package>, uvx <package>, or docker run -i <image>. The MCP VM stops when idle and starts again when a chat needs it.")
            }
        }
        Section {
            ForEach($env) { $row in
                PairRow(name: $row.name, value: $row.value, namePrompt: "API_KEY", valuePrompt: row.saved ? "•••••••• saved" : "Value", nameCapitalization: .characters,
                        identifier: "mcp.env.\(env.firstIndex { $0.id == row.id } ?? 0)") {
                    row.saved = false
                }
            }
            .onDelete { env.remove(atOffsets: $0) }
            Button { env.append(Row(name: "", value: "", saved: false)) } label: { Label("Add Variable", systemImage: "plus") }
                .accessibilityIdentifier("mcp.addEnv")
        } header: {
            Text("Environment")
        } footer: {
            Text("Only these variables reach the server. Values are encrypted and never shown again; leave one empty to keep its saved value, or to use the saved secret of the same name.")
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let existing {
            name = existing.name
            url = existing.url
            transport = existing.transport
            auth = existing.auth
            defaultOn = existing.defaultOn
            headers = existing.headerNames.map { Row(name: $0, value: "", saved: true) }
            if headers.isEmpty { headers = [Row(name: "Authorization", value: "", saved: false)] }
            kind = existing.local == nil ? "remote" : "local"
            command = existing.local?.command ?? ""
            env = existing.local?.envNames.map { Row(name: $0, value: "", saved: true) } ?? []
        } else {
            let prefill = prefill ?? McpPrefill()
            name = prefill.name
            url = prefill.url
            auth = prefill.auth
            headers = [Row(name: prefill.header ?? "Authorization", value: "", saved: false)]
            kind = prefill.command == nil ? "remote" : "local"
            command = prefill.command ?? ""
            env = prefill.env.map { Row(name: $0, value: "", saved: false) }
        }
    }

    private func save() async {
        tried = true
        guard valid else { return }
        saving = true
        error = nil
        defer { saving = false }
        let id = existing?.id ?? savedId
        let draft = kind == "local"
            ? McpServerDraft(id: id, name: name, local: .init(command: command, env: env.filter { !$0.name.isEmpty }.map { NameValue(name: $0.name, value: $0.value) }), defaultOn: defaultOn)
            : McpServerDraft(id: id, name: name, url: url.trimmingCharacters(in: .whitespaces), transport: transport, auth: auth,
                             headers: auth == "headers" ? headers.map { NameValue(name: $0.name, value: $0.value) } : [], defaultOn: defaultOn)
        do {
            let result = try await client.saveMcpServer(draft)
            guard result.ok, let serverId = result.id else {
                error = result.error ?? "Couldn't save the server."
                // Saved but couldn't connect: keep editing the saved server.
                if let saved = result.id { savedId = saved }
                return
            }
            savedId = serverId
            if let authUrl = result.authUrl {
                signingIn = true
                let ready = await McpSignIn.run(authUrl, serverId: serverId, client: client)
                signingIn = false
                if !ready { error = "Not signed in yet. Sign in from the server's page when you're ready." }
            }
            onDone(serverId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A header or environment variable: its name and a secret value.
private struct PairRow: View {
    @Binding var name: String
    @Binding var value: String
    let namePrompt: String
    let valuePrompt: String
    let nameCapitalization: TextInputAutocapitalization
    let identifier: String
    let onRename: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            TextField("Name", text: $name, prompt: Text(namePrompt))
                .font(.callout.monospaced())
                .textInputAutocapitalization(nameCapitalization)
                .autocorrectionDisabled()
                .frame(maxWidth: 160)
                .onChange(of: name) { onRename() }
                .accessibilityIdentifier("\(identifier).name")
            Divider()
            SecureField("Value", text: $value, prompt: Text(valuePrompt))
                .font(.callout.monospaced())
                // An API key, not a password: keeps iOS from offering to save it to Passwords.
                .textContentType(.oneTimeCode)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("\(identifier).value")
        }
    }
}

/// The `.newMcpServer` route: the editor, which becomes the server's page once added.
struct NewMcpServerPage: View {
    @Environment(Router.self) private var router

    var body: some View {
        McpServerEditor(existing: nil, prefill: nil) { id in
            router.replaceLibrary(.newMcpServer, with: .mcpServer(id))
        } onCancel: {
            router.closeLibrary(.newMcpServer)
        }
        .navigationBarBackButtonHidden()
    }
}
