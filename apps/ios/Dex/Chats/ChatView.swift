import DexCore
import SwiftUI

/// One chat: its header (agent and project, title, machine, mute, settle, menu), its transcript (pinned to the latest
/// message), the queue, and the composer.
struct ChatView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    let sessionId: String
    @State private var feed: ChatFeed?
    @State private var composer = ComposerModel()
    @State private var links = LinkOpener()
    @State private var renaming = false
    @State private var draft = ""

    var body: some View {
        Group {
            if let feed {
                content(feed)
            } else {
                TranscriptSkeleton().frame(maxHeight: .infinity, alignment: .top).padding(.horizontal, 16)
            }
        }
        .environment(links)
        // A phone in landscape is too short for the tab bar and the transcript; going back to the list brings it back.
        .toolbarVisibility(sizeClass == .compact && verticalSizeClass == .compact ? .hidden : .automatic, for: .tabBar)
        .onAppear {
            if feed == nil { feed = client.chat(sessionId) }
            Notifications.shared.clear(sessionId: sessionId)
        }
    }

    @ViewBuilder
    private func content(_ feed: ChatFeed) -> some View {
        let session = client.state?.session(sessionId)
        if client.state != nil, session == nil {
            EmptyStateView(title: "Chat not found", symbol: "bubble.left.and.exclamationmark.bubble.right", message: "This chat no longer exists.")
        } else {
            TranscriptView(feed: feed, composer: composer, send: { text in sendNow(text, feed: feed) })
                .environment(\.chatFeed, feed)
                .environment(\.markdownMedia, ChatMediaView.resolver(server: client.server))
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ChatComposerArea(feed: feed, session: session, composer: composer) { text, attachments in
                        try await send(text, attachments: attachments, feed: feed)
                    }
                }
                .navigationTitle(session?.title ?? "")
                .navigationSubtitle(subtitle(session))
                .navigationBarTitleDisplayMode(.inline)
                .toolbarTitleMenu {
                    if let session {
                        ChatTitleMenu(session: session) {
                            draft = session.title
                            renaming = true
                        }
                    }
                }
                .toolbar { ChatToolbar(feed: feed, session: session) }
                .alert("Rename Chat", isPresented: $renaming) {
                    TextField("Title", text: $draft).accessibilityIdentifier("chat.rename.field")
                    Button("Save") { client.perform { try await feed.rename(draft) } }
                        .keyboardShortcut(.defaultAction)
                    Button("Cancel", role: .cancel) {}
                }
                .overlay(alignment: .bottomTrailing) {
                    if let vm = client.state?.vm(sessionId), vm.status == "running" || vm.status == "starting" {
                        VmPreviewOverlay(vm: vm)
                    }
                }
        }
    }

    /// Under the title: "Writing a new title…" while one is being written, else the chat's project and agent.
    private func subtitle(_ session: SessionMeta?) -> String {
        guard let session else { return "" }
        if TitleNaming.shared.isNaming(session.id) { return "Writing a new title…" }
        return [client.state?.project(session.projectId)?.name, client.state?.agent(session.agentId)?.name].compactMap { $0 }.joined(separator: " · ")
    }

    private func send(_ text: String, attachments: [ChatAttachment] = [], feed: ChatFeed) async throws {
        Notifications.shared.requestPermissionIfNeeded()
        try await feed.send(text, attachments: attachments)
    }

    /// Sends without waiting (a retry, a message from a card), reporting a failure as the notice.
    private func sendNow(_ text: String, feed: ChatFeed) {
        client.perform { try await send(text, feed: feed) }
    }
}

/// The chat's header: its agent and project (to their Library pages), its title (tap for rename and a new title),
/// the machine, mute, settle, and the chat's menu.
struct ChatToolbar: ToolbarContent {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    let feed: ChatFeed
    let session: SessionMeta?

