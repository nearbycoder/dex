import DexCore
import SwiftUI

/// The model and thinking level, as two composer buttons: the model (its maker's logo, name, which subscription
/// when both are connected, and an eye when it sees images) opens the model list; the brain picks a thinking level.
struct ModelPickerButton: View {
    @Environment(DexClient.self) private var client
    let model: String
    let thinking: ThinkingLevel
    /// A new model (with the thinking level clamped to what it supports), or a new level.
    let onChange: (_ model: String?, _ thinking: ThinkingLevel?) -> Void
    @State private var showing = false

    var body: some View {
        let current = client.catalog.model(model)
        let connected = client.state?.connectedProviders ?? [:]
        let bothConnected = connected.values.filter { $0 }.count > 1
        Button {
            showing = true
        } label: {
            HStack(spacing: 5) {
                MakerLogo(maker: current?.maker ?? "", size: 14)
                Text(client.catalog.name(of: model)).lineLimit(1)
                if let current, bothConnected {
                    Text(ModelCatalog.providers.first { $0.id == current.provider }?.short ?? current.provider)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.quaternary, in: .rect(cornerRadius: 4))
                }
                if current?.acceptsImages == true {
                    Image(systemName: "eye").font(.caption2).foregroundStyle(.green)
                }
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
        }
        .buttonStyle(.glass)
        .accessibilityLabel("Model: \(client.catalog.name(of: model))\(current.map { ", \(ModelCatalog.providerName($0.provider))" } ?? "")")
        .accessibilityIdentifier("composer.model")
        .popover(isPresented: $showing) {
            ModelPickerSheet(model: model) { picked in
                let clamped = client.catalog.model(picked)?.clampThinking(thinking) ?? thinking
                onChange(picked, clamped == thinking ? nil : clamped)
            }
            .frame(minWidth: 380, idealWidth: 420, minHeight: 520, idealHeight: 640)
            .presentationCompactAdaptation(.sheet)
            .presentationDetents([.large])
        }
        ThinkingPicker(model: model, thinking: thinking) { onChange(nil, $0) }
    }
}

/// The thinking level, for models that think.
struct ThinkingPicker: View {
    @Environment(DexClient.self) private var client
    let model: String
    let thinking: ThinkingLevel
    let onChange: (ThinkingLevel) -> Void

    var body: some View {
        let levels = client.catalog.model(model)?.supportedThinkingLevels ?? ThinkingLevels.all
        if !levels.isEmpty {
            Menu {
                Picker("Thinking", selection: Binding(get: { thinking }, set: { onChange($0) })) {
                    ForEach(levels, id: \.self) { level in Text(ThinkingLevels.label(level)).tag(level) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "brain")
                    Text(ThinkingLevels.label(thinking)).lineLimit(1)
                }
                .font(.caption.weight(.medium))
                .padding(.horizontal, 2)
                .padding(.vertical, 2)
            }
            .buttonStyle(.glass)
            .accessibilityLabel("Thinking: \(ThinkingLevels.label(thinking))")
            .accessibilityIdentifier("composer.thinking")
        }
    }
}

