import DexCore
import SwiftUI

/// A new chat: start from a project (its VM and repos) and an agent (its role, model, and MCP servers), or neither,
/// pick a model, and write the first message. Picking one fills in its starter prompt. Sending creates the chat and
/// opens it.
struct NewChatView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var agentId: String?
    @State private var projectId: String?
    /// nil follows the defaults (Settings, or the agent).
    @State private var model: String?
    @State private var thinking: ThinkingLevel?
    /// nil follows the default: servers marked for new chats, or the agent's.
    @State private var mcpServers: [String]?
    @State private var composer = ComposerModel()
    @State private var error: String?

    var body: some View {
        let state = client.state
        let agent = state?.agent(agentId)
        let project = state?.project(projectId)
        let choice = effectiveChoice(agent: agent)
        let servers = mcpServers ?? agent?.mcpServers ?? state?.mcp.filter(\.defaultOn).map(\.id) ?? []

        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(heading(agent: agent, project: project))
                    .font(sizeClass == .compact ? .title2.bold() : .largeTitle.bold())
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .contentTransition(.opacity)
                    .animation(.smooth, value: heading(agent: agent, project: project))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("newchat.heading")

                if let state, !state.anyProviderConnected {
                    Button {
                        router.openSettings(.models)
                    } label: {
                        Label("Connect ClinePass, OpenCode Go, or ChatGPT in Settings so Dex can think.", systemImage: "key.fill")
                            .font(.subheadline)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(.orange.opacity(0.12), in: .rect(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("newchat.connect")
                }

                if let state {
                    if !state.projects.isEmpty {
                        section("Projects", manage: .page(.projects)) {
                            ChipFlowLayout(spacing: 8) {
                                ForEach(state.projects) { item in
                                    ProjectChip(project: item, selected: item.id == projectId) { pickProject(item) }
                                }
                                Button { router.open(.newProject, compact: sizeClass == .compact) } label: {
                                    Label("New Project", systemImage: "folder.badge.plus").font(.subheadline)
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .overlay(Capsule().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundStyle(.tertiary))
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("newchat.newProject")
                            }
                        }
                    }
                    section("Agents", manage: .page(.agents)) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .compact ? 150 : 220), spacing: 10)], spacing: 10) {
                            ForEach(state.agents) { item in
                                AgentCard(agent: item, selected: item.id == agentId, showsDescription: sizeClass != .compact) { pick(item) }
                            }
                            Button { router.open(.newAgent, compact: sizeClass == .compact) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "plus").frame(width: 32, height: 32)
                                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(.tertiary))
                                    Text("New Agent").font(.subheadline)
                                    Spacer(minLength: 0)
                                }
                                .padding(12)
                                .frame(maxHeight: .infinity)
                                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundStyle(.tertiary))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("newchat.newAgent")
                        }
                    }
                } else {
                    PickersSkeleton()
                }
            }
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 12)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("newchat")
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 8).accessibilityIdentifier("newchat.error")
                }
                Composer(model: composer, placeholder: agent.map { "Ask \($0.name)…" } ?? "Ask Dex to do anything…", disabled: !client.isConnected,
                         onSend: { text, attachments in try await start(text, attachments: attachments, model: choice.model, thinking: choice.thinking, servers: servers) },
                         header: (agent != nil || project != nil) ? AnyView(chips(agent: agent, project: project)) : nil) {
                    ModelPickerButton(model: choice.model, thinking: choice.thinking) { newModel, newThinking in
                        if let newModel { model = newModel }
                        if let newThinking { thinking = newThinking }
                    }
                    McpPickerButton(selected: servers) { mcpServers = $0 }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .frame(maxWidth: 800)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("New Chat")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: applyDraft)
        .onChange(of: router.newChatDraft) { applyDraft() }
    }

    private func heading(agent: AgentProfile?, project: ProjectProfile?) -> String {
        if let agent { return "What should \(agent.name) do\(project.map { " in \($0.name)" } ?? "")?" }
        if let project { return "What should Dex do in \(project.name)?" }
        return "What should Dex do?"
    }

    /// The model and thinking level: picked here, else the agent's, else Settings' default (on a connected subscription).
    private func effectiveChoice(agent: AgentProfile?) -> (model: String, thinking: ThinkingLevel) {
        let connected = client.state?.connectedProviders ?? [:]
        let base = agent.map { client.catalog.usableModel($0.model, connected: connected) }
            ?? client.catalog.usableModel(client.state?.settings.defaultModel ?? "", connected: connected)
        let chosen = model ?? base
        let level = thinking ?? agent?.thinking ?? client.state?.settings.defaultThinking ?? "low"
        return (chosen, client.catalog.model(chosen)?.clampThinking(level) ?? level)
    }

    private func section<Content: View>(_ title: String, manage: LibraryRoute, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Button { router.open(manage, compact: sizeClass == .compact) } label: { Label("Manage", systemImage: "slider.horizontal.3").font(.subheadline) }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("newchat.manage.\(title.lowercased())")
            }
            content()
        }
    }

    /// The picked project and agent, inside the message box, each with a way to drop it.
    private func chips(agent: AgentProfile?, project: ProjectProfile?) -> some View {
        HStack(spacing: 8) {
            if let project {
                PickedChip(name: project.name, label: "No project") {
                    AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 20)
                } remove: { projectId = nil }
                .accessibilityIdentifier("newchat.chip.project")
            }
            if let agent {
                PickedChip(name: agent.name, label: "Use no agent") {
                    AgentAvatar(icon: agent.icon, color: agent.color, size: 20)
                } remove: { pick(nil) }
                .accessibilityIdentifier("newchat.chip.agent")
            }
            Spacer(minLength: 0)
        }
    }

    private func pick(_ next: AgentProfile?) {
        mcpServers = nil
        model = nil
        thinking = nil
        guard let next, next.id != agentId else {
            agentId = nil
            return
        }
        agentId = next.id
        mcpServers = next.mcpServers
        composer.fill(next.starter)
    }

    /// A project and an agent combine: the project brings the VM and repos, the agent the role.
    private func pickProject(_ next: ProjectProfile?) {
        guard let next, next.id != projectId else {
            projectId = nil
            return
        }
        projectId = next.id
        if !next.starter.isEmpty, client.state?.agent(agentId)?.starter.isEmpty ?? true { composer.fill(next.starter) }
    }

    private func applyDraft() {
        guard let draft = router.newChatDraft else { return }
        router.newChatDraft = nil
        if let id = draft.projectId, let project = client.state?.project(id), id != projectId { pickProject(project) }
        if let id = draft.agentId, let agent = client.state?.agent(id), id != agentId { pick(agent) }
        if !draft.text.isEmpty { composer.fill(draft.text) }
    }

    private func start(_ text: String, attachments: [ChatAttachment], model: String, thinking: ThinkingLevel, servers: [String]) async throws {
        error = nil
        var options: [String: JSONValue] = ["model": .string(model), "thinking": .string(thinking), "mcpServers": .array(servers.map(JSONValue.string))]
        if let agentId { options["agentId"] = .string(agentId) }
        if let projectId { options["projectId"] = .string(projectId) }
        do {
            Notifications.shared.requestPermissionIfNeeded()
            let session: SessionMeta = try await client.call("createSession", .object(options))
            let feed = client.chat(session.id)
            router.openChat(session.id)
            try await feed.send(text, attachments: attachments)
            agentId = nil
            projectId = nil
            self.model = nil
            self.thinking = nil
            mcpServers = nil
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }
}

