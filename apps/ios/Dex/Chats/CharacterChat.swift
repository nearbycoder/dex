import DexCore
import SwiftUI

/// A character's conversation in the header: their face and name, and their tagline, "typing…" while they answer, or
/// when an earlier conversation started. Tap for their page.
struct CharacterHeader: View {
    @Environment(Router.self) private var router
    let character: CharacterProfile
    let session: SessionMeta
    let typing: Bool

    var body: some View {
        let earlier = character.sessionId != session.id
        let line = typing ? "typing…" : earlier ? "Earlier conversation · \(Format.date(session.createdAt))" : character.tagline
        Button {
            router.characterSheet = .character(character.id)
        } label: {
            HStack(spacing: 9) {
                CharacterAvatar(character, size: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(character.name).font(.headline).lineLimit(1)
                    if !line.isEmpty {
                        Text(line)
                            .font(.caption)
                            .foregroundStyle(typing ? Color.dexAccent : .secondary)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.trailing, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(line.isEmpty ? character.name : "\(character.name), \(line)")
        .accessibilityHint("Opens \(character.name)'s page")
        .accessibilityIdentifier("chat.character")
    }
}

/// Start over (iPad and an unfolded foldable): a new conversation with the character, after asking.
struct StartOverButton: View {
    let character: CharacterProfile
    @State private var confirm = false

    var body: some View {
        Button { confirm = true } label: { Label("Start Over", systemImage: "arrow.counterclockwise") }
            .accessibilityHint("A new conversation with \(character.name). They keep their memory.")
            .accessibilityIdentifier("chat.startOver")
            .startOverDialog(character, isPresented: $confirm)
    }
}

/// A character's conversation's ⋯ menu: their page, Start over, the current conversation (from an earlier one), mute,
/// and (on iPhone) the machine. No settle or snooze: their conversation isn't in the inbox.
struct CharacterChatMenu: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let session: SessionMeta
    let character: CharacterProfile
    var includeMute = true
    var compact = false
    @State private var confirmRestart = false

    var body: some View {
        Menu {
            if compact, let vm = client.state?.vm(session.id), client.state?.vmConfigured == true {
                Button { router.openMachine(session.id) } label: {
                    Label { Text("Machine"); Text(vm.setup.status == "running" ? "Setting up" : vm.status.capitalized) } icon: { Image(systemName: "desktopcomputer") }
                }
                .accessibilityIdentifier("chat.menu.machine")
                Divider()
            }
            Button { router.characterSheet = .character(character.id) } label: { Label("About \(character.name)", systemImage: "person.text.rectangle") }
                .accessibilityIdentifier("chat.menu.about")
            if character.sessionId != session.id {
                Button { router.openChat(character.sessionId) } label: { Label("Current Conversation", systemImage: "bubble.left.and.text.bubble.right") }
                    .accessibilityIdentifier("chat.menu.current")
            }
            Button { confirmRestart = true } label: { Label("Start Over…", systemImage: "arrow.counterclockwise") }
                .accessibilityIdentifier("chat.menu.startOver")
            if includeMute {
                Button { client.perform { try await feed.setMuted(!session.muted) } } label: {
                    session.muted ? Label("Unmute Notifications", systemImage: "bell") : Label("Mute Notifications", systemImage: "bell.slash")
                }
                .accessibilityIdentifier("chat.menu.mute")
            }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        .accessibilityIdentifier("chat.menu")
        .startOverDialog(character, isPresented: $confirmRestart)
    }
}

/// A character's greeting, as their first message.
struct GreetingRow: View {
    let character: CharacterProfile

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CharacterAvatar(character, size: 28)
            Text(character.greeting)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(character.name): \(character.greeting)")
        .accessibilityIdentifier("chat.greeting")
    }
}