    var body: some ToolbarContent {
        if sizeClass != .compact, let session, session.projectId != nil || session.agentId != nil {
            ToolbarItem(placement: .topBarLeading) {
                ChatAvatars(session: session)
            }
        }
        if let session {
            // iPad and an unfolded foldable: the machine, mute, and settle as buttons. On iPhone they're in the menu
            // (iOS folds several buttons beside a title menu into an overflow menu anyway).
            if sizeClass != .compact {
                if let vm = client.state?.vm(session.id), client.state?.vmConfigured == true {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            router.openMachine(session.id)
                        } label: {
                            Label {
                                Text(vm.setup.status == "running" ? "Setting up" : "Machine")
                            } icon: {
                                Image(systemName: "desktopcomputer")
                                    .overlay(alignment: .topTrailing) { StatusDot(kind: StatusDot.vm(vm), size: 7).offset(x: 4, y: -3) }
                            }
                        }
                        .accessibilityLabel(vm.setup.status == "running" ? "Machine, setting up" : "Machine, \(vm.status)")
                        .accessibilityHint("Watch or take over this chat's VM")
                        .accessibilityIdentifier("chat.machine")
                    }
                }
                if showsMute {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            client.perform { try await feed.setMuted(!session.muted) }
                        } label: {
                            Label(session.muted ? "Unmute" : "Mute", systemImage: session.muted ? "bell.slash.fill" : "bell")
                        }
                        .tint(session.muted ? .orange : nil)
                        .accessibilityLabel(session.muted ? "Notifications muted for this chat" : "Mute notifications for this chat")
                        .accessibilityIdentifier("chat.mute")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        client.perform { try await feed.settle(session.settledAt == nil) }
                    } label: {
                        Label(session.settledAt == nil ? "Settle" : "Move to Inbox", systemImage: session.settledAt == nil ? "checkmark.circle" : "checkmark.circle.fill")
                    }
                    .tint(session.settledAt == nil ? nil : .green)
                    .accessibilityLabel(session.settledAt == nil ? "Settle: done for now" : "Settled. Move it back to the inbox")
                    .accessibilityIdentifier("chat.settle")
                    .sensoryFeedback(.success, trigger: session.settledAt != nil) { _, new in new }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                ChatMenu(feed: feed, session: session, includeMute: sizeClass == .compact || !showsMute, compact: sizeClass == .compact)
            }
        }
    }

    /// Mute matters once some device gets notifications: a browser with push on, or this one.
    private var showsMute: Bool {
        (client.state?.push.devices.isEmpty == false) || Notifications.shared.authorized
    }
}

/// The title's menu: rename, a new title, and (on iPhone, where the header has no room for them) the chat's project
/// and agent.
struct ChatTitleMenu: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    let session: SessionMeta
    let rename: () -> Void

    var body: some View {
        Button(action: rename) { Label("Rename", systemImage: "pencil") }
            .accessibilityIdentifier("chat.rename")
        Button {
            TitleNaming.shared.regenerate(session.id, client: client)
        } label: { Label("Regenerate Title", systemImage: "sparkles") }
            .disabled(TitleNaming.shared.isNaming(session.id))
            .accessibilityIdentifier("chat.regenerate")
        if sizeClass == .compact {
            if let project = client.state?.project(session.projectId) {
                Button { router.open(.project(project.id), compact: true) } label: { Label("\(project.name) Project", systemImage: "shippingbox") }
                    .accessibilityIdentifier("chat.project")
            }
            if let agent = client.state?.agent(session.agentId) {
                Button { router.open(.agent(agent.id), compact: true) } label: { Label("\(agent.name) Agent", systemImage: AgentIcons.symbol(agent.icon)) }
                    .accessibilityIdentifier("chat.agent")
            }
        }
    }
}

/// The chat's project and agent, each opening its Library page.
struct ChatAvatars: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let session: SessionMeta

    var body: some View {
        HStack(spacing: 6) {
            if let project = client.state?.project(session.projectId) {
                Button { router.open(.project(project.id), compact: false) } label: {
                    AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 28)
                }
                .buttonStyle(.plain)
                .hoverEffect(.lift)
                .accessibilityLabel("\(project.name) project")
                .accessibilityIdentifier("chat.project")
            }
            if let agent = client.state?.agent(session.agentId) {
                Button { router.open(.agent(agent.id), compact: false) } label: {
                    AgentAvatar(icon: agent.icon, color: agent.color, size: 28)
                }
                .buttonStyle(.plain)
                .hoverEffect(.lift)
                .accessibilityLabel("\(agent.name) agent")
                .accessibilityIdentifier("chat.agent")
            }
        }
        .padding(.horizontal, 4)
    }
}

