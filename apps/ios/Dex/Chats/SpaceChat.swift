import DexCore
import SwiftUI

// A space's chats: the coordinator's (its threads as cards and the updates they send, a Threads button and panel, its
// menu) and its threads' (a way back to the space).

/// The space panel to open: its threads, or the coordinator's notes.
struct SpacePanelRequest: Identifiable, Hashable {
    enum Tab: String, Hashable, CaseIterable { case threads, notes }
    let spaceId: String
    var tab: Tab = .threads
    var id: String { spaceId }
}

/// A thread's status as a small colored chip ("Working" pulses).
struct ThreadStatusChip: View {
    let status: ThreadStatus

    var body: some View {
        HStack(spacing: 4) {
            if status == .working {
                Circle().fill(.green).frame(width: 6, height: 6)
                    .phaseAnimator([1.0, 0.3]) { view, phase in view.opacity(phase) }
            } else {
                Image(systemName: Self.symbol(status)).font(.system(size: 9, weight: .bold))
            }
            Text(status.label)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(Self.color(status))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Self.color(status).opacity(0.14), in: .capsule)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
    }

    static func color(_ status: ThreadStatus) -> Color {
        switch status {
        case .needsYou: .orange
        case .working: .green
        case .failed: .red
        case .done: .blue
        case .new: .secondary
        }
    }

    static func symbol(_ status: ThreadStatus) -> String {
        switch status {
        case .needsYou: "hand.raised.fill"
        case .working: "circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .done: "checkmark"
        case .new: "circle.dashed"
        }
    }
}

/// A thread the coordinator started, in its reply: the thread's title, live status, and latest words. Tap to open it.
struct ThreadCard: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let id: String
    let title: String

    var body: some View {
        let session = client.state?.session(id)
        let status = session.map { Spaces.status(of: $0, pending: client.state?.access.pending ?? []) }
        Button {
            router.openChat(id)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dexAccent)
                    .frame(width: 32, height: 32)
                    .background(Color.dexAccent.opacity(0.14), in: .rect(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(session?.title ?? title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                        Spacer(minLength: 4)
                        if let status { ThreadStatusChip(status: status) }
                    }
                    if session == nil {
                        Text("This thread was deleted.").font(.caption).foregroundStyle(.secondary)
                    } else if let reply = session?.lastReply, !reply.isEmpty {
                        Text(reply).font(.caption).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.leading)
                    } else if status == .working {
                        Text("Working on it…").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if session != nil {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).padding(.top, 9)
                }
            }
            .padding(12)
            .frame(maxWidth: 560, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.quaternary))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(session == nil)
        .hoverEffect(.lift)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Thread: \(session?.title ?? title)")
        .accessibilityValue(status?.label ?? "Deleted")
        .accessibilityHint("Opens the thread")
        .accessibilityIdentifier("space.thread.card.\(id)")
    }
}

/// What the coordinator heard from its threads (`[Space update] …` messages): one compact row per thread that
/// finished, failed, or stopped, opening the thread; its final reply folds out under it.
struct SpaceUpdateRows: View {
    let updates: [SpaceUpdate]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(updates.enumerated()), id: \.offset) { _, update in
                SpaceUpdateRow(update: update)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("space.updates")
    }
}

private struct SpaceUpdateRow: View {
    @Environment(Router.self) private var router
    @Environment(DexClient.self) private var client
    let update: SpaceUpdate
    @State private var open = false

    var body: some View {
        // A VM helper's report (vm_agents) names its VM ("vm:<key>"), not a chat.
        let vmKey = update.threadId.hasPrefix("vm:") ? String(update.threadId.dropFirst(3)) : nil
        let exists = vmKey != nil || client.state?.session(update.threadId) != nil
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(color).font(.footnote.weight(.semibold))
                Button {
                    if let vmKey { router.openMachine(vmKey) } else { router.openChat(update.threadId) }
                } label: {
                    Text("“\(update.title)” \(update.outcome.rawValue)")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .disabled(!exists)
                .accessibilityHint(exists ? "Opens the thread" : "")
                .accessibilityIdentifier("space.update.\(update.threadId)")
                Spacer(minLength: 4)
                if !update.body.isEmpty {
                    Button {
                        withAnimation(.smooth(duration: 0.2)) { open.toggle() }
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.semibold))
                            .rotationEffect(.degrees(open ? 180 : 0))
                            .frame(width: 28, height: 24)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(open ? "Hide its reply" : "Show its reply")
                }
            }
            if open {
                MarkdownView(text: update.body, font: .footnote)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 22)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(color.opacity(0.08), in: .rect(cornerRadius: 12, style: .continuous))
        .frame(maxWidth: 560, alignment: .leading)
    }

    private var symbol: String {
        switch update.outcome {
        case .finished: "checkmark.circle.fill"
        case .failed: "xmark.octagon.fill"
        case .stopped: "stop.circle.fill"
        }
    }

    private var color: Color {
        switch update.outcome {
        case .finished: .green
        case .failed: .red
        case .stopped: .secondary
        }
    }
}

