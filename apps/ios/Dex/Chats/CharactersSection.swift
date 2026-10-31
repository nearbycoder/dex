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

/// One character in the chat list: their face, name, and tagline, or "typing…" while they answer; when you last talked.
struct CharacterChatRow: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let character: CharacterProfile
    @State private var confirmRestart = false

    var body: some View {
        let session = client.state?.session(character.sessionId)
        let busy = session?.busy == true
        HStack(spacing: 12) {
            CharacterAvatar(character, size: 36, typing: busy)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(character.name)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    if session?.muted == true {
                        Image(systemName: "bell.slash.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Muted")
                    }
                    Spacer(minLength: 4)
                    // Once you've talked: when they last said something.
                    if let session, !busy, session.updatedAt > session.createdAt + 1_000 {
                        Text(Format.ago(session.updatedAt)).font(.caption).foregroundStyle(.secondary).fixedSize()
                    }
                }
                if busy {
                    Text("typing…").font(.caption).foregroundStyle(Color.dexAccent)
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
        .contextMenu {
            Section(character.name) {
                Button { router.characterSheet = .character(character.id) } label: { Label("About \(character.name)", systemImage: "person.text.rectangle") }
                Button { confirmRestart = true } label: { Label("Start Over", systemImage: "arrow.counterclockwise") }
            }
            if let session {
                Button {
                    client.perform { try await ChatActions.mute(session.id, !session.muted, client: client) }
                } label: {
                    session.muted ? Label("Unmute", systemImage: "bell") : Label("Mute", systemImage: "bell.slash")
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
