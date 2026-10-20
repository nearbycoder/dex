import DexCore
import SwiftUI

/// The chat list as an inbox: chats needing you, then Snoozed and Settled (collapsible). Swipe to settle or snooze;
/// long-press for the chat's menu.
struct ChatListView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @State private var filter = ""
    @AppStorage("dex.inbox.snoozedOpen") private var snoozedOpen = false
    @AppStorage("dex.inbox.settledOpen") private var settledOpen = false

    var body: some View {
        @Bindable var router = router
        let sessions = client.state?.sessions ?? []
        let filtered = filter.isEmpty ? sessions : sessions.filter { $0.title.localizedCaseInsensitiveContains(filter) }
        let groups = Inbox.groups(filtered)

        List(selection: $router.chatSelection) {
            if client.state == nil {
                ForEach(0..<6, id: \.self) { _ in ChatRowSkeleton() }
            } else if sessions.isEmpty {
                EmptyStateView(title: "No chats yet", symbol: "bubble.left.and.text.bubble.right", message: "Start one to ask Dex anything.", actionTitle: "New Chat") {
                    router.newChat()
                }
                .listRowSeparator(.hidden)
            }
            Section {
                ForEach(groups.inbox) { session in
                    ChatRow(session: session, place: .inbox).tag(ChatSelection.chat(session.id))
                }
            }
            if !groups.snoozed.isEmpty {
                Section(isExpanded: Binding(get: { snoozedOpen || groups.snoozed.contains { $0.id == router.chat } }, set: { snoozedOpen = $0 })) {
                    ForEach(groups.snoozed) { session in
                        ChatRow(session: session, place: .snoozed).tag(ChatSelection.chat(session.id))
                    }
                } header: {
                    Label("Snoozed · \(groups.snoozed.count)", systemImage: "moon.zzz")
                        .accessibilityIdentifier("inbox.snoozed")
                }
            }
            if !groups.settled.isEmpty {
                Section(isExpanded: Binding(get: { settledOpen || groups.settled.contains { $0.id == router.chat } }, set: { settledOpen = $0 })) {
                    ForEach(groups.settled) { session in
                        ChatRow(session: session, place: .settled).tag(ChatSelection.chat(session.id))
                    }
                } header: {
                    Label("Settled · \(groups.settled.count)", systemImage: "checkmark.circle")
                        .accessibilityIdentifier("inbox.settled")
                }
            }
        }
        .listStyle(.sidebar)
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
        .accessibilityIdentifier("chats.list")
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

struct ChatRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let session: SessionMeta
    let place: Inbox.Place
    @State private var renaming = false
    @State private var confirmDelete = false
    @State private var title = ""

    var body: some View {
        let agent = client.state?.agent(session.agentId)
        let project = client.state?.project(session.projectId)
        HStack(spacing: 12) {
            Group {
                if let project {
                    AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 34)
                } else if let agent {
                    AgentAvatar(icon: agent.icon, color: agent.color, size: 34)
                } else {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.tint)
                        .frame(width: 34, height: 34)
                        .background(.tint.opacity(0.14), in: .rect(cornerRadius: 10, style: .continuous))
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(session.title)
                        .font(.body.weight(place == .inbox ? .medium : .regular))
                        .foregroundStyle(place == .settled ? .secondary : .primary)
                        .lineLimit(1)
                    if session.muted {
                        Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Muted")
                    }
                }
                HStack(spacing: 6) {
                    if session.busy {
                        ProgressView().controlSize(.mini)
                        Text("Working…")
                    } else if place == .snoozed, let until = session.snoozedUntil {
                        Image(systemName: "moon.zzz.fill")
                        Text(Inbox.snoozedLabel(until))
                    } else {
                        Text(Format.ago(session.updatedAt))
                        if let name = agent?.name ?? project?.name { Text("· \(name)").lineLimit(1) }
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let vm = client.state?.vm(session.id), vm.status != "none", vm.status != "stopped" {
                StatusDot(kind: StatusDot.vm(vm))
                    .accessibilityLabel("Machine \(vm.status)")
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat.row.\(session.id)")
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                client.perform { try await client.chat(session.id).settle(place != .settled) }
            } label: {
                if place == .settled { Label("Inbox", systemImage: "tray.and.arrow.up") } else { Label("Settle", systemImage: "checkmark.circle") }
            }
            .tint(.green)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
            snoozeMenu.tint(.indigo)
        }
        .contextMenu { menu }
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

    private var snoozeMenu: some View {
        Menu {
            ForEach(Inbox.snoozeOptions()) { option in
                Button(option.label) {
                    client.perform { try await ChatActions.snooze(session.id, until: option.at.timeIntervalSince1970 * 1000, client: client) }
                }
            }
        } label: {
            Label("Snooze", systemImage: "moon.zzz")
        }
    }

    @ViewBuilder private var menu: some View {
        Button {
            title = session.title
            renaming = true
        } label: { Label("Rename", systemImage: "pencil") }
        Button {
            client.perform { _ = try await ChatActions.regenerateTitle(session.id, client: client) }
        } label: { Label("Regenerate Title", systemImage: "sparkles") }
        Divider()
        if place == .settled {
            Button { client.perform { try await ChatActions.settle(session.id, false, client: client) } } label: { Label("Move to Inbox", systemImage: "tray.and.arrow.up") }
        } else {
            Button { client.perform { try await ChatActions.settle(session.id, true, client: client) } } label: { Label("Settle", systemImage: "checkmark.circle") }
        }
        if place == .snoozed {
            Button { client.perform { try await ChatActions.snooze(session.id, until: nil, client: client) } } label: { Label("Unsnooze", systemImage: "alarm") }
        }
        snoozeMenu
        Button {
            client.perform { try await ChatActions.mute(session.id, !session.muted, client: client) }
        } label: {
            session.muted ? Label("Unmute", systemImage: "bell") : Label("Mute", systemImage: "bell.slash")
        }
        Divider()
        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
    }
}

/// Chat actions that don't need the chat to be open (no event subscription).
enum ChatActions {
    static func settle(_ id: String, _ settled: Bool, client: DexClient) async throws {
        try await client.run("triageSession", .string(id), ["settled": .bool(settled)])
    }
    static func snooze(_ id: String, until: Double?, client: DexClient) async throws {
        try await client.run("triageSession", .string(id), ["snoozedUntil": until.map(JSONValue.number) ?? .null])
    }
    static func rename(_ id: String, to title: String, client: DexClient) async throws {
        try await client.run("renameSession", .string(id), .string(title))
    }
    static func regenerateTitle(_ id: String, client: DexClient) async throws -> String {
        try await client.call("regenerateSessionTitle", .string(id), timeout: 60)
    }
    static func mute(_ id: String, _ muted: Bool, client: DexClient) async throws {
        try await client.run("setSessionMuted", .string(id), .bool(muted))
    }
    static func delete(_ id: String, client: DexClient) async throws {
        try await client.run("deleteSession", .string(id), timeout: 60)
    }
}

struct ChatRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10).fill(.quaternary).frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 4) {
                LineBone(width: 180)
                LineBone(width: 90, font: .caption)
            }
        }
        .padding(.vertical, 2)
        .redacted(reason: .placeholder)
    }
}
