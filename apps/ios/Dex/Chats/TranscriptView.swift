import DexCore
import SwiftUI

/// The messages, following the bottom while you're there. Only scrolling up yourself lets go; reaching the bottom
/// again (or sending) takes it back. A round button brings you down when you've scrolled up. A character's
/// conversation opens with their greeting, and their face sits beside each reply.
struct TranscriptView: View {
    @Environment(DexClient.self) private var client
    let feed: ChatFeed
    let composer: ComposerModel
    /// Who answers, when it isn't Dex.
    var speaker: CharacterProfile? = nil
    /// Sends a message (a retry, or a UI card's).
    let send: (String) -> Void
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var pinned = true
    @State private var atBottom = true
    @State private var interacting = false
    /// Just tapped: growth from a tap (opening an activity row) stays where you tapped.
    @State private var tapped = false
    /// The latest scroll geometry, for finishing a jump to the bottom.
    @State private var metrics = Metrics(content: 0, container: 0, distance: 0, bottom: 0)

    private struct Metrics: Equatable {
        var content: CGFloat
        var container: CGFloat
        /// How far the content is above the bottom.
        var distance: CGFloat
        /// The position (`scrollTo(y:)`) that shows the bottom.
        var bottom: CGFloat
    }

    var body: some View {
        let transcript = feed.transcript
        let items = transcript.displayItems
        let results = transcript.toolResults
        let lastUser = items.last { if case .user = $0 { true } else { false } }
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 20) {
                if !transcript.loaded {
                    TranscriptSkeleton()
                } else if let speaker, !speaker.greeting.isEmpty {
                    GreetingRow(character: speaker)
                } else if items.isEmpty, feed.pending.isEmpty, !transcript.running {
                    if let speaker {
                        EmptyStateView(title: "Say hi to \(speaker.name)", symbol: "hand.wave", message: speaker.tagline.isEmpty ? nil : speaker.tagline)
                            .padding(.top, 60)
                    } else {
                        EmptyStateView(title: "New chat", symbol: "sparkles", message: "Ask Dex anything. It can browse, run code on its own VM, and answer with live UI.")
                            .padding(.top, 60)
                    }
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    switch item {
                    case .user(_, let text, let images, let files, let imageParts):
                        // A prompt Dex ran on a schedule (a sidekick's check-in, a reminder) isn't something you said.
                        if let prompt = UserText.scheduledPrompt(text) {
                            ScheduledNote(prompt: prompt)
                        } else {
                            UserBubble(text: text, images: images, feed: feed, files: files, imageParts: imageParts, onEdit: { composer.fill(text) })
                        }
                    case .assistant(_, let messages, let streaming, let endedAt):
                        let reply = ReplyView(feed: feed, messages: messages, streaming: streaming, running: transcript.running && index == items.count - 1,
                                              endedAt: endedAt, results: results, tools: transcript.tools,
                                              onRetry: index == items.count - 1 ? lastUser.flatMap(Self.text).map { text in { send(text) } } : nil)
                        if let speaker {
                            HStack(alignment: .top, spacing: 10) {
                                CharacterAvatar(speaker, size: 28)
                                reply
                            }
                        } else {
                            reply
                        }
                    case .divider(_, let label):
                        DividerRow(label: label)
                    }
                }
                ForEach(feed.pending) { pending in
                    UserBubble(text: pending.text, images: 0, pending: true)
                }
                if transcript.running, !(items.last.map(Self.isAssistant) ?? false) {
                    if let speaker {
                        HStack(spacing: 10) {
                            CharacterAvatar(speaker, size: 28)
                            WorkingPlaceholder(text: "\(speaker.name) is typing…")
                        }
                    } else {
                        WorkingPlaceholder()
                    }
                }
                if let retry = transcript.retry {
                    Label("Retrying after an error: \(retry.error)", systemImage: "arrow.clockwise")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .symbolEffect(.rotate, options: .repeating)
                        .accessibilityIdentifier("chat.retrying")
                }
                if let error = transcript.error {
                    ErrorCard(message: error, onRetry: transcript.running ? nil : lastUser.flatMap(Self.text).map { text in { send(text) } })
                }
                // Confirmations this chat asked for that no reply shows (an older agent, or a reply still loading).
                ForEach(orphanConfirmations(results: results)) { action in
                    ConfirmCard(id: action.id, summary: action.summary)
                }
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .simultaneousGesture(TapGesture().onEnded { tapped = true })
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        // While following, the bottom stays put as content grows (streaming, new messages, media sizing itself) and as
        // the keyboard comes and goes; otherwise what you're reading does.
        .defaultScrollAnchor(pinned && !tapped ? .bottom : .top, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("chat.transcript")
        .onScrollPhaseChange { _, phase in
            interacting = phase == .interacting || phase == .decelerating || phase == .tracking
            // Your finger on the transcript lets go of the bottom: nothing follows it while you scroll.
            if phase == .tracking || phase == .interacting { pinned = false }
            // Coming to rest at the bottom follows it again.
            if phase == .idle, metrics.distance < 80 { pinned = true }
        }
        .onScrollGeometryChange(for: Metrics.self) { geometry in
            // What's left below the part you can read. The container is that readable height (between the bars and
            // the composer or keyboard); the offset starts at minus the top inset.
            let top = geometry.contentInsets.top
            let readableEnd = geometry.contentOffset.y + top + geometry.containerSize.height
            // `scrollTo(y:)` puts that point at the top of the readable area (offset = y − top inset).
            let bottom = geometry.contentSize.height - geometry.containerSize.height
            return Metrics(content: geometry.contentSize.height, container: geometry.containerSize.height,
                           distance: max(0, geometry.contentSize.height - readableEnd), bottom: bottom)
        } action: { old, new in
            metrics = new
            atBottom = new.distance < 120
            // Content or the readable area changed size (streaming, media sizing itself, the keyboard), or only the
            // offset moved (you, or the system settling it).
            let resized = new.content != old.content || new.container != old.container
            // Reaching the bottom again takes it back.
            if new.distance < 80, !interacting { pinned = true }
            // Moving away from the bottom by itself is your drag starting: the scroll phase reports it only after the
            // first few points, and following until then pulled the transcript back under your finger (it flickered
            // before it scrolled).
            if !resized, new.distance > old.distance + 1 { pinned = false }
            // The anchor above doesn't hold when the transcript starts shorter than the screen (its padding comes and
            // goes as the top inset): follow explicitly, but only when something changed size, never against a scroll.
            // A point position changes with the geometry, so it always scrolls (an unchanged edge position wouldn't).
            if pinned, resized, !tapped, !interacting, new.distance > 1, new.bottom > 0 {
                position.scrollTo(y: new.bottom)
            }
        }
        .task(id: tapped) {
            guard tapped else { return }
            try? await Task.sleep(for: .seconds(1))
            tapped = false
        }
        // Sending a message always brings you to the bottom.
        .onChange(of: "\(lastUser?.id ?? ""):\(feed.pending.count)") { toBottom() }
        .overlay(alignment: .bottom) {
            if !atBottom {
                Button {
                    toBottom()
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.body.weight(.semibold))
                        .frame(width: 40, height: 40)
                        .overlay(alignment: .topTrailing) {
                            if transcript.running {
                                Circle().fill(.green).frame(width: 9, height: 9)
                                    .phaseAnimator([1.0, 0.4]) { view, phase in view.opacity(phase) }
                                    .offset(x: 2, y: -2)
                            }
                        }
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .padding(.bottom, 10)
                .transition(.scale.combined(with: .opacity))
                .accessibilityLabel("Scroll to the latest message")
                .accessibilityIdentifier("chat.scrollToBottom")
            }
        }
        .animation(.smooth, value: atBottom)
    }

    private func toBottom() {
        // Once you've scrolled, the position is yours and this takes it back; while following, the size-change
        // anchor already keeps the bottom in view.
        pinned = true
        withAnimation(.smooth) {
            position.scrollTo(edge: .bottom)
        } completion: {
            // The animation aims at the bottom as it was when it began; a reply may have grown since.
            if pinned, metrics.distance > 1, metrics.bottom > 0 { position.scrollTo(y: metrics.bottom) }
        }
    }

    static func isAssistant(_ item: DisplayItem) -> Bool { if case .assistant = item { true } else { false } }
    static func text(_ item: DisplayItem) -> String? { if case .user(_, let text, _, _, _) = item { text } else { nil } }

    private func orphanConfirmations(results: [String: ToolResultMessage]) -> [PendingAction] {
        let shown = Set(results.values.compactMap { $0.details?["confirmation"]?["id"]?.string })
        return (client.state?.access.pending ?? []).filter { $0.sessionId == feed.sessionId && $0.status == "pending" && !shown.contains($0.id) }
    }
}

/// A message you sent: a leading `/skill` set off, the note about what you did in the chat's UI, and "Sending" until
/// the agent records it. Long-press to copy it or put it back in the message box.
struct UserBubble: View {
    let text: String
    let images: Int
    var feed: ChatFeed? = nil
    var files: [AttachedFile] = []
    var imageParts: [ImagePart] = []
    var pending = false
    var onEdit: (() -> Void)? = nil

