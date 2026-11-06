import DexCore
import SwiftUI

/// Spaces, listed with the sidekicks above the chats: each opens its coordinator's chat (and is selected while it, or
/// one of its threads, is open). Until you have one, a single quiet row offers to start one. A search shows the spaces
/// it finds, or none.
struct SpacesSection: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var filter = ""

    var body: some View {
        let all = client.state?.spaces ?? []
        let spaces = Self.matching(all, filter)
        if client.state != nil, filter.isEmpty || !spaces.isEmpty {
            Section {
                if all.isEmpty {
                    Button { router.spaceSheet = .new } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "plus")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(width: 36, height: 36)
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(.tertiary))
                            Text("Start a space to run work in parallel")
                                .font(.subheadline)
                        }
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 3)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .selectionDisabled()
                    .accessibilityIdentifier("spaces.empty")
                }
                ForEach(spaces) { space in
                    SpaceChatRow(space: space).tag(ChatSelection.chat(space.sessionId))
                }
            } header: {
                HStack {
                    Text("Spaces")
                    Spacer()
                    Button { router.spaceSheet = .new } label: {
                        Image(systemName: "plus").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.borderless)
                    .tint(.dexAccent)
                    .accessibilityLabel("New Space")
                    .accessibilityIdentifier("spaces.new")
                }
            }
        }
    }
}

extension SpacesSection {
    /// The spaces a search finds (all of them without one).
    static func matching(_ spaces: [SpaceProfile], _ filter: String) -> [SpaceProfile] {
        filter.isEmpty ? spaces : spaces.filter { $0.name.localizedCaseInsensitiveContains(filter) || $0.goal.localizedCaseInsensitiveContains(filter) }
    }
}

/// A space's mark: stacked layers on the accent, with a pulsing dot while the coordinator or any thread works.
struct SpaceIcon: View {
    var size: CGFloat = 36
    var working = false

    var body: some View {
        Image(systemName: "square.stack.3d.up.fill")
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color.dexAccent.gradient, in: .rect(cornerRadius: size * 0.28, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                if working {
                    Circle().fill(.green).frame(width: size * 0.3, height: size * 0.3)
                        .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                        .phaseAnimator([1.0, 0.4]) { view, phase in view.opacity(phase) }
                        .offset(x: 3, y: 3)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityHidden(true)
    }
}

/// One space in the chat list: its mark, name, and what its threads are up to ("2 working · 1 needs you"), else its
/// goal; bold with a dot when the coordinator has said something you haven't seen.
struct SpaceChatRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let space: SpaceProfile
    @State private var confirmDelete = false

    var body: some View {
        let state = client.state
        let session = state?.session(space.sessionId)
        let threads = state?.threads(of: space) ?? []
        let working = session?.busy == true || threads.contains(where: \.busy)
        let unread = session?.unread == true
        let summary = Spaces.summary(space, threads: threads, pending: state?.access.pending ?? [])
        HStack(spacing: 12) {
            SpaceIcon(size: 36, working: working)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if unread { UnreadDot() }
                    Text(space.name)
                        .font(.body.weight(unread ? .semibold : .medium))
                        .lineLimit(1)
                    if session?.muted == true {
                        Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Muted")
                    }
                    Spacer(minLength: 4)
                    if let session, !working, session.updatedAt > session.createdAt + 1_000 {
                        Text(Format.ago(session.repliedAt ?? session.updatedAt)).font(.caption).foregroundStyle(unread ? Color.dexAccent : .secondary).fixedSize()
                    }
                }
                if session?.busy == true, threads.allSatisfy({ !$0.busy }) {
                    Text("Coordinating…").font(.caption).foregroundStyle(Color.dexAccent).lineLimit(1)
                } else {
                    Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 3)
        .contentShape(.rect)
        .hoverEffect(.highlight)
        .accessibilityElement(children: .combine)
        .accessibilityValue(working ? "working" : "")
        .accessibilityIdentifier("space.row.\(space.id)")
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let session { UnreadSwipeButton(session: session) }
        }
        .contextMenu {
            Section(space.name) {
                Button { router.spacePanel = SpacePanelRequest(spaceId: space.id, tab: .threads) } label: { Label("Threads", systemImage: "list.bullet.rectangle") }
                Button { router.spaceSheet = .space(space.id) } label: { Label("Edit Space", systemImage: "pencil") }
            }
            if let session { MarkUnreadButton(session: session) }
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Space…", systemImage: "trash") }
        }
        .deleteSpaceDialog(space, isPresented: $confirmDelete)
    }
}

extension View {
    /// Asks before deleting a space with its chat and threads.
    func deleteSpaceDialog(_ space: SpaceProfile?, isPresented: Binding<Bool>, then deleted: @escaping () -> Void = {}) -> some View {
        modifier(DeleteSpaceDialog(space: space, isPresented: isPresented, deleted: deleted))
    }
}

private struct DeleteSpaceDialog: ViewModifier {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let space: SpaceProfile?
    @Binding var isPresented: Bool
    let deleted: () -> Void

    func body(content: Content) -> some View {
        let count = space.map { client.state?.threads(of: $0).count ?? 0 } ?? 0
        content.confirmationDialog("Delete “\(space?.name ?? "")”?", isPresented: $isPresented, titleVisibility: .visible) {
            Button("Delete Space", role: .destructive) {
                guard let space else { return }
                // Out of its chats first, so nothing shows them disappearing.
                let chats = Set([space.sessionId] + (client.state?.threads(of: space).map(\.id) ?? []))
                if let open = router.chat, chats.contains(open) { router.chatSelection = nil }
                router.closeLibrary(.space(space.id))
                deleted()
                client.perform { try await client.deleteSpace(space.id) }
            }
            .accessibilityIdentifier("space.delete.confirm")
        } message: {
            Text("Deletes the space, its chat, and its \(count == 1 ? "1 thread" : "\(count) threads") with their VMs. This can't be undone.")
        }
    }
}