/// Every model, by subscription (connected ones first), searchable by name, maker, or subscription, with what each
/// can do: see images, its context, whether it thinks, free, and whether the provider trains on what you send.
struct ModelPickerSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    let model: String
    let onSelect: (String) -> Void
    /// Set by editors that pick a thinking level here too (agents, defaults); the composer has its own button.
    var thinking: ThinkingLevel? = nil
    var onThinking: ((ThinkingLevel) -> Void)? = nil
    @State private var only = "all"
    @State private var search = ""
    @State private var checking = false

    init(model: String, onSelect: @escaping (String) -> Void) {
        self.model = model
        self.onSelect = onSelect
    }

    /// The sheet with the thinking level as well: `onChange` gets a new model (thinking clamped to it) or a new level.
    init(model: String, thinking: ThinkingLevel, onChange: @escaping (_ model: String?, _ thinking: ThinkingLevel?) -> Void) {
        self.model = model
        self.thinking = thinking
        self.onSelect = { onChange($0, nil) }
        self.onThinking = { onChange(nil, $0) }
    }

    var body: some View {
        let connected = client.state?.connectedProviders ?? [:]
        // Connected subscriptions first.
        let providers = ModelCatalog.providers.sorted { (connected[$0.id] == true ? 0 : 1) < (connected[$1.id] == true ? 0 : 1) }
        NavigationStack {
            List {
                if let thinking, let onThinking, let current = client.catalog.model(model), current.supportedThinkingLevels.count > 1 {
                    Section("Thinking") {
                        Picker("Thinking", selection: Binding(get: { current.clampThinking(thinking) }, set: { onThinking($0) })) {
                            ForEach(current.supportedThinkingLevels, id: \.self) { Text(ThinkingLevels.label($0)).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("model.thinking")
                    }
                }
                Section {
                    Picker("Subscription", selection: $only) {
                        Text("All \(client.catalog.models.count)").tag("all")
                        ForEach(providers, id: \.id) { provider in
                            Text("\(provider.name) \(client.catalog.models(of: provider.id).count)").tag(provider.id)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("model.tabs")
                }
                ForEach(providers, id: \.id) { provider in
                    let models = client.catalog.models(of: provider.id).filter(matches)
                    if !models.isEmpty {
                        Section {
                            ForEach(models) { candidate in
                                let selected = candidate.id == model
                                Button {
                                    onSelect(candidate.id)
                                    dismiss()
                                } label: {
                                    ModelRow(model: candidate, selected: selected)
                                }
                                .disabled(!(connected[provider.id] == true || selected))
                                .accessibilityIdentifier("model.\(candidate.id)")
                            }
                        } header: {
                            HStack {
                                Text(provider.name)
                                Spacer()
                                if connected[provider.id] != true {
                                    Button("Connect in Settings") {
                                        dismiss()
                                        router.openSettings(.models)
                                    }
                                    .font(.caption.weight(.semibold))
                                    .textCase(nil)
                                }
                            }
                        }
                    }
                }
                if !client.catalog.models.contains(where: matches) {
                    ContentUnavailableView(search.isEmpty ? "No Models" : "No model matches “\(search)”", systemImage: "cpu")
                        .listRowBackground(Color.clear)
                }
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Text-only models can't see images or VM screenshots. Pick a **Vision** model for those.")
                        if let list = client.state?.models, list.updatedAt > 0 {
                            HStack(spacing: 6) {
                                Text("List checked with the providers \(Format.ago(list.updatedAt)).")
                                Button {
                                    checking = true
                                    Task {
                                        defer { checking = false }
                                        do {
                                            try await client.run("refreshModelList", timeout: 60)
                                            await client.refreshCatalog()
                                        } catch { client.notice = error.localizedDescription }
                                    }
                                } label: {
                                    Image(systemName: "arrow.clockwise")
                                        .symbolEffect(.rotate, options: .repeating, isActive: checking)
                                }
                                .buttonStyle(.borderless)
                                .disabled(checking || !client.isConnected)
                                .accessibilityLabel("Check for new and retired models now")
                                .accessibilityIdentifier("model.refresh")
                            }
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search models")
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("model.done") }
            }
        }
        .accessibilityIdentifier("model.sheet")
    }

    private func matches(_ candidate: DexModel) -> Bool {
        guard only == "all" || candidate.provider == only else { return false }
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        if needle.isEmpty { return true }
        return "\(candidate.name) \(ModelCatalog.makers[candidate.maker] ?? candidate.maker) \(ModelCatalog.providerName(candidate.provider))".lowercased().contains(needle)
    }
}

struct ModelRow: View {
    let model: DexModel
    let selected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            MakerLogo(maker: model.maker, size: 22).padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(model.name).foregroundStyle(.primary)
                    Text(ModelCatalog.makers[model.maker] ?? model.maker).font(.caption2).foregroundStyle(.secondary)
                }
                FlowBadges(model: model)
            }
            Spacer(minLength: 0)
            if selected { Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold).accessibilityLabel("Selected") }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A model's capabilities as small badges.
private struct FlowBadges: View {
    let model: DexModel

    var body: some View {
        let levels = model.supportedThinkingLevels
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { badges(levels) }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) { badges(levels).prefix }
                HStack(spacing: 4) { badges(levels).suffix }
            }
        }
    }

    private func badges(_ levels: [ThinkingLevel]) -> BadgeRows {
        BadgeRows(model: model, levels: levels)
    }
}