/// A thread's chat: which space it belongs to, and back to it.
struct ThreadBanner: View {
    @Environment(Router.self) private var router
    let space: SpaceProfile

    var body: some View {
        Button {
            router.openChat(space.sessionId)
        } label: {
            HStack(spacing: 8) {
                SpaceIcon(size: 20)
                Text("In space \(Text(space.name).fontWeight(.semibold))").lineLimit(1)
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            }
            .font(.footnote)
            .padding(.leading, 6)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.vertical, 6)
        .accessibilityLabel("In space \(space.name)")
        .accessibilityHint("Opens the space's chat")
        .accessibilityIdentifier("thread.space")
    }
}

/// The coordinator's header button: its threads, with how many there are (or, in orange, how many need you). Not a
/// Label: the toolbar would show only its icon.
struct SpaceThreadsButton: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let space: SpaceProfile

    var body: some View {
        let threads = client.state?.threads(of: space) ?? []
        let needsYou = Self.needsYou(space, state: client.state)
        let count = needsYou > 0 ? needsYou : threads.count
        Button {
            router.spacePanel = SpacePanelRequest(spaceId: space.id, tab: .threads)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "list.bullet.rectangle")
                if count > 0 {
                    Text("\(count)").font(.subheadline.weight(.semibold).monospacedDigit())
                }
            }
            .foregroundStyle(needsYou > 0 ? Color.orange : Color.dexAccent)
            .padding(.horizontal, 4)
        }
        .accessibilityLabel("Threads")
        .accessibilityValue(needsYou > 0 ? "\(needsYou) need you" : "\(threads.count)")
        .accessibilityIdentifier("space.threads")
    }

    static func needsYou(_ space: SpaceProfile, state: DexState?) -> Int {
        let pending = state?.access.pending ?? []
        return (state?.threads(of: space) ?? []).filter { Spaces.status(of: $0, pending: pending) == .needsYou }.count
    }
}

/// The coordinator's ⋯ menu: threads, notes, edit, mute, delete. No settle or snooze: a space isn't in the inbox.
struct SpaceChatMenu: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta
    let space: SpaceProfile
    var compact = false
    @State private var confirmDelete = false

    var body: some View {
        Menu {
            if compact, let vm = client.state?.vm(session.id), client.state?.vmConfigured == true {
                Button { router.openMachine(session.id) } label: {
                    Label("Machine", systemImage: "desktopcomputer")
                    Text(vm.setup.status == "running" ? "Setting up" : vm.status.capitalized)
                }
                Divider()
            }
            Button { router.spacePanel = SpacePanelRequest(spaceId: space.id, tab: .threads) } label: { Label("Threads", systemImage: "list.bullet.rectangle") }
                .accessibilityIdentifier("space.menu.threads")
            Button { router.spacePanel = SpacePanelRequest(spaceId: space.id, tab: .notes) } label: { Label("Notes", systemImage: "note.text") }
                .accessibilityIdentifier("space.menu.notes")
            Button { router.spaceSheet = .space(space.id) } label: { Label("Edit Space", systemImage: "pencil") }
                .accessibilityIdentifier("space.menu.edit")
            if let project = client.state?.project(space.projectId) {
                Button { router.open(.project(project.id), compact: compact) } label: { Label("\(project.name) Project", systemImage: "shippingbox") }
            }
            Button { client.perform { try await feed.setMuted(!session.muted) } } label: {
                session.muted ? Label("Unmute Notifications", systemImage: "bell") : Label("Mute Notifications", systemImage: "bell.slash")
            }
            .accessibilityIdentifier("chat.menu.mute")
            Button { router.switcherOpen = true } label: { Label("Switch Chat…", systemImage: "rectangle.stack") }
            if Router.canOpenWindows {
                Button { Router.openInNewWindow(session.id) } label: { Label("Open in New Window", systemImage: "macwindow.badge.plus") }
            }
            Divider()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Space…", systemImage: "trash") }
                .accessibilityIdentifier("space.menu.delete")
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        .accessibilityIdentifier("chat.menu")
        .deleteSpaceDialog(space, isPresented: $confirmDelete)
    }
}