    var body: some View {
        let split = UserText.splitUiNotes(text)
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 6) {
                if !split.notes.isEmpty {
                    Label("In the UI: \(split.notes.joined(separator: "; "))", systemImage: "cursorarrow.click")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
                VStack(alignment: .trailing, spacing: 4) {
                    if !files.isEmpty || !imageParts.isEmpty {
                        UserAttachmentsView(feed: feed, images: imageParts, files: files)
                    }
                    if !split.text.isEmpty {
                        Self.styled(split.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    // Without a chat to load them from, images are only counted.
                    if images > 0, feed == nil {
                        Label("\(images) image\(images == 1 ? "" : "s")", systemImage: "photo").font(.caption).opacity(0.8)
                    }
                    if pending {
                        Label("Sending", systemImage: "clock").font(.caption2).opacity(0.8)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(.white)
                .background(Color.selectionAccent.gradient, in: .rect(cornerRadius: 20, style: .continuous))
                .opacity(pending ? 0.65 : 1)
                .contextMenu {
                    Button { UIPasteboard.general.string = split.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                    if let onEdit {
                        Button(action: onEdit) { Label("Edit as New Message", systemImage: "pencil") }
                    }
                    ShareLink(item: split.text)
                }
            }
            .frame(maxWidth: 560, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(pending ? "You, sending: \(split.text)" : "You: \(split.text)")
        .accessibilityIdentifier(pending ? "chat.pending" : "chat.user")
    }

    /// The text, with a leading `/skill` in monospace.
    static func styled(_ text: String) -> Text {
        guard let skill = Format.invokedSkill(text), let range = text.range(of: "/\(skill)") else { return Text(text) }
        return Text(text[..<range.lowerBound]) + Text("/\(skill)").font(.body.monospaced().weight(.semibold)) + Text(text[range.upperBound...])
    }
}

/// A scheduled prompt that ran in this chat: a small centered note ("⏰ Scheduled: …") where a message of yours would be.
struct ScheduledNote: View {
    let prompt: String

    var body: some View {
        Label {
            Text("Scheduled: \(prompt)")
        } icon: {
            Image(systemName: "alarm")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .lineLimit(3)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Scheduled: \(prompt)")
        .accessibilityIdentifier("chat.scheduled")
        .contextMenu {
            Button { UIPasteboard.general.string = prompt } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
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
        .accessibilityElement(children: .combine)
    }
}

/// The chat is running but nothing has come back yet.
struct WorkingPlaceholder: View {
    var text = "Working…"

    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).font(.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat.thinking")
    }
}

/// A chat's transcript while it loads: bones in the shape of messages and replies.
struct TranscriptSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack { Spacer(); RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.quaternary).frame(width: 210, height: 44) }
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.quaternary.opacity(0.6)).frame(height: 40)
            VStack(alignment: .leading, spacing: 6) {
                LineBone(width: 300)
                LineBone()
                LineBone(width: 220)
            }
            HStack { Spacer(); RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.quaternary).frame(width: 150, height: 44) }
            VStack(alignment: .leading, spacing: 6) {
                LineBone()
                LineBone(width: 180)
            }
        }
        .padding(.top, 12)
        .accessibilityElement()
        .accessibilityLabel("Loading the chat")
        .accessibilityIdentifier("chat.skeleton")
    }
}