private struct BadgeRows: View {
    let model: DexModel
    let levels: [ThinkingLevel]

    var body: some View {
        prefix
        suffix
    }

    @ViewBuilder var prefix: some View {
        if model.acceptsImages { Badge(text: "Vision", symbol: "eye", color: .green) } else { Badge(text: "Text only", symbol: "textformat", color: .secondary) }
        Badge(text: "\(Self.tokens(model.contextWindow)) context", color: .secondary)
        if !levels.isEmpty { Badge(text: levels.contains("off") ? "Thinking optional" : "Always thinks", symbol: "brain", color: .secondary) }
    }

    @ViewBuilder var suffix: some View {
        if model.isFree { Badge(text: "Free", color: .cyan) }
        if model.trainsOnData == true { Badge(text: "Trains on prompts", color: .orange) }
    }

    static func tokens(_ count: Int) -> String {
        count >= 1_000_000 ? "\(Int((Double(count) / 1_000_000).rounded()))M" : "\(Int((Double(count) / 1024).rounded()))K"
    }
}

struct Badge: View {
    let text: String
    var symbol: String? = nil
    var color: Color = .secondary

    var body: some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .foregroundStyle(color)
        .background(color.opacity(0.14), in: .capsule)
    }
}

/// Which MCP servers the chat can use: each with its status and tool count, and a link to manage them.
struct McpPickerButton: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    let selected: [String]
    let onChange: ([String]) -> Void

    var body: some View {
        let servers = client.state?.mcp ?? []
        let attached = servers.filter { selected.contains($0.id) }
        let attention = attached.contains { $0.status == "authenticating" || $0.status == "failed" }
        Menu {
            Section("MCP servers for this chat") {
                if servers.isEmpty {
                    Text("No MCP servers yet. Connect one to give Dex its tools.")
                }
                ForEach(servers) { server in
                    Toggle(isOn: Binding(get: { selected.contains(server.id) }, set: { on in
                        onChange(on ? selected + [server.id] : selected.filter { $0 != server.id })
                    })) {
                        Text(server.name)
                        Text(server.status == "ready" ? "\(server.tools.count) tools" : server.statusLabel)
                    }
                    .accessibilityIdentifier("mcp.\(server.id)")
                }
            }
            Button {
                router.open(.page(.mcp), compact: sizeClass == .compact)
            } label: { Label("Manage MCP Servers", systemImage: "gearshape") }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "powerplug")
                if attached.count == 1, sizeClass != .compact {
                    Text(attached[0].name).lineLimit(1)
                } else if !attached.isEmpty {
                    Text(sizeClass == .compact ? "\(attached.count)" : "\(attached.count) MCP")
                } else if sizeClass != .compact {
                    Text("MCP")
                }
                if attention { Circle().fill(.orange).frame(width: 6, height: 6) }
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
        .menuActionDismissBehavior(.disabled)
        .buttonStyle(.glass)
        .tint(attached.isEmpty ? nil : .green)
        .accessibilityLabel(attached.isEmpty ? "MCP servers" : "MCP servers: \(attached.map(\.name).joined(separator: ", "))")
        .accessibilityIdentifier("composer.mcp")
    }
}