/// The chat's ⋯ menu: a new title, settle or back to the inbox, snooze (with when each option wakes it), mute, delete.
struct ChatMenu: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta
    var includeMute = true
    /// iPhone: the menu also holds the machine and Settle.
    var compact = false
    @State private var confirmDelete = false

    var body: some View {
        let place = Inbox.place(of: session)
        Menu {
            if compact, let vm = client.state?.vm(session.id), client.state?.vmConfigured == true {
                Button { router.openMachine(session.id) } label: {
                    Label { Text("Machine"); Text(vm.setup.status == "running" ? "Setting up" : vm.status.capitalized) } icon: { Image(systemName: "desktopcomputer") }
                }
                .accessibilityIdentifier("chat.menu.machine")
                Divider()
            }
            if place == .settled {
                Button { client.perform { try await feed.settle(false) } } label: { Label("Move to Inbox", systemImage: "tray.and.arrow.up") }
                    .accessibilityIdentifier("chat.menu.settle")
            } else {
                Button { client.perform { try await feed.settle(true) } } label: { Label("Settle", systemImage: "checkmark.circle") }
                    .accessibilityIdentifier("chat.menu.settle")
            }
            Button { TitleNaming.shared.regenerate(session.id, client: client) } label: { Label("Regenerate Title", systemImage: "sparkles") }
            if place == .snoozed, let until = session.snoozedUntil {
                Button { client.perform { try await feed.snooze(until: nil) } } label: {
                    Label("Unsnooze (\(Inbox.snoozedLabel(until)))", systemImage: "alarm.waves.left.and.right")
                }
                .accessibilityIdentifier("chat.unsnooze")
            }
            Section("Snooze Until") {
                ForEach(Inbox.snoozeOptions()) { option in
                    Button { client.perform { try await feed.snooze(until: option.at.timeIntervalSince1970 * 1000) } } label: {
                        Label { Text(option.label); Text(snoozeTime(option.at)) } icon: { Image(systemName: "moon.zzz") }
                    }
                }
            }
            if includeMute {
                Button { client.perform { try await feed.setMuted(!session.muted) } } label: {
                    session.muted ? Label("Unmute Notifications", systemImage: "bell") : Label("Mute Notifications", systemImage: "bell.slash")
                }
                .accessibilityIdentifier("chat.menu.mute")
            }
            Divider()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Chat", systemImage: "trash") }
                .accessibilityIdentifier("chat.menu.delete")
        } label: {
            if compact, session.settledAt != nil {
                Label("More (settled)", systemImage: "checkmark.circle.fill")
            } else {
                Label("More", systemImage: "ellipsis")
            }
        }
        .accessibilityIdentifier("chat.menu")
        .confirmationDialog("Delete “\(session.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Chat", role: .destructive) {
                router.chatSelection = nil
                client.perform { try await feed.delete() }
            }
        } message: {
            Text("Its messages, files, and VM are deleted too.")
        }
    }
}

/// The bottom of a chat: a note when the model's subscription isn't connected, the queue, and the composer.
struct ChatComposerArea: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta?
    let composer: ComposerModel
    let send: (String, [ChatAttachment]) async throws -> Void

    var body: some View {
        VStack(spacing: 8) {
            if let session, let state = client.state, state.connectedProviders[client.catalog.provider(of: session.model)] != true {
                Button {
                    router.openSettings(.models)
                } label: {
                    Label("Connect \(ModelCatalog.providerName(client.catalog.provider(of: session.model))) to get answers, or pick another model", systemImage: "key.fill")
                        .font(.caption)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.borderless)
                .tint(.orange)
                .accessibilityIdentifier("chat.connectNote")
            }
            QueuePanel(feed: feed)
            Composer(
                model: composer,
                placeholder: feed.transcript.running ? "Queue a follow-up…" : "Message Dex, or / for skills…",
                running: feed.transcript.running,
                disabled: !client.isConnected,
                onSend: send,
                onStop: { try await feed.abort() }
            ) {
                if let session {
                    ModelPickerButton(model: session.model, thinking: session.thinking) { model, thinking in
                        client.perform { try await feed.configure(model: model, thinking: thinking) }
                    }
                    // Takes effect from the next model request, also mid-run.
                    McpPickerButton(selected: session.mcpServers) { servers in
                        client.perform { try await feed.configure(mcpServers: servers) }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: 800)
        .frame(maxWidth: .infinity)
    }
}
