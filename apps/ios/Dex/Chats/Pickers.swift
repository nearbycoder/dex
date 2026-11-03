import DexCore
import SwiftUI

/// The model and thinking level, as two composer buttons: the model (its maker's logo, name, which subscription
/// when more than one is connected, and an eye when it sees images) opens the model list; the brain picks a thinking
/// level. Where the composer is narrow (`composerChipFit`) the subscription goes first, then the eye, then the name
/// is cut short; the accessibility label always says all of it.
struct ModelPickerButton: View {
    @Environment(DexClient.self) private var client
    @Environment(\.composerChipFit) private var fit
    @Environment(\.composerChipMeasuring) private var measuring
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
            if !measuring { showing = true }
        } label: {
            HStack(spacing: 5) {
                MakerLogo(maker: current?.maker ?? "", size: 14)
                // Measured for `shortName` without it: what the rest of the chips take.
                if fit != .logoOnly, !(measuring && fit == .shortName) {
                    Text(client.catalog.name(of: model)).lineLimit(1).truncationMode(.tail)
                }
                if let current, bothConnected, fit == .full {
                    Text(ModelCatalog.providers.first { $0.id == current.provider }?.short ?? current.provider)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.quaternary, in: .rect(cornerRadius: 4))
                }
                if current?.acceptsImages == true, fit < .noVision {
                    Image(systemName: "eye").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .font(.caption.weight(.medium))
            // Narrow: a little of the glass's own inset goes to the name.
            .padding(.horizontal, fit >= .compact ? -2 : 4)
            .padding(.vertical, 2)
        }
        .buttonStyle(.glass)
        .accessibilityLabel("Model: \(client.catalog.name(of: model))\(current.map { ", \(ModelCatalog.providerName($0.provider))" } ?? "")\(current?.acceptsImages == true ? ", sees images" : "")")
        .accessibilityIdentifier("composer.model")
        .popover(isPresented: measuring ? .constant(false) : $showing) {
            ModelPickerSheet(model: model) { picked in
                let clamped = client.catalog.model(picked)?.clampThinking(thinking) ?? thinking
                onChange(picked, clamped == thinking ? nil : clamped)
            }
            .frame(minWidth: 380, idealWidth: 420, minHeight: 520, idealHeight: 640)
            // The chip is neutral; the list it opens keeps the theme.
            .tint(.dexAccent)
            .presentationCompactAdaptation(.sheet)
            .presentationDetents([.large])
        }
        ThinkingPicker(model: model, thinking: thinking) { onChange(nil, $0) }
    }
}

/// The thinking level, for models that think: the brain and the level's name, or where the composer is narrow the
/// brain and the level as bars.
struct ThinkingPicker: View {
    @Environment(DexClient.self) private var client
    @Environment(\.composerChipFit) private var fit
    @Environment(\.composerChipMeasuring) private var measuring
    let model: String
    let thinking: ThinkingLevel
    let onChange: (ThinkingLevel) -> Void

    var body: some View {
        let levels = client.catalog.model(model)?.supportedThinkingLevels ?? ThinkingLevels.all
        if !levels.isEmpty {
            if measuring {
                // The composer sizing its chips: the same menu glass (a button's is a little larger), nothing in it.
                Menu {} label: { label(levels) }.buttonStyle(.glass).fixedSize()
            } else {
                Menu {
                    Picker("Thinking", selection: Binding(get: { thinking }, set: { onChange($0) })) {
                        ForEach(levels, id: \.self) { level in Text(ThinkingLevels.label(level)).tag(level) }
                    }
                    .pickerStyle(.inline)
                } label: {
                    label(levels)
                }
                .buttonStyle(.glass)
                .fixedSize()
                .accessibilityLabel("Thinking: \(ThinkingLevels.label(thinking))")
                .accessibilityIdentifier("composer.thinking")
            }
        }
    }

