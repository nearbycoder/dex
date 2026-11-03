import DexCore
import GameController
import SwiftUI

/// Going from chat to chat while several run at once: a strip over a chat (iPhone) with the other chats that are working
/// or have a reply waiting, and the switcher (⌘K, or the strip's last button) with every chat, the active ones first.

/// How a chat is doing, for the strip and the switcher.
enum ChatActivity {
    case waiting, working, unread, draft, idle

    init(_ session: SessionMeta, draft: Bool, waiting: Bool = false) {
        // Working wins: it's what's happening now.
        self = session.busy ? .working : waiting ? .waiting : session.unread ? .unread : draft ? .draft : .idle
    }

    var label: String {
        switch self {
        case .waiting: "needs you"
        case .working: "working"
        case .unread: "new reply"
        case .draft: "draft"
        case .idle: ""
        }
    }
}

/// A chat's state as a small mark: a pulsing green dot while it works, the unread dot, a pencil for a draft.
struct ChatActivityMark: View {
    let activity: ChatActivity

    var body: some View {
        switch activity {
        case .waiting:
            Image(systemName: "hand.raised.fill").font(.caption2).foregroundStyle(.orange).accessibilityHidden(true)
        case .working:
            Circle().fill(.green).frame(width: 8, height: 8)
                .phaseAnimator([1.0, 0.3]) { view, phase in view.opacity(phase) }
                .accessibilityHidden(true)
        case .unread:
            Circle().fill(Color.dexAccent).frame(width: 8, height: 8).accessibilityHidden(true)
        case .draft:
            Image(systemName: "pencil").font(.caption2.weight(.bold)).foregroundStyle(.orange).accessibilityHidden(true)
        case .idle:
            EmptyView()
        }
    }
}

/// The chat's name in lists: a sidekick's conversation goes by the sidekick.
@MainActor
func chatName(_ session: SessionMeta, state: DexState?) -> String {
    state?.character(session.characterId)?.name ?? session.title
}

/// Over a chat on iPhone: the other chats that are working or have a reply waiting, one tap away, and the switcher.
struct ActiveChatsStrip: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let current: String

    var body: some View {
        let waiting = client.state?.waitingChats ?? []
        let active = Inbox.active(client.state?.sessions ?? [], waiting: waiting, excluding: current)
        if !active.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 6) {
                    HStack(spacing: 6) {
                        ForEach(active.prefix(8)) { session in
                            Button {
                                router.openChat(session.id)
                            } label: {
                                HStack(spacing: 6) {
                                    ChatActivityMark(activity: ChatActivity(session, draft: false, waiting: waiting.contains(session.id)))
                                    Text(chatName(session, state: client.state))
                                        .lineLimit(1)
                                        .frame(maxWidth: 150, alignment: .leading)
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                                .font(.footnote.weight(session.unread ? .semibold : .regular))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .contentShape(.capsule)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: .capsule)
                            .accessibilityLabel("\(chatName(session, state: client.state)), \(ChatActivity(session, draft: false, waiting: waiting.contains(session.id)).label)")
                            .accessibilityHint("Opens this chat")
                            .accessibilityIdentifier("strip.chat.\(session.id)")
                        }
                        Button {
                            router.switcherOpen = true
                        } label: {
                            Image(systemName: "rectangle.stack")
                                .font(.footnote.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .contentShape(.capsule)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .accessibilityLabel("All chats")
                        .accessibilityIdentifier("strip.switcher")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                }
            }
            // Clipped to the bar: unclipped, the chips ran under the foldable cover screen's side rail.
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Other active chats")
            .accessibilityIdentifier("strip")
        }
    }
}

