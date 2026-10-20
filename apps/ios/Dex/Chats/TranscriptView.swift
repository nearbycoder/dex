import DexCore
import SwiftUI

/// The messages, following the bottom while you're there. Only scrolling up yourself lets go; reaching the bottom
/// again (or sending) takes it back. A round button brings you down when you've scrolled up.
struct TranscriptView: View {
    @Environment(DexClient.self) private var client
    let feed: ChatFeed
    let composer: ComposerModel
    /// Sends a message (a retry, or a UI card's).
    let send: (String) -> Void
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var pinned = true
    @State private var atBottom = true
    @State private var interacting = false
    /// When content was last tapped: growth from a tap (opening an activity row) stays where you tapped.
    @State private var tappedAt = Date.distantPast

    private struct Metrics: Equatable {
        var content: CGFloat
        var container: CGFloat
        var distance: CGFloat
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
                } else if items.isEmpty, feed.pending.isEmpty, !transcript.running {
                    EmptyStateView(title: "New chat", symbol: "sparkles", message: "Ask Dex anything. It can browse, run code on its own VM, and answer with live UI.")
                        .padding(.top, 60)
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    switch item {
                    case .user(_, let text, let images):
                        UserBubble(text: text, images: images, onEdit: { composer.fill(text) })
                    case .assistant(_, let messages, let streaming, let endedAt):
                        ReplyView(feed: feed, messages: messages, streaming: streaming, running: transcript.running && index == items.count - 1,
                                  endedAt: endedAt, results: results, tools: transcript.tools,
                                  onRetry: index == items.count - 1 ? lastUser.flatMap(Self.text).map { text in { send(text) } } : nil)
                    case .divider(_, let label):
                        DividerRow(label: label)
                    }
                }
                ForEach(feed.pending) { pending in
                    UserBubble(text: pending.text, images: 0, pending: true)
                }
                if transcript.running, !(items.last.map(Self.isAssistant) ?? false) {
                    WorkingPlaceholder()
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
            .simultaneousGesture(TapGesture().onEnded { tappedAt = .now })
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollPhaseChange { _, phase in interacting = phase == .interacting || phase == .decelerating || phase == .tracking }
        .onScrollGeometryChange(for: Metrics.self) { geometry in
            Metrics(content: geometry.contentSize.height, container: geometry.containerSize.height,
                    distance: geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY)
        } action: { old, new in
            atBottom = new.distance < 120
            if new.distance < 80 { pinned = true }
            else if interacting, new.distance > old.distance + 1 { pinned = false }
            let grew = new.content != old.content || new.container != old.container
            guard grew, !interacting else { return }
            if Date.now.timeIntervalSince(tappedAt) < 1 {
                pinned = new.distance < 80
            } else if pinned, new.distance > 1 {
                position.scrollTo(edge: .bottom)
            }
        }
        // Sending a message always brings you to the bottom.
        .onChange(of: "\(lastUser?.id ?? ""):\(feed.pending.count)") {
            pinned = true
            withAnimation(.smooth) { position.scrollTo(edge: .bottom) }
        }
        .overlay(alignment: .bottom) {
            if !atBottom {
                Button {
                    pinned = true
                    withAnimation(.smooth) { position.scrollTo(edge: .bottom) }
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
        .accessibilityIdentifier("chat.transcript")
    }

    static func isAssistant(_ item: DisplayItem) -> Bool { if case .assistant = item { true } else { false } }
    static func text(_ item: DisplayItem) -> String? { if case .user(_, let text, _) = item { text } else { nil } }

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
                    Self.styled(split.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if images > 0 {
                        Label("\(images) image\(images == 1 ? "" : "s")", systemImage: "photo").font(.caption).opacity(0.8)
                    }
                    if pending {
                        Label("Sending", systemImage: "clock").font(.caption2).opacity(0.8)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(.white)
                .background(Color.accentColor.gradient, in: .rect(cornerRadius: 20, style: .continuous))
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
    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Working…").font(.subheadline).foregroundStyle(.secondary)
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
