import DexCore
import SwiftUI

/// A new chat: pick an agent or project (optional), a model, and write the first message. Sending creates the chat
/// and opens it.
struct NewChatView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var agentId: String?
    @State private var projectId: String?
    @State private var model: String?
    @State private var thinking: ThinkingLevel?
    @State private var mcpServers: [String]?
    @State private var starter = ""

    var body: some View {
        let state = client.state
        let agent = state?.agent(agentId)
        let project = state?.project(projectId)
        let effectiveModel = model ?? agent?.model ?? state?.settings.defaultModel ?? ""
        let effectiveThinking = thinking ?? agent?.thinking ?? state?.settings.defaultThinking ?? "low"
        let effectiveServers = mcpServers ?? agent?.mcpServers ?? state?.mcp.filter(\.defaultOn).map(\.id) ?? []

        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(greeting).font(.largeTitle.bold())
                    Text("What should Dex do?").font(.title3).foregroundStyle(.secondary)
                }
                .padding(.top, 12)

                if let projects = state?.projects, !projects.isEmpty {
                    PickerStrip(title: "Projects") {
                        ForEach(projects) { item in
                            ChoiceChip(selected: projectId == item.id) {
                                AgentAvatar(icon: item.icon, color: item.color, image: item.image, size: 24)
                                Text(item.name)
                            } action: {
                                projectId = projectId == item.id ? nil : item.id
                                if projectId != nil, starter.isEmpty || starter == agent?.starter { starter = item.starter }
                            }
                            .accessibilityIdentifier("newchat.project.\(item.id)")
                        }
                    }
                }
                if let agents = state?.agents, !agents.isEmpty {
                    PickerStrip(title: "Agents") {
                        ForEach(agents) { item in
                            ChoiceChip(selected: agentId == item.id) {
                                AgentAvatar(icon: item.icon, color: item.color, size: 24)
                                Text(item.name)
                            } action: {
                                agentId = agentId == item.id ? nil : item.id
                                model = nil
                                thinking = nil
                                mcpServers = nil
                                if let picked = state?.agent(agentId), starter.isEmpty || starter == project?.starter { starter = picked.starter }
                            }
                            .accessibilityIdentifier("newchat.agent.\(item.id)")
                        }
                    }
                }
                if let agent {
                    Text(agent.description).font(.footnote).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Composer(placeholder: "Message Dex, or / for skills…", disabled: !client.isConnected, initialText: starter, onSend: { text in
                try await start(text, model: effectiveModel, thinking: effectiveThinking, servers: effectiveServers)
            }) {
                ModelPickerButton(model: effectiveModel, thinking: effectiveThinking) { newModel, newThinking in
                    if let newModel { model = newModel }
                    if let newThinking { thinking = newThinking }
                }
                McpPickerButton(selected: effectiveServers) { mcpServers = $0 }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .frame(maxWidth: 784)
        }
        .navigationTitle("New Chat")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: applyDraft)
        .onChange(of: router.newChatDraft) { applyDraft() }
        .accessibilityIdentifier("newchat")
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        let name = client.viewer?.name.split(separator: " ").first.map(String.init) ?? ""
        let part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
        return name.isEmpty ? part : "\(part), \(name)"
    }

    private func applyDraft() {
        guard let draft = router.newChatDraft else { return }
        agentId = draft.agentId
        projectId = draft.projectId
        starter = draft.text.isEmpty ? (client.state?.project(draft.projectId)?.starter ?? client.state?.agent(draft.agentId)?.starter ?? "") : draft.text
        router.newChatDraft = nil
    }

    private func start(_ text: String, model: String, thinking: ThinkingLevel, servers: [String]) async throws {
        var options: [String: JSONValue] = ["model": .string(model), "thinking": .string(thinking), "mcpServers": .array(servers.map(JSONValue.string))]
        if let agentId { options["agentId"] = .string(agentId) }
        if let projectId { options["projectId"] = .string(projectId) }
        let session: SessionMeta = try await client.call("createSession", .object(options))
        let feed = client.chat(session.id)
        router.openChat(session.id)
        try await feed.send(text)
        agentId = nil
        projectId = nil
        self.model = nil
        self.thinking = nil
        mcpServers = nil
        starter = ""
    }
}

private struct PickerStrip<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { content }
                    .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }
}

private struct ChoiceChip<Label: View>: View {
    let selected: Bool
    @ViewBuilder var label: Label
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) { label }
                .font(.subheadline.weight(.medium))
                .padding(.leading, 6)
                .padding(.trailing, 12)
                .padding(.vertical, 6)
        }
        .buttonStyle(.glass)
        .tint(selected ? .accentColor : nil)
        .overlay(Capsule().strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 1.5))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: selected)
    }
}
