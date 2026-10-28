import DexCore
import SwiftUI

/// The chat list as an inbox: chats needing you, then Snoozed (soonest first) and Settled (most recent first), both
/// collapsible (remembered per device). A chat leaves those groups by itself when something new happens in it or its
/// snooze ends. Swipe to settle, snooze, or delete; long-press (or right-click) for the chat's menu; ↑/↓ move
/// through the list on a hardware keyboard.
struct ChatListView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var filter = ""
    @State private var now = Date.now
    /// The list has the keyboard (after you pick a chat in it), so ↑/↓ move through it.
    @FocusState private var listFocused: Bool
    @AppStorage("dex.inbox.snoozedOpen") private var snoozedOpen = false
    @AppStorage("dex.inbox.settledOpen") private var settledOpen = false

    /// A reset launch (UI tests) starts with the groups collapsed, as on a new device.
    private static let resetGroups: Void = {
        guard LaunchOptions.current.resetState else { return }
        UserDefaults.standard.removeObject(forKey: "dex.inbox.snoozedOpen")
        UserDefaults.standard.removeObject(forKey: "dex.inbox.settledOpen")
    }()

    init() { _ = Self.resetGroups }

    var body: some View {
        @Bindable var router = router
        let sessions = client.state?.sessions ?? []
        let filtered = filter.isEmpty ? sessions : sessions.filter { $0.title.localizedCaseInsensitiveContains(filter) }
        let groups = Inbox.groups(filtered, now: now.timeIntervalSince1970 * 1000)
        // The open chat stays visible even if its group is collapsed; a search shows everything it finds.
        let showSnoozed = snoozedOpen || !filter.isEmpty || groups.snoozed.contains { $0.id == router.chat }
        let showSettled = settledOpen || !filter.isEmpty || groups.settled.contains { $0.id == router.chat }

        List(selection: $router.chatSelection) {
            if client.state == nil {
                ForEach(0..<7, id: \.self) { _ in ChatRowSkeleton() }
            } else if sessions.isEmpty {
                EmptyStateView(title: "No chats yet", symbol: "bubble.left.and.text.bubble.right", message: "Start one to ask Dex anything.", actionTitle: "New Chat") {
                    router.newChat()
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            } else if !filter.isEmpty, filtered.isEmpty {
                ContentUnavailableView.search(text: filter).listRowBackground(Color.clear)
            }
            if !sessions.isEmpty, filter.isEmpty || !groups.inbox.isEmpty {
                Section {
                    if groups.inbox.isEmpty {
                        Label("All caught up", systemImage: "checkmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .selectionDisabled()
                            .accessibilityIdentifier("inbox.caughtUp")
                    }
                    ForEach(groups.inbox) { session in
                        ChatRow(session: session, place: .inbox).tag(ChatSelection.chat(session.id))
                    }
                }
            }
            if !groups.snoozed.isEmpty {
                Section(isExpanded: Binding(get: { showSnoozed }, set: { snoozedOpen = $0 })) {
                    ForEach(groups.snoozed) { session in
                        ChatRow(session: session, place: .snoozed).tag(ChatSelection.chat(session.id))
                    }
                } header: {
                    GroupHeader(title: "Snoozed", symbol: "moon.zzz", count: groups.snoozed.count).accessibilityIdentifier("inbox.snoozed")
                }
            }
            if !groups.settled.isEmpty {
                Section(isExpanded: Binding(get: { showSettled }, set: { settledOpen = $0 })) {
                    ForEach(groups.settled) { session in
                        ChatRow(session: session, place: .settled).tag(ChatSelection.chat(session.id))
                    }
                } header: {
                    GroupHeader(title: "Settled", symbol: "checkmark.circle", count: groups.settled.count).accessibilityIdentifier("inbox.settled")
                }
            }
        }
        .listStyle(.sidebar)
        .tint(.selectionAccent)
        .animation(.smooth, value: sessions.map { "\($0.id)\(Inbox.place(of: $0).rawValue)" })
        .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search chats")
        .navigationTitle("Chats")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                ConnectionIndicator()
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    router.newChat()
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                }
                // ⌘N is the File menu's (DexCommands): a view's shortcut stays live in a hidden tab and would win.
                .accessibilityIdentifier("chats.new")
            }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($listFocused)
        .onChange(of: router.chatSelection) { _, selection in
            if case .chat = selection { listFocused = true }
        }
        .onKeyPress(keys: [.upArrow, .downArrow], phases: .down) { press in
            let order = groups.inbox + (showSnoozed ? groups.snoozed : []) + (showSettled ? groups.settled : [])
            guard !order.isEmpty else { return .ignored }
            let current = order.firstIndex { $0.id == router.chat }
            let next = switch (press.key, current) {
            case (.downArrow, nil): 0
            case (.upArrow, nil): order.count - 1
            case (.downArrow, let index?): min(index + 1, order.count - 1)
            case (_, let index?): max(index - 1, 0)
            default: 0
            }
            router.chatSelection = .chat(order[next].id)
            return .handled
        }
        .task {
            // Snoozes end on their own: regroup now and then.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = .now
            }
        }
        .accessibilityIdentifier("chats.list")
    }
}