/// Every chat, to jump to: New Chat first, then the working ones, those with a reply waiting, those with a draft, and the
/// rest of the inbox. Type to filter; ↑/↓ and Return on a keyboard.
struct ChatSwitcher: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var highlighted = 0
    /// The highlight is for the keyboard (Return opens it): shown with a hardware keyboard, or once you type.
    @State private var keyboard = GCKeyboard.coalesced != nil
    /// Opens tall: the more chats it shows, the fewer you scroll.
    @State private var detent = PresentationDetent.large
    @FocusState private var searching: Bool

    private struct Group: Identifiable {
        let title: String
        let chats: [SessionMeta]
        var id: String { title }
    }

    var body: some View {
        let groups = groups()
        let order = groups.flatMap(\.chats)
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    Section {
                        TextField("Find a chat", text: $query)
                            .focused($searching)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit { open(order, at: highlighted) }
                            .onKeyPress(keys: [.upArrow, .downArrow], phases: .down) { press in
                                guard !order.isEmpty else { return .ignored }
                                keyboard = true
                                highlighted = min(max(highlighted + (press.key == .downArrow ? 1 : -1), 0), order.count - 1)
                                proxy.scrollTo(order[highlighted].id)
                                return .handled
                            }
                            .accessibilityIdentifier("switcher.search")
                        if query.isEmpty {
                            Button {
                                dismiss()
                                router.newChat()
                            } label: {
                                Label("New Chat", systemImage: "square.and.pencil")
                            }
                            .accessibilityIdentifier("switcher.new")
                        }
                    }
                    ForEach(groups) { group in
                        Section(group.title) {
                            ForEach(group.chats) { session in
                                let index = order.firstIndex { $0.id == session.id } ?? 0
                                Button { open(order, at: index) } label: {
                                    SwitcherRow(session: session, current: router.chat == session.id)
                                }
                                .tint(.primary)
                                .listRowBackground(index == highlighted && (keyboard || !query.isEmpty) ? Color.dexAccent.opacity(0.14) : nil)
                                .accessibilityIdentifier("switcher.chat.\(session.id)")
                                .id(session.id)
                            }
                        }
                    }
                    if !query.isEmpty, order.isEmpty {
                        ContentUnavailableView.search(text: query).listRowBackground(Color.clear)
                    }
                }
            }
            .navigationTitle("Switch Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
            }
            .onChange(of: query) { highlighted = 0 }
            .task {
                // A hardware keyboard types straight into the filter (⌘K, then a few letters, then Return).
                if GCKeyboard.coalesced != nil { searching = true }
            }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("switcher")
    }

    private func groups() -> [Group] {
        let sessions = client.state?.sessions ?? []
        let words = query.lowercased().split(separator: " ").map(String.init)
        let matching = words.isEmpty ? sessions : sessions.filter { session in
            let name = chatName(session, state: client.state).lowercased()
            return words.allSatisfy { name.contains($0) }
        }
        let waiting = client.state?.waitingChats ?? []
        let active = Inbox.active(matching, waiting: waiting)
        let activeIds = Set(active.map(\.id))
        let drafts = matching.filter { !activeIds.contains($0.id) && Drafts.shared.drafted.contains($0.id) }.sorted { $0.updatedAt > $1.updatedAt }
        let shown = activeIds.union(drafts.map(\.id))
        // The rest: the inbox (newest first), then, when searching, everything else that matches.
        let rest = matching.filter { !shown.contains($0.id) && $0.characterId == nil && (!words.isEmpty || Inbox.place(of: $0) == .inbox) }
            .sorted { $0.updatedAt > $1.updatedAt }
        return [
            Group(title: "Needs You", chats: active.filter { !$0.busy && waiting.contains($0.id) }),
            Group(title: "Working", chats: active.filter(\.busy)),
            Group(title: "New Replies", chats: active.filter { !$0.busy && !waiting.contains($0.id) }),
            Group(title: "Drafts", chats: drafts),
            Group(title: words.isEmpty ? "Inbox" : "Other Chats", chats: Array(rest.prefix(words.isEmpty ? 30 : 60)))
        ].filter { !$0.chats.isEmpty }
    }

    private func open(_ order: [SessionMeta], at index: Int) {
        guard order.indices.contains(index) else { return }
        dismiss()
        router.openChat(order[index].id)
    }
}

private struct SwitcherRow: View {
    @Environment(DexClient.self) private var client
    let session: SessionMeta
    let current: Bool

    var body: some View {
        let character = client.state?.character(session.characterId)
        let agent = client.state?.agent(session.agentId)
        let project = client.state?.project(session.projectId)
        let activity = ChatActivity(session, draft: Drafts.shared.drafted.contains(session.id), waiting: client.state?.waitingChats.contains(session.id) == true)
        HStack(spacing: 10) {
            Group {
                if let character {
                    CharacterAvatar(character, size: 28, typing: session.busy)
                } else if let project {
                    AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 28)
                } else if let agent {
                    AgentAvatar(icon: agent.icon, color: agent.color, size: 28)
                } else {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color.secondary.opacity(0.14), in: .rect(cornerRadius: 8, style: .continuous))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(chatName(session, state: client.state))
                    .font(.body.weight(session.unread ? .semibold : .regular))
                    .lineLimit(1)
                Group {
                    if activity == .draft, let preview = Drafts.shared.preview(session.id) {
                        Text("Draft: \(preview)").foregroundStyle(.orange)
                    } else if let reply = session.lastReply, session.unread, !session.busy {
                        Text(reply)
                    } else {
                        Text([project?.name, agent?.name, client.catalog.name(of: session.model)].compactMap { $0 }.joined(separator: " · "))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 4)
            ChatActivityMark(activity: activity)
            if current {
                Text("Open").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityValue(activity.label)
    }
}
