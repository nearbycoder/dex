import DexCore
import SwiftUI

/// One chat: its transcript (pinned to the latest message), the queue, and the composer.
struct ChatView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let sessionId: String
    @State private var feed: ChatFeed?
    @State private var renaming = false
    @State private var title = ""

    var body: some View {
        Group {
            if let feed {
                content(feed)
            } else {
                ProgressView()
            }
        }
        .onAppear {
            if feed == nil { feed = client.chat(sessionId) }
        }
    }

    @ViewBuilder
    private func content(_ feed: ChatFeed) -> some View {
        let session = client.state?.session(sessionId)
        if client.state != nil, session == nil {
            EmptyStateView(title: "Chat not found", symbol: "bubble.left.and.exclamationmark.bubble.right", message: "This chat no longer exists.")
        } else {
            TranscriptView(feed: feed)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ChatComposerArea(feed: feed, session: session)
                }
                .navigationTitle(session?.title ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar(feed: feed, session: session) }
                .toolbarTitleMenu {
                    if let session {
                        Button {
                            title = session.title
                            renaming = true
                        } label: { Label("Rename", systemImage: "pencil") }
                        AsyncButton(action: { _ = try await feed.regenerateTitle() }) { Label("Regenerate Title", systemImage: "sparkles") }
                    }
                }
                .alert("Rename Chat", isPresented: $renaming) {
                    TextField("Title", text: $title)
                    Button("Save") { client.perform { try await feed.rename(title) } }
                    Button("Cancel", role: .cancel) {}
                }
                .overlay(alignment: .bottomTrailing) {
                    if let vm = client.state?.vm(sessionId), vm.status == "running" || vm.status == "starting" {
                        VmPreviewOverlay(vm: vm)
                    }
                }
        }
    }

    @ToolbarContentBuilder
    private func toolbar(feed: ChatFeed, session: SessionMeta?) -> some ToolbarContent {
        if let session {
            if let vm = client.state?.vm(sessionId), client.state?.vmConfigured == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        router.openMachine(sessionId)
                    } label: {
                        Label {
                            Text(vm.setup.status == "running" ? "Setting up" : "Machine")
                        } icon: {
                            Image(systemName: "desktopcomputer")
                                .overlay(alignment: .topTrailing) { StatusDot(kind: StatusDot.vm(vm), size: 7).offset(x: 3, y: -2) }
                        }
                    }
                    .accessibilityIdentifier("chat.machine")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    client.perform { try await feed.settle(session.settledAt == nil) }
                } label: {
                    Label(session.settledAt == nil ? "Settle" : "Move to Inbox", systemImage: session.settledAt == nil ? "checkmark.circle" : "checkmark.circle.fill")
                }
                .accessibilityIdentifier("chat.settle")
            }
            ToolbarItem(placement: .topBarTrailing) {
                ChatMenu(feed: feed, session: session)
            }
        }
    }
}

/// The chat's ⋯ menu: mute, snooze, settle, regenerate the title, delete.
struct ChatMenu: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta
    @State private var confirmDelete = false

    var body: some View {
        Menu {
            AsyncButton(action: { _ = try await feed.regenerateTitle() }) { Label("Regenerate Title", systemImage: "sparkles") }
            Menu {
                ForEach(Inbox.snoozeOptions()) { option in
                    Button(option.label) { client.perform { try await feed.snooze(until: option.at.timeIntervalSince1970 * 1000) } }
                }
                if session.snoozedUntil != nil {
                    Button("Unsnooze") { client.perform { try await feed.snooze(until: nil) } }
                }
            } label: { Label("Snooze", systemImage: "moon.zzz") }
            Button {
                client.perform { try await feed.setMuted(!session.muted) }
            } label: {
                session.muted ? Label("Unmute Notifications", systemImage: "bell") : Label("Mute Notifications", systemImage: "bell.slash")
            }
            Divider()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Chat", systemImage: "trash") }
        } label: {
            Label("More", systemImage: "ellipsis")
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

/// The messages, pinned to the bottom while you're there, with a button back down when you've scrolled up.
struct TranscriptView: View {
    @Environment(DexClient.self) private var client
    let feed: ChatFeed
    @State private var atBottom = true
    @State private var position = ScrollPosition(edge: .bottom)

    var body: some View {
        let transcript = feed.transcript
        let items = transcript.displayItems
        let results = transcript.toolResults
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 18) {
                if !transcript.loaded {
                    TranscriptSkeleton()
                } else if items.isEmpty, feed.pending.isEmpty {
                    EmptyStateView(title: "New chat", symbol: "sparkles", message: "Ask Dex anything. It can browse, run code on its own VM, and answer with live UI.")
                        .padding(.top, 60)
                }
                ForEach(items) { item in
                    switch item {
                    case .user(let id, let text, let images):
                        UserBubble(text: text, images: images).id(id)
                    case .assistant(let id, let messages, let streaming, let endedAt):
                        ReplyView(feed: feed, messages: messages, streaming: streaming, endedAt: endedAt, results: results, tools: transcript.tools)
                            .id(id)
                    case .divider(let id, let label):
                        DividerRow(label: label).id(id)
                    }
                }
                ForEach(feed.pending) { pending in
                    UserBubble(text: pending.text, images: 0, pending: true)
                }
                if transcript.running, case .user? = items.last {
                    ThinkingPlaceholder()
                }
                if let retry = transcript.retry {
                    Label("Retrying: \(retry.error)", systemImage: "arrow.clockwise")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if let error = transcript.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(12)
                        .background(.red.opacity(0.08), in: .rect(cornerRadius: 12))
                        .accessibilityIdentifier("chat.error")
                }
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .scrollTargetLayout()
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.visibleRect.maxY >= geometry.contentSize.height - 80
        } action: { _, bottom in
            atBottom = bottom
        }
        .onChange(of: transcript.entries.count + (transcript.streaming?.content.count ?? 0) + feed.pending.count) {
            if atBottom { withAnimation(.smooth) { position.scrollTo(edge: .bottom) } }
        }
        .overlay(alignment: .bottom) {
            if !atBottom {
                Button {
                    withAnimation(.smooth) { position.scrollTo(edge: .bottom) }
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.body.weight(.semibold))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .padding(.bottom, 8)
                .transition(.scale.combined(with: .opacity))
                .accessibilityLabel("Scroll to latest")
                .accessibilityIdentifier("chat.scrollToBottom")
            }
        }
        .animation(.smooth, value: atBottom)
        .accessibilityIdentifier("chat.transcript")
    }
}

struct UserBubble: View {
    let text: String
    let images: Int
    var pending = false

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 4) {
                if images > 0 {
                    Label("\(images) image\(images == 1 ? "" : "s")", systemImage: "photo")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(Color.accentColor.gradient, in: .rect(cornerRadius: 20, style: .continuous))
                    .opacity(pending ? 0.6 : 1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(pending ? "chat.pending" : "chat.user")
    }
}

struct DividerRow: View {
    let label: String
    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(.quaternary).frame(height: 1)
            Text(label).font(.caption).foregroundStyle(.secondary).fixedSize()
            Rectangle().fill(.quaternary).frame(height: 1)
        }
    }
}

struct ThinkingPlaceholder: View {
    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Thinking…").font(.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("chat.thinking")
    }
}

struct TranscriptSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Spacer(); Capsule().fill(.quaternary).frame(width: 200, height: 40) }
            LineBone(width: 280)
            LineBone()
            LineBone(width: 220)
            HStack { Spacer(); Capsule().fill(.quaternary).frame(width: 140, height: 40) }
            LineBone()
            LineBone(width: 160)
        }
        .padding(.top, 20)
    }
}