/// A space's panel (a sheet over the chats): its threads by status, or the coordinator's notes.
struct SpacePanel: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    let spaceId: String
    @State var tab: SpacePanelRequest.Tab

    var body: some View {
        let space = client.state?.space(spaceId)
        NavigationStack {
            Group {
                if let space {
                    switch tab {
                    case .threads: SpaceThreadList(space: space) { open($0) }
                    case .notes: SpaceNotesView(space: space)
                    }
                } else {
                    ContentUnavailableView("Space Not Found", systemImage: "square.stack.3d.up.slash", description: Text("This space no longer exists."))
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Show", selection: $tab) {
                    Text("Threads").tag(SpacePanelRequest.Tab.threads)
                    Text("Notes").tag(SpacePanelRequest.Tab.notes)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .accessibilityIdentifier("space.panel.tab")
            }
            .navigationTitle(space?.name ?? "Space")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("space.panel.close")
                }
                if let space {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            dismiss()
                            router.spaceSheet = .space(space.id)
                        } label: { Label("Edit Space", systemImage: "pencil") }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("space.panel")
    }

    private func open(_ id: String) {
        dismiss()
        router.openChat(id)
    }
}

/// A space's threads grouped by status (what needs you first), each with its latest words and when.
struct SpaceThreadList: View {
    @Environment(DexClient.self) private var client
    let space: SpaceProfile
    let open: (String) -> Void

    var body: some View {
        let threads = client.state?.threads(of: space) ?? []
        let groups = Spaces.grouped(threads, pending: client.state?.access.pending ?? [])
        List {
            if threads.isEmpty {
                EmptyStateView(title: "No Threads Yet", symbol: "list.bullet.rectangle", message: "Tell Dex what to work on. It starts threads for each piece of work and reports back here.")
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            ForEach(groups, id: \.status) { group in
                Section {
                    ForEach(group.threads) { thread in
                        Button { open(thread.id) } label: { ThreadRow(thread: thread, status: group.status) }
                            .tint(.primary)
                            .accessibilityIdentifier("space.thread.\(thread.id)")
                    }
                } header: {
                    HStack(spacing: 6) {
                        Text(group.status.label)
                        Text("\(group.threads.count)").foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .animation(.smooth, value: groups.map { "\($0.status.rawValue):\($0.threads.map(\.id))" })
    }
}

private struct ThreadRow: View {
    let thread: SessionMeta
    let status: ThreadStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(thread.title).font(.body.weight(.medium)).lineLimit(2)
                Spacer(minLength: 4)
                Text(Format.ago(thread.repliedAt ?? thread.updatedAt)).font(.caption).foregroundStyle(.secondary).fixedSize()
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ThreadStatusChip(status: status)
                if let reply = thread.lastReply, !reply.isEmpty {
                    Text(reply).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// The coordinator's notes, as Markdown: loaded when shown, and again whenever the coordinator finishes a reply.
struct SpaceNotesView: View {
    @Environment(DexClient.self) private var client
    let space: SpaceProfile
    @State private var notes: String?
    @State private var error: String?

    var body: some View {
        let busy = client.state?.session(space.sessionId)?.busy == true
        ScrollView {
            Group {
                if let notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    MarkdownView(text: notes)
                        .textSelection(.enabled)
                } else if notes != nil {
                    EmptyStateView(title: "No Notes Yet", symbol: "note.text", message: "Dex keeps a summary, its decisions, and a ledger of the work here as the threads go.")
                        .padding(.top, 40)
                } else if let error {
                    EmptyStateView(title: "Couldn't Load the Notes", symbol: "exclamationmark.triangle", message: error)
                        .padding(.top, 40)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        LineBone(width: 180, font: .title2)
                        LineBone()
                        LineBone(width: 260)
                        LineBone(width: 220)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
        .refreshable { await load() }
        .accessibilityIdentifier("space.notes")
        // When shown, and when the coordinator finishes a reply (it may have updated them).
        .task(id: busy) { if !busy { await load() } }
    }

    private func load() async {
        do {
            notes = try await client.spaceNotes(space.id)
            error = nil
        } catch {
            if notes == nil { self.error = error.localizedDescription }
        }
    }
}