private struct ProjectChip: View {
    let project: ProjectProfile
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 24)
                Text(project.name).lineLimit(1)
                Text("\(project.repos.count) repo\(project.repos.count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            .padding(.leading, 2)
            .padding(.trailing, 6)
            .padding(.vertical, 2)
        }
        .buttonStyle(.glass)
        .tint(selected ? .accentColor : nil)
        .overlay(Capsule().strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 1.5))
        .accessibilityLabel("\(project.name) project, \(project.repos.count) repos")
        .accessibilityHint(project.description)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("newchat.project.\(project.id)")
        .sensoryFeedback(.selection, trigger: selected)
    }
}

private struct AgentCard: View {
    @Environment(DexClient.self) private var client
    let agent: AgentProfile
    let selected: Bool
    let showsDescription: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10) {
                AgentAvatar(icon: agent.icon, color: agent.color, size: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text(agent.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if showsDescription {
                        Text(agent.description.isEmpty ? "Custom agent" : agent.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2, reservesSpace: true)
                            .multilineTextAlignment(.leading)
                    }
                    HStack(spacing: 4) {
                        MakerLogo(maker: client.catalog.model(agent.model)?.maker ?? "", size: 11)
                        Text(client.catalog.name(of: agent.model)).lineLimit(1)
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(selected ? AnyShapeStyle(Color.accentColor.opacity(0.14)) : AnyShapeStyle(Color(.secondarySystemBackground)), in: .rect(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(selected ? Color.accentColor : Color.primary.opacity(0.06), lineWidth: selected ? 1.5 : 1))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .accessibilityLabel("\(agent.name) agent. \(agent.description)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("newchat.agent.\(agent.id)")
        .sensoryFeedback(.selection, trigger: selected)
    }
}

/// A picked agent or project in the message box, with ✕ to drop it.
private struct PickedChip<Icon: View>: View {
    let name: String
    let label: String
    @ViewBuilder var icon: Icon
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            icon
            Text(name).font(.caption.weight(.medium)).lineLimit(1)
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
        .padding(.leading, 3)
        .padding(.trailing, 6)
        .padding(.vertical, 3)
        .background(.quaternary.opacity(0.6), in: .capsule)
        .transition(.scale.combined(with: .opacity))
    }
}

/// The new chat's agents and projects while the state loads.
struct PickersSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LineBone(width: 80, font: .headline)
            HStack(spacing: 8) {
                Capsule().fill(.quaternary).frame(width: 120, height: 36)
                Capsule().fill(.quaternary).frame(width: 90, height: 36)
            }
            LineBone(width: 70, font: .headline).padding(.top, 8)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.quaternary.opacity(0.6)).frame(height: 64) }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// Lays out views in rows, wrapping to the next row when one is full (chips).
struct ChipFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
