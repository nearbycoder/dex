import DexCore
import SwiftUI

/// Agents: presets for a job (instructions, a model and thinking level, MCP servers). Pick one when starting a chat.
struct AgentsList: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var selection: Binding<LibraryRoute?>?
    @State private var filter = ""
    @State private var deleting: AgentProfile?

    var body: some View {
        let agents = (client.state?.agents ?? []).filter { filter.isEmpty || $0.name.localizedCaseInsensitiveContains(filter) || $0.description.localizedCaseInsensitiveContains(filter) }
        List(selection: selection) {
            if client.state == nil {
                ForEach(0..<4, id: \.self) { _ in LibraryRowSkeleton() }
            } else if client.state?.agents.isEmpty == true {
                EmptyStateView(title: "No Agents", symbol: AppTab.agents.symbol, message: "Agents are presets for a job: instructions, a model, and tools.", actionTitle: "New Agent") {
                    open(.newAgent)
                }
                .libraryEmptyRow()
            } else if agents.isEmpty {
                ContentUnavailableView.search(text: filter).libraryEmptyRow()
            }
            ForEach(agents) { agent in
                NavigationLink(value: LibraryRoute.agent(agent.id)) {
                    AgentRow(agent: agent, chats: chatCount(agent.id))
                }
                .accessibilityIdentifier("agent.row.\(agent.id)")
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button { router.newChat(agentId: agent.id) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                        .tint(.accentColor)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { deleting = agent } label: { Label("Delete", systemImage: "trash") }
                }
                .contextMenu {
                    Button { router.newChat(agentId: agent.id) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                    Button { open(.agent(agent.id)) } label: { Label("Edit", systemImage: "pencil") }
                    Divider()
                    Button(role: .destructive) { deleting = agent } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .searchable(text: $filter, prompt: "Search agents")
        .navigationTitle("Agents")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { open(.newAgent) } label: { Label("New Agent", systemImage: "plus") }
                    .accessibilityIdentifier("agents.new")
            }
        }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { agent in
            Button("Delete Agent", role: .destructive) {
                router.closeLibrary(.agent(agent.id))
                client.perform { try await client.deleteAgent(agent.id) }
            }
        } message: { _ in
            Text("Its chats stay, as plain chats.")
        }
        .accessibilityIdentifier("agents.list")
    }

    private func open(_ route: LibraryRoute) {
        if let selection { selection.wrappedValue = route } else { router.open(route, compact: true) }
    }

    private func chatCount(_ id: String) -> Int { client.state?.sessions.filter { $0.agentId == id }.count ?? 0 }
}

struct AgentRow: View {
    @Environment(DexClient.self) private var client
    let agent: AgentProfile
    let chats: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AgentAvatar(icon: agent.icon, color: agent.color, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(agent.name).font(.body.weight(.medium)).lineLimit(1)
                Text(agent.description.isEmpty ? "Custom agent" : agent.description)
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 5) {
                    MakerLogo(maker: client.catalog.model(agent.model)?.maker ?? "", size: 12)
                    Text(client.catalog.name(of: agent.model))
                    Text("·")
                    Text("\(ThinkingLevels.label(agent.thinking)) thinking")
                    Text("·")
                    Text(chats == 1 ? "1 chat" : "\(chats) chats")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.top, 1)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// An agent's editor (or a new agent's): a form saved with ⌘S or the toolbar.
struct AgentEditor: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    let agentId: String?
    @State private var draft: AgentDraft?
    @State private var original: AgentDraft?
    @State private var saving = false
    @State private var saved = 0
    @State private var error: String?
    @State private var tried = false
    @State private var pickingModel = false
    @State private var confirmDelete = false

    private var existing: AgentProfile? { client.state?.agent(agentId) }
    private var isNew: Bool { agentId == nil }
    private var dirty: Bool { draft != original }

    var body: some View {
        Group {
            if client.state == nil {
                EditorSkeleton()
            } else if !isNew && existing == nil {
                ContentUnavailableView("Agent Not Found", systemImage: AppTab.agents.symbol, description: Text("This agent no longer exists."))
            } else if let current = draft {
                // Not a force-unwrapped Binding($draft): a text field ending editing can read it after the draft
                // is replaced.
                form(Binding(get: { draft ?? current }, set: { draft = $0 }))
            } else {
                EditorSkeleton()
            }
        }
        .navigationTitle(draft.map { $0.name.isEmpty ? (isNew ? "New Agent" : "Untitled") : $0.name } ?? "Agent")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .navigationBarBackButtonHidden(isNew)
        .onAppear(perform: load)
        .onChange(of: client.state != nil) { load() }
        .onChange(of: existing?.updatedAt) {
            // Changed elsewhere (or just saved): show it, unless there are edits here.
            if !dirty, let existing { draft = AgentDraft(existing); original = draft }
        }
        .sensoryFeedback(.success, trigger: saved)
        .interactiveDismissDisabled(dirty)
    }

    private func load() {
        guard draft == nil, let state = client.state else { return }
        let loaded = existing.map(AgentDraft.init) ?? (isNew ? AgentDraft(model: state.settings.defaultModel, thinking: state.settings.defaultThinking) : nil)
        draft = loaded
        original = loaded
    }

    @ViewBuilder
    private func form(_ draft: Binding<AgentDraft>) -> some View {
        let value = draft.wrappedValue
        let nameMissing = (tried || !value.name.isEmpty || original?.name.isEmpty == false) && !value.isValid
        Form {
            Section {
                ProfileHeader(icon: value.icon, color: value.color, title: value.name.isEmpty ? (isNew ? "New Agent" : "Untitled") : value.name,
                              subtitle: value.description.isEmpty ? "Describe what this agent is for" : value.description)
            }

            Section {
                TextField("Name", text: draft.name, prompt: Text("PR Reviewer"))
                    .font(.body.weight(.medium))
                    .accessibilityIdentifier("agent.name")
                TextField("Description", text: draft.description, prompt: Text("Reviews pull requests for bugs"))
                    .accessibilityIdentifier("agent.description")
            } footer: {
                if nameMissing { FieldProblem(text: "Give the agent a name.") }
            }

            Section("Icon") {
                IconGrid(selection: draft.icon, color: value.color)
            }
            Section("Color") {
                ColorRow(selection: draft.color)
            }

            Section {
                Button {
                    pickingModel = true
                } label: {
                    HStack(spacing: 10) {
                        MakerLogo(maker: client.catalog.model(value.model)?.maker ?? "", size: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(client.catalog.name(of: value.model)).foregroundStyle(.primary)
                            Text("\(ThinkingLevels.label(value.thinking)) thinking").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityIdentifier("agent.model")
            } header: {
                Text("Model and Thinking")
            } footer: {
                Text("New chats with this agent start with these; you can still change them per chat.")
            }

            Section {
                let servers = client.state?.mcp ?? []
                if servers.isEmpty {
                    Button("Connect an MCP Server") { router.open(.newMcpServer, compact: sizeClass == .compact) }
                } else {
                    ForEach(servers) { server in
                        Toggle(isOn: Binding(get: { draft.wrappedValue.mcpServers.contains(server.id) }, set: { on in
                            draft.wrappedValue.mcpServers = on ? draft.wrappedValue.mcpServers + [server.id] : draft.wrappedValue.mcpServers.filter { $0 != server.id }
                        })) {
                            HStack(spacing: 8) {
                                McpStatusDot(status: server.status)
                                Text(server.name)
                                Text(server.statusLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityIdentifier("agent.mcp.\(server.id)")
                    }
                }
            } header: {
                Text("MCP Servers")
            } footer: {
                Text("Attached to new chats with this agent; you can still change them per chat.")
            }

            Section {
                LongTextField(title: "Instructions", text: draft.instructions, prompt: "You review pull requests like a careful senior engineer.\n1. …", monospaced: true, lines: 6...18)
                    .accessibilityIdentifier("agent.instructions")
            } header: {
                Text("Instructions")
            } footer: {
                Text("The agent's role and workflow, added to the system prompt of its chats. Edits apply to existing chats too.")
            }

            Section {
                TextField("Starter prompt", text: draft.starter, prompt: Text("Review https://github.com/OWNER/REPO/pull/"), axis: .vertical)
                    .accessibilityIdentifier("agent.starter")
            } header: {
                Text("Starter Prompt")
            } footer: {
                Text("Prefilled in the message box when you pick this agent.")
            }

            if let error {
                Section { FieldProblem(text: error) }
            }

            if let agentId, existing != nil {
                Section {
                    Button { router.newChat(agentId: agentId) } label: { Label("Start Chat", systemImage: "plus.bubble") }
                        .accessibilityIdentifier("agent.startChat")
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Agent", systemImage: "trash") }
                        .accessibilityIdentifier("agent.delete")
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $pickingModel) {
            ModelPickerSheet(model: value.model, thinking: value.thinking) { model, thinking in
                if let model {
                    draft.wrappedValue.model = model
                    if let picked = client.catalog.model(model) { draft.wrappedValue.thinking = picked.clampThinking(draft.wrappedValue.thinking) }
                }
                if let thinking { draft.wrappedValue.thinking = thinking }
            }
            .presentationDetents([.large])
        }
        .confirmationDialog("Delete “\(value.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Agent", role: .destructive) {
                guard let agentId else { return }
                router.closeLibrary(.agent(agentId))
                client.perform { try await client.deleteAgent(agentId) }
            }
        } message: {
            Text("Its chats stay, as plain chats.")
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isNew {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { router.closeLibrary(.newAgent) }
                    .accessibilityIdentifier("agent.cancel")
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button {
                Task { await save() }
            } label: {
                if saving { ProgressView() } else { Text(isNew ? "Create" : "Save") }
            }
            .disabled(saving || draft == nil || (!isNew && !dirty))
            .keyboardShortcut("s", modifiers: .command)
            .accessibilityIdentifier("agent.save")
        }
    }

    private func save() async {
        guard let draft else { return }
        tried = true
        guard draft.isValid else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let agent = try await client.saveAgent(draft)
            let fresh = AgentDraft(agent)
            self.draft = fresh
            original = fresh
            saved += 1
            if isNew { router.replaceLibrary(.newAgent, with: .agent(agent.id)) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
