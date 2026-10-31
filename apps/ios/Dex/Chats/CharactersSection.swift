import DexCore
import SwiftUI

/// Characters, pinned above the chats: each opens their conversation (and is selected while it's open). Until you
/// have one, a single quiet row offers to make one. A search shows the characters it finds, or none.
struct CharactersSection: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    var filter = ""

    var body: some View {
        let all = client.state?.characters ?? []
        let characters = Self.matching(all, filter)
        if client.state != nil, filter.isEmpty || !characters.isEmpty {
            Section {
                if all.isEmpty {
                    Button { router.characterSheet = .new } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "plus")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(width: 36, height: 36)
                                .overlay(Circle().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(.tertiary))
                            Text("Make a sidekick to talk to")
                                .font(.subheadline)
                        }
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 3)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .selectionDisabled()
                    .accessibilityIdentifier("characters.empty")
                }
                ForEach(characters) { character in
                    CharacterChatRow(character: character).tag(ChatSelection.chat(character.sessionId))
                }
            } header: {
                HStack {
                    Text("Sidekicks")
                    Spacer()
                    Button { router.characterSheet = .new } label: {
                        Image(systemName: "plus").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.borderless)
                    .tint(.dexAccent)
                    .accessibilityLabel("New Sidekick")
                    .accessibilityIdentifier("characters.new")
                }
            }
        }
    }
}

extension CharactersSection {
    /// The characters a search finds (all of them without one).
    static func matching(_ characters: [CharacterProfile], _ filter: String) -> [CharacterProfile] {
        filter.isEmpty ? characters : characters.filter { $0.name.localizedCaseInsensitiveContains(filter) || $0.tagline.localizedCaseInsensitiveContains(filter) }
    }
}

/// One character in the chat list: their face, name, and tagline, "typing…" while they answer, or (unread, bold with a
/// dot) what they said that you haven't seen; when you last talked.
struct CharacterChatRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let character: CharacterProfile
    @State private var confirmRestart = false

    var body: some View {
        let session = client.state?.session(character.sessionId)
        let busy = session?.busy == true
        let unread = session?.unread == true
        HStack(spacing: 12) {
            CharacterAvatar(character, size: 36, typing: busy)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if unread { UnreadDot() }
                    Text(character.name)
                        .font(.body.weight(unread ? .semibold : .medium))
                        .lineLimit(1)
                    if session?.muted == true || character.notifyLevel == .off {
                        Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Notifications off")
                    }
                    Spacer(minLength: 4)
                    // Once you've talked: when they last said something.
                    if let session, !busy, session.updatedAt > session.createdAt + 1_000 {
                        Text(Format.ago(session.repliedAt ?? session.updatedAt)).font(.caption).foregroundStyle(unread ? Color.dexAccent : .secondary).fixedSize()
                    }
                }
                if busy {
                    Text("typing…").font(.caption).foregroundStyle(Color.dexAccent)
                } else if unread, let reply = session?.lastReply, !reply.isEmpty {
                    // What they said while you were away.
                    // One line, as the tagline: the pinned rows don't jump when someone writes.
                    Text(reply).font(.caption).foregroundStyle(.primary).lineLimit(1)
                } else {
                    Text(character.tagline.isEmpty ? "Say hi" : character.tagline).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 3)
        .contentShape(.rect)
        .hoverEffect(.highlight)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("character.row.\(character.id)")
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let session { UnreadSwipeButton(session: session) }
        }
        .contextMenu {
            Section(character.name) {
                Button { router.characterSheet = .character(character.id) } label: { Label("About \(character.name)", systemImage: "person.text.rectangle") }
                Button { confirmRestart = true } label: { Label("Start Over", systemImage: "arrow.counterclockwise") }
            }
            if let session { MarkUnreadButton(session: session) }
            Picker(selection: Binding(get: { character.notifyLevel }, set: { level in
                client.perform { try await client.setCharacterNotify(character, level) }
            })) {
                ForEach(SidekickNotify.allCases) { level in
                    Text(level.label).tag(level)
                }
            } label: {
                Label { Text("Notify Me"); Text(character.notifyLevel.label) } icon: { Image(systemName: character.notifyLevel.symbol) }
            }
            .pickerStyle(.menu)
            if let session, session.muted {
                Button {
                    client.perform { try await ChatActions.mute(session.id, false, client: client) }
                } label: {
                    Label("Unmute", systemImage: "bell")
                }
            }
        }
        .startOverDialog(character, isPresented: $confirmRestart)
    }
}

extension View {
    /// Asks before starting a new conversation with a character, then opens it.
    func startOverDialog(_ character: CharacterProfile, isPresented: Binding<Bool>, then opened: @escaping () -> Void = {}) -> some View {
        modifier(StartOverDialog(character: character, isPresented: isPresented, opened: opened))
    }
}

private struct StartOverDialog: ViewModifier {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let character: CharacterProfile
    @Binding var isPresented: Bool
    let opened: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog("Start a new conversation with \(character.name)?", isPresented: $isPresented, titleVisibility: .visible) {
            Button("Start Over") {
                client.perform {
                    let fresh = try await client.restartCharacter(character.id)
                    opened()
                    router.openChat(fresh.sessionId)
                }
            }
            .accessibilityIdentifier("character.startOver.confirm")
        } message: {
            Text("They keep their memory, and this conversation stays on their page.")
        }
    }
}
