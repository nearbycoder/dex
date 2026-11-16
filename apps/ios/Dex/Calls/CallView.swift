import DexCore
import SwiftUI

/// A call in progress, over the whole screen (the web's VoiceCallPanel): their face, which moves with their voice,
/// what they're doing, the sentence they're saying or what you just said, and Mute and End. It feeds the chat's latest
/// reply to the call as it streams; closing it ends the call.
struct CallView: View {
    let call: VoiceCall
    let character: CharacterProfile
    let feed: ChatFeed
    let close: () -> Void

    var body: some View {
        let tint = AgentColors.color(character.color)
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 24) {
                face
                VStack(spacing: 6) {
                    Text(character.name)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(call.status)
                        .font(.subheadline)
                        .foregroundStyle(call.phase == .listening && !call.muted && call.downloading == nil ? Color.green : Color.white.opacity(0.6))
                        .contentTransition(.opacity)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("call.status")
                words
                    .frame(maxWidth: 440, minHeight: 110, alignment: .top)
            }
            .padding(.horizontal, 28)
            Spacer(minLength: 24)
            controls
                .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                Color(white: 0.06)
                RadialGradient(colors: [tint.opacity(0.35), .clear], center: .init(x: 0.5, y: 0.32), startRadius: 10, endRadius: 420)
            }
            .ignoresSafeArea()
        }
        .environment(\.colorScheme, .dark)
        .animation(.smooth(duration: 0.25), value: call.saying)
        .animation(.smooth(duration: 0.25), value: call.heard)
        // The reply after your latest words, as it streams.
        .onChange(of: CallReply.latest(feed.displayItems, running: feed.transcript.running), initial: true) { _, reply in
            call.reply(reply)
        }
        // Leaving (the chat closes, the app's window goes) ends it.
        .onDisappear { call.end() }
        .sensoryFeedback(.impact(weight: .light), trigger: call.phase == .speaking)
    }

    /// Their face, a little bigger the louder they speak.
    private var face: some View {
        TimelineView(.animation(paused: call.phase != .speaking)) { _ in
            let level = call.level
            CharacterAvatar(character, size: 168)
                .scaleEffect(1 + level * 0.12)
                .shadow(color: AgentColors.color(character.color).opacity(0.25 + level * 0.5), radius: 24 + level * 30)
                .animation(.linear(duration: 0.08), value: level)
        }
        .overlay {
            if call.phase == .thinking || call.phase == .starting {
                Circle()
                    .strokeBorder(.white.opacity(0.35), lineWidth: 2)
                    .frame(width: 190, height: 190)
                    .phaseAnimator([0.94, 1.06]) { ring, scale in ring.scaleEffect(scale).opacity(2.1 - scale * 1.5) } animation: { _ in .easeInOut(duration: 0.9) }
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var words: some View {
        VStack(spacing: 12) {
            if !call.saying.isEmpty {
                Text(call.saying)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .accessibilityIdentifier("call.saying")
            } else if !call.heard.isEmpty {
                Text("“\(call.heard)”")
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityIdentifier("call.heard")
            }
            if let error = call.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("call.error")
            }
        }
        .multilineTextAlignment(.center)
        .lineLimit(6)
    }

    private var controls: some View {
        HStack(spacing: 40) {
            if !call.isOver {
                Button {
                    call.setMuted(!call.muted)
                } label: {
                    Image(systemName: call.muted ? "mic.slash.fill" : "mic.fill")
                        .font(.title2)
                        .frame(width: 68, height: 68)
                        .foregroundStyle(call.muted ? .black : .white)
                        .background(call.muted ? Color.white : Color.white.opacity(0.16), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(call.muted ? "Unmute" : "Mute")
                .accessibilityAddTraits(call.muted ? .isSelected : [])
                .accessibilityIdentifier("call.mute")
                .sensoryFeedback(.selection, trigger: call.muted)
            }
            Button {
                call.end()
                close()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.title2)
                    .frame(width: 68, height: 68)
                    .foregroundStyle(.white)
                    .background(Color.red, in: .circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(call.isOver ? "Close" : "End Call")
            .accessibilityIdentifier("call.end")
        }
    }
}

/// Call: a sidekick's chat (their current conversation) has it in its header.
struct CallButton: View {
    @Environment(DexClient.self) private var client
    let character: CharacterProfile
    let start: () -> Void

    var body: some View {
        Button(action: start) {
            Label("Call", systemImage: "phone")
        }
        .disabled(!client.isConnected)
        .accessibilityLabel("Call \(character.name)")
        .accessibilityHint("A voice call: talk, and they talk back")
        .accessibilityIdentifier("chat.call")
    }
}
