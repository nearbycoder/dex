import DexCore
import SwiftUI

/// The model button: names the model and thinking level; opens the searchable model sheet.
struct ModelPickerButton: View {
    @Environment(DexClient.self) private var client
    let model: String
    let thinking: ThinkingLevel
    let onChange: (_ model: String?, _ thinking: ThinkingLevel?) -> Void
    @State private var showing = false

    var body: some View {
        Button {
            showing = true
        } label: {
            HStack(spacing: 5) {
                MakerLogo(maker: client.catalog.model(model)?.maker ?? "", size: 14)
                Text(client.catalog.name(of: model)).lineLimit(1)
                if thinking != "off" {
                    Text(ThinkingLevels.label(thinking)).foregroundStyle(.secondary)
                }
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .buttonStyle(.glass)
        .accessibilityIdentifier("composer.model")
        .sheet(isPresented: $showing) {
            ModelPickerSheet(model: model, thinking: thinking, onChange: onChange)
                .presentationDetents([.medium, .large])
        }
    }
}

/// Pick a model (All / ClinePass / OpenCode Go, searchable) and a thinking level.
struct ModelPickerSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    let model: String
    let thinking: ThinkingLevel
    let onChange: (_ model: String?, _ thinking: ThinkingLevel?) -> Void
    @State private var provider = "all"
    @State private var search = ""

    var body: some View {
        NavigationStack {
            let current = client.catalog.model(model)
            List {
                if let current, current.supportedThinkingLevels.count > 1 {
                    Section("Thinking") {
                        Picker("Thinking", selection: Binding(get: { current.clampThinking(thinking) }, set: { onChange(nil, $0) })) {
                            ForEach(current.supportedThinkingLevels, id: \.self) { level in
                                Text(ThinkingLevels.label(level)).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("model.thinking")
                    }
                }
                Section {
                    Picker("Subscription", selection: $provider) {
                        Text("All").tag("all")
                        ForEach(ModelCatalog.providers, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    ForEach(models) { candidate in
                        Button {
                            onChange(candidate.id, nil)
                            dismiss()
                        } label: {
                            ModelRow(model: candidate, selected: candidate.id == model, connected: client.state?.connectedProviders[candidate.provider] == true)
                        }
                        .accessibilityIdentifier("model.\(candidate.id)")
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search models")
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    AsyncButton(action: {
                        _ = try await client.run("refreshModelList", timeout: 60)
                        await client.refreshCatalog()
                    }) { Label("Refresh", systemImage: "arrow.clockwise") }
                }
            }
        }
    }

    private var models: [DexModel] {
        client.catalog.models.filter { candidate in
            (provider == "all" || candidate.provider == provider)
                && (search.isEmpty || candidate.name.localizedCaseInsensitiveContains(search) || candidate.id.localizedCaseInsensitiveContains(search)
                    || (ModelCatalog.makers[candidate.maker] ?? "").localizedCaseInsensitiveContains(search))
        }
    }
}

struct ModelRow: View {
    let model: DexModel
    let selected: Bool
    let connected: Bool

    var body: some View {
        HStack(spacing: 12) {
            MakerLogo(maker: model.maker, size: 22)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(model.name).foregroundStyle(.primary)
                    if model.isFree { Badge(text: "Free", color: .green) }
                    if model.trainsOnData == true { Badge(text: "Trains on prompts", color: .orange) }
                }
                Text("\(ModelCatalog.providerName(model.provider)) · \(Format.tokens(Double(model.contextWindow))) context\(connected ? "" : " · not connected")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if selected { Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold) }
        }
        .opacity(connected ? 1 : 0.6)
    }
}

struct Badge: View {
    let text: String
    var color: Color = .secondary

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: .capsule)
    }
}

/// Which MCP servers the chat can use.
struct McpPickerButton: View {
    @Environment(DexClient.self) private var client
    let selected: [String]
    let onChange: ([String]) -> Void

    var body: some View {
        let servers = client.state?.mcp ?? []
        if !servers.isEmpty {
            Menu {
                ForEach(servers) { server in
                    Toggle(isOn: Binding(get: { selected.contains(server.id) }, set: { on in
                        onChange(on ? selected + [server.id] : selected.filter { $0 != server.id })
                    })) {
                        Label(server.name, systemImage: server.status == "ready" ? "point.3.connected.trianglepath.dotted" : "exclamationmark.triangle")
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                    if !selected.isEmpty { Text("\(selected.count)") }
                }
                .font(.caption.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
            }
            .menuActionDismissBehavior(.disabled)
            .buttonStyle(.glass)
            .accessibilityLabel("MCP servers")
            .accessibilityIdentifier("composer.mcp")
        }
    }
}

/// Typing `/` lists your skills; picking one fills `/<name> `.
struct SkillSuggestions: View {
    @Environment(DexClient.self) private var client
    @Binding var text: String

    var body: some View {
        let query = slashQuery
        if let query {
            let skills = (client.state?.skills ?? []).filter { query.isEmpty || $0.id.contains(query) }.prefix(6)
            if !skills.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(skills)) { skill in
                        Button {
                            text = "/\(skill.id) "
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("/\(skill.id)").font(.subheadline.monospaced().weight(.medium))
                                Text(skill.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("skill.suggestion.\(skill.id)")
                    }
                }
                .padding(.vertical, 4)
                .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    /// What follows a `/` at the start of the message, while it's still being typed.
    private var slashQuery: String? {
        guard text.hasPrefix("/"), !text.contains(" ") else { return nil }
        return String(text.dropFirst()).lowercased()
    }
}