    private func label(_ levels: [ThinkingLevel]) -> some View {
        HStack(spacing: fit >= .compact ? 2 : 4) {
            Image(systemName: "brain")
            if fit >= .compact {
                Image(systemName: "cellularbars", variableValue: Self.amount(thinking, of: levels))
                    .font(.caption2.weight(.semibold))
            } else {
                Text(ThinkingLevels.label(thinking)).lineLimit(1)
            }
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, fit >= .compact ? -4 : 2)
        .padding(.vertical, 2)
    }

    /// How far up the model's levels `level` is, 0 (off, or its lowest) to 1 (its highest), for the bars.
    static func amount(_ level: ThinkingLevel, of levels: [ThinkingLevel]) -> Double {
        if level == "off" { return 0 }
        let thinking = levels.filter { $0 != "off" }
        guard let index = thinking.firstIndex(of: level) else {
            return Double(ThinkingLevels.all.firstIndex(of: level) ?? 0) / Double(ThinkingLevels.all.count - 1)
        }
        return thinking.count > 1 ? 0.25 + 0.75 * Double(index) / Double(thinking.count - 1) : 1
    }
}

/// Every model, by subscription (connected ones first), searchable by name, maker, or subscription, with what each
/// can do: see images, its context, whether it thinks, free, whether the provider trains on what you send, and when it
/// came out. Newest (remembered on the device) lists every subscription's models together by release date instead,
/// optionally only those out within some days, to spot new (often stealth) ones.
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
    @AppStorage("dex.models.newest") private var newest = false
    /// Newest's "released within" days (0: any time).
    @State private var within = 0

    /// A reset launch (UI tests) starts grouped by subscription, as on a new device.
    private static let resetNewest: Void = {
        guard LaunchOptions.current.resetState else { return }
        UserDefaults.standard.removeObject(forKey: "dex.models.newest")
    }()

    init(model: String, onSelect: @escaping (String) -> Void) {
        _ = Self.resetNewest
        self.model = model
        self.onSelect = onSelect
    }

    /// The sheet with the thinking level as well: `onChange` gets a new model (thinking clamped to it) or a new level.
    init(model: String, thinking: ThinkingLevel, onChange: @escaping (_ model: String?, _ thinking: ThinkingLevel?) -> Void) {
        _ = Self.resetNewest
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
                    VStack(alignment: .leading, spacing: 8) {
                        // Capsules that scroll sideways rather than a segmented control, whose names get cut short on a phone.
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                filterChip("all", title: "All", count: client.catalog.models.count)
                                ForEach(providers, id: \.id) { provider in
                                    filterChip(provider.id, title: provider.name, count: client.catalog.models(of: provider.id).count)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .scrollClipDisabled()
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("model.tabs")
                        if newest {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(ModelCatalog.releaseWithin, id: \.days) { choice in
                                        chip(choice.label, chosen: within == choice.days, id: "model.within.\(choice.days)") { within = choice.days }
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                            .scrollClipDisabled()
                            .accessibilityElement(children: .contain)
                            .accessibilityLabel("Released")
                            .accessibilityIdentifier("model.within")
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if newest {
                    // Every subscription's models in one list, newest first, in sections by how recent.
                    ForEach(ModelCatalog.byRelease(client.catalog.models.filter(matches), connected: connected), id: \.label) { section in
                        Section(section.label) {
                            ForEach(section.models) { candidate in row(candidate, connected: connected, showProvider: true) }
                        }
                    }
                }
                ForEach(newest ? [] : providers, id: \.id) { provider in
                    let models = client.catalog.models(of: provider.id).filter(matches)
                    if !models.isEmpty {
                        Section {
                            ForEach(models) { candidate in row(candidate, connected: connected, showProvider: false) }
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
                if let provider = ModelCatalog.providers.first(where: { $0.id == only }), connected[provider.id] != true,
                   client.catalog.models(of: provider.id).isEmpty {
                    // A subscription that lists models only once connected (Command Code: what the key's plan covers).
                    ContentUnavailableView {
                        Label("Not Connected", systemImage: "key")
                    } description: {
                        Text("Connect \(provider.name) in Settings and the models your plan covers appear here.")
                    } actions: {
                        Button("Connect in Settings") {
                            dismiss()
                            router.openSettings(.models)
                        }
                        .accessibilityIdentifier("model.connect")
                    }
                    .listRowBackground(Color.clear)
                } else if !client.catalog.models.contains(where: matches) {
                    if !search.isEmpty {
                        ContentUnavailableView("No model matches “\(search)”", systemImage: "cpu").listRowBackground(Color.clear)
                    } else if newest, within > 0 {
                        ContentUnavailableView("Nothing New in That Time", systemImage: "calendar.badge.clock").listRowBackground(Color.clear)
                    } else {
                        ContentUnavailableView("No Models", systemImage: "cpu").listRowBackground(Color.clear)
                    }
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
            .listSectionSpacing(.compact)
            .contentMargins(.top, 4, for: .scrollContent)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search models")
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Toggle(isOn: Binding(get: { newest }, set: { newest = $0; within = 0 })) {
                        Label("Newest", systemImage: "calendar.badge.clock").labelStyle(.titleAndIcon)
                    }
                    .toggleStyle(.button)
                    .accessibilityHint(newest ? "Groups the models by subscription again" : "Lists the newest models first")
                    .accessibilityIdentifier("model.newest")
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("model.done") }
            }
        }
        .accessibilityIdentifier("model.sheet")
    }

    /// A model you can pick (one on a subscription that isn't connected only if it's the current one).
    private func row(_ candidate: DexModel, connected: [String: Bool], showProvider: Bool) -> some View {
        let selected = candidate.id == model
        return Button {
            onSelect(candidate.id)
            dismiss()
        } label: {
            ModelRow(model: candidate, selected: selected, showProvider: showProvider)
        }
        // Rows read as text, not links; only the checkmark carries the theme.
        .tint(.primary)
        .disabled(!(connected[candidate.provider] == true || selected))
        .accessibilityIdentifier("model.\(candidate.id)")
    }

    /// One subscription filter: its name and how many models it has.
    private func filterChip(_ id: String, title: String, count: Int) -> some View {
        chip(title, count: count, chosen: only == id, id: "model.tab.\(id)") { only = id }
    }

    /// A filter capsule; the chosen one is filled in.
    private func chip(_ title: String, count: Int? = nil, chosen: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                if let count {
                    Text("\(count)").foregroundStyle(chosen ? AnyShapeStyle(.white.opacity(0.8)) : AnyShapeStyle(.secondary))
                }
            }
            .font(.subheadline.weight(.medium))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(chosen ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(chosen ? AnyShapeStyle(Color.selectionAccent) : AnyShapeStyle(.quaternary), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    private func matches(_ candidate: DexModel) -> Bool {
        guard only == "all" || candidate.provider == only else { return false }
        if newest, within > 0, (candidate.daysSinceRelease() ?? .max) > within { return false }
        // Every word of the search must be in the name, maker, subscription, or badges ("free vision").
        let words = search.lowercased().split(whereSeparator: \.isWhitespace)
        if words.isEmpty { return true }
        let levels = candidate.supportedThinkingLevels
        let badges = [
            candidate.acceptsImages ? "vision" : "text only",
            levels.isEmpty ? "" : levels.contains("off") ? "thinking optional" : "always thinks",
            candidate.isFree ? "free" : "",
            candidate.trainsOnData == true ? "trains on prompts" : "",
            candidate.isNew() ? "new" : ""
        ]
        let text = "\(candidate.name) \(ModelCatalog.makers[candidate.maker] ?? candidate.maker) \(ModelCatalog.providerName(candidate.provider)) \(badges.joined(separator: " "))".lowercased()
        return words.allSatisfy { text.contains($0) }
    }
}

/// A model in the picker: its logo, name, and maker (or in the newest-first list, its subscription), when it came
/// out at the trailing edge, and its badges.
struct ModelRow: View {
    let model: DexModel
    let selected: Bool
    var showProvider = false

    var body: some View {
        let released = model.releaseLabel()
        let short = showProvider ? ModelCatalog.providers.first { $0.id == model.provider }?.short ?? model.provider : nil
        HStack(alignment: .top, spacing: 12) {
            MakerLogo(maker: model.maker, size: 22).padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(model.name).foregroundStyle(.primary)
                    // The logo already says who makes it where the subscription goes instead.
                    if !showProvider {
                        Text(ModelCatalog.makers[model.maker] ?? model.maker).font(.caption2).foregroundStyle(.secondary)
                    }
                    if short != nil || released != nil {
                        Spacer(minLength: 4)
                        Text([short, released].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .fixedSize()
                            .accessibilityLabel([short, released.map { "released \($0)" }].compactMap { $0 }.joined(separator: ", "))
                    }
                }
                FlowBadges(model: model)
            }
            Spacer(minLength: 0)
            if selected { Image(systemName: "checkmark").foregroundStyle(Color.dexAccent).fontWeight(.semibold).accessibilityLabel("Selected") }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A model's capabilities as small badges, wrapping onto more rows on a narrow screen (never truncated).
private struct FlowBadges: View {
    let model: DexModel

    var body: some View {
        let levels = model.supportedThinkingLevels
        ChipFlowLayout(spacing: 4) {
            if model.isNew() { Badge(text: "New", color: .purple) }
            if model.acceptsImages { Badge(text: "Vision", symbol: "eye", color: .green) } else { Badge(text: "Text only", symbol: "textformat", color: .secondary) }
            Badge(text: "\(Self.tokens(model.contextWindow)) context", color: .secondary)
            if !levels.isEmpty { Badge(text: levels.contains("off") ? "Thinking optional" : "Always thinks", symbol: "brain", color: .secondary) }
            if model.isFree { Badge(text: "Free", color: .cyan) }
            if model.trainsOnData == true { Badge(text: "Trains on prompts", color: .orange) }
        }
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
        .fixedSize()
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .foregroundStyle(color)
        .background(color.opacity(0.14), in: .capsule)
    }
}

/// Which MCP servers the chat can use: each with its status and tool count, and a link to manage them.
/// Where the composer is narrow (`composerChipFit`) it's the plug and how many are on.
struct McpPickerButton: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.composerChipFit) private var fit
    @Environment(\.composerChipMeasuring) private var measuring
    let selected: [String]
    let onChange: ([String]) -> Void

    var body: some View {
        let servers = client.state?.mcp ?? []
        let attached = servers.filter { selected.contains($0.id) }
        if measuring {
            // The composer sizing its chips: the same menu glass (a button's is a little larger), nothing in it.
            Menu {} label: { label(attached) }.buttonStyle(.glass).fixedSize()
        } else {
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
                label(attached)
            }
            .menuActionDismissBehavior(.disabled)
            .buttonStyle(.glass)
            .fixedSize()
            .accessibilityLabel(attached.isEmpty ? "MCP servers" : "MCP servers: \(attached.map(\.name).joined(separator: ", "))")
            .accessibilityIdentifier("composer.mcp")
        }
    }

    private func label(_ attached: [McpServerInfo]) -> some View {
        let attention = attached.contains { $0.status == "authenticating" || $0.status == "failed" }
        let short = sizeClass == .compact || fit >= .compact
        return HStack(spacing: 4) {
            Image(systemName: "powerplug")
            if attached.count == 1, !short {
                Text(attached[0].name).lineLimit(1)
            } else if !attached.isEmpty {
                Text(short ? "\(attached.count)" : "\(attached.count) MCP").lineLimit(1)
            } else if !short {
                Text("MCP")
            }
            if attention { Circle().fill(.orange).frame(width: 6, height: 6) }
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, fit >= .compact ? -4 : 2)
        .padding(.vertical, 2)
    }
}