private struct GroupHeader: View {
    let title: String
    let symbol: String
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
            Text(title)
            Text("\(count)").foregroundStyle(.secondary).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(count) chats")
    }
}

/// A dot in the toolbar while the socket is down.
struct ConnectionIndicator: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        switch client.connection.status {
        case .connected:
            EmptyView()
        case .connecting:
            ProgressView().controlSize(.small).accessibilityLabel("Connecting")
        default:
            Image(systemName: "wifi.slash").foregroundStyle(.secondary).accessibilityLabel("Offline")
        }
    }
}

/// One chat in the inbox: its agent or project, title (pulsing while a new one is written), what it runs on, and
/// whether it's working, when it wakes, or when it last did something. Its VM's status shows when running.
struct ChatRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let session: SessionMeta
    let place: Inbox.Place
    @State private var renaming = false
    @State private var confirmDelete = false
    @State private var choosingSnooze = false
    @State private var title = ""

    var body: some View {
        let agent = client.state?.agent(session.agentId)
        let project = client.state?.project(session.projectId)
        let naming = TitleNaming.shared.isNaming(session.id)
        let vm = client.state?.vm(session.id)
        HStack(spacing: 12) {
            Group {
                if let project {
                    AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 36)
                } else if let agent {
                    AgentAvatar(icon: agent.icon, color: agent.color, size: 36)
                } else {
                    // A plain chat: neutral, so agents' and projects' colors stand out.
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.14), in: .rect(cornerRadius: 10, style: .continuous))
                }
            }
            .opacity(place == .settled ? 0.6 : 1)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(session.title)
                        .font(.body.weight(place == .inbox ? .medium : .regular))
                        .foregroundStyle(place == .settled ? .secondary : .primary)
                        .lineLimit(1)
                        .namingPulse(naming)
                    if session.muted {
                        Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Muted")
                    }
                }
                HStack(spacing: 4) {
                    Text(subtitle(agent: agent, project: project)).lineLimit(1)
                    Text("·").foregroundStyle(.tertiary)
                    status.fixedSize()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let vm, vm.status != "none", vm.status != "stopped" {
                StatusDot(kind: StatusDot.vm(vm))
                    .accessibilityLabel("Machine \(vm.status)")
            }
        }
        .padding(.vertical, 3)
        .contentShape(.rect)
        .hoverEffect(.highlight)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat.row.\(session.id)")
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                client.perform { try await ChatActions.settle(session.id, place != .settled, client: client) }
            } label: {
                if place == .settled { Label("Inbox", systemImage: "tray.and.arrow.up") } else { Label("Settle", systemImage: "checkmark.circle") }
            }
            .tint(place == .settled ? .blue : .green)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Not `.destructive`: List would animate the row away before the confirmation (taking the dialog with it).
            Button { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                .tint(.red)
            if place == .snoozed {
                Button { client.perform { try await ChatActions.snooze(session.id, until: nil, client: client) } } label: { Label("Unsnooze", systemImage: "alarm") }
                    .tint(.indigo)
            } else {
                Button { choosingSnooze = true } label: { Label("Snooze", systemImage: "moon.zzz") }
                    .tint(.indigo)
            }
        }
        .contextMenu { menu }
        .confirmationDialog("Snooze “\(session.title)” until", isPresented: $choosingSnooze, titleVisibility: .visible) {
            ForEach(Inbox.snoozeOptions()) { option in
                Button("\(option.label) (\(snoozeTime(option.at)))") {
                    client.perform { try await ChatActions.snooze(session.id, until: option.at.timeIntervalSince1970 * 1000, client: client) }
                }
            }
        }
        .confirmationDialog("Delete “\(session.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Chat", role: .destructive) {
                if router.chat == session.id { router.chatSelection = nil }
                client.perform { try await ChatActions.delete(session.id, client: client) }
            }
        } message: {
            Text("Its messages, files, and VM are deleted too.")
        }
        .alert("Rename Chat", isPresented: $renaming) {
            TextField("Title", text: $title)
            Button("Save") { client.perform { try await ChatActions.rename(session.id, to: title, client: client) } }
            Button("Cancel", role: .cancel) {}
        }
    }

    /// Project · agent, or agent · model, or the model.
    private func subtitle(agent: AgentProfile?, project: ProjectProfile?) -> String {
        let model = client.catalog.name(of: session.model)
        if let project { return [project.name, agent?.name].compactMap { $0 }.joined(separator: " · ") }
        if let agent { return "\(agent.name) · \(model)" }
        return model
    }

    @ViewBuilder private var status: some View {
        if session.busy {
            HStack(spacing: 4) {
                Circle().fill(.green).frame(width: 6, height: 6)
                    .phaseAnimator([1.0, 0.3]) { view, phase in view.opacity(phase) }
                Text("working")
            }
            .foregroundStyle(.green)
        } else if place == .snoozed, let until = session.snoozedUntil {
            HStack(spacing: 3) {
                Image(systemName: "alarm").imageScale(.small)
                Text(Inbox.snoozedLabel(until))
            }
            .foregroundStyle(.indigo)
        } else {
            Text(Format.ago(session.updatedAt))
        }
    }

    @ViewBuilder private var menu: some View {
        Section(session.title) {
            Button { TitleNaming.shared.regenerate(session.id, client: client) } label: { Label("Regenerate Title", systemImage: "sparkles") }
            Button {
                title = session.title
                renaming = true
            } label: { Label("Rename", systemImage: "pencil") }
        }
        if place == .settled {
            Button { client.perform { try await ChatActions.settle(session.id, false, client: client) } } label: { Label("Move to Inbox", systemImage: "tray.and.arrow.up") }
        } else {
            Button { client.perform { try await ChatActions.settle(session.id, true, client: client) } } label: { Label("Settle", systemImage: "checkmark.circle") }
        }
        if place == .snoozed, let until = session.snoozedUntil {
            Button { client.perform { try await ChatActions.snooze(session.id, until: nil, client: client) } } label: {
                Label("Unsnooze (\(Inbox.snoozedLabel(until)))", systemImage: "alarm")
            }
        }
        Menu {
            ForEach(Inbox.snoozeOptions()) { option in
                Button {
                    client.perform { try await ChatActions.snooze(session.id, until: option.at.timeIntervalSince1970 * 1000, client: client) }
                } label: {
                    Text(option.label)
                    Text(snoozeTime(option.at))
                }
            }
        } label: {
            Label("Snooze Until", systemImage: "moon.zzz")
        }
        Button {
            client.perform { try await ChatActions.mute(session.id, !session.muted, client: client) }
        } label: {
            session.muted ? Label("Unmute", systemImage: "bell") : Label("Mute", systemImage: "bell.slash")
        }
        Divider()
        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
    }
}

struct ChatRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quaternary).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 3) {
                LineBone(width: 180)
                LineBone(width: 110, font: .caption)
            }
        }
        .padding(.vertical, 3)
        .accessibilityHidden(true)
    }
}
