import DexCore
import SwiftUI

/// One reply: its work folded into an activity row, then what it shows you (media it shared, confirmations it asked
/// for, the answer, and UI cards), its errors, and (once done) copy and share.
struct ReplyView: View {
    @Environment(Router.self) private var router
    @Environment(LinkOpener.self) private var links
    let feed: ChatFeed
    let messages: [AssistantMessage]
    let streaming: Bool
    /// The chat's run is still on this reply.
    let running: Bool
    let endedAt: Double?
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]
    /// Sends the last message again (shown under a reply that failed).
    var onRetry: (() -> Void)? = nil

    var body: some View {
        let layout = ReplyLayout(messages: messages, streaming: streaming, running: running)
        let answer = layout.shown.compactMap { if case .text(let text) = $0.block { text } else { nil } }.joined(separator: "\n\n")
        VStack(alignment: .leading, spacing: 10) {
            if !layout.steps.isEmpty {
                ActivityRow(feed: feed, layout: layout, running: running, startedAt: messages.first?.timestamp ?? .nowMs, endedAt: endedAt, results: results, tools: tools)
            }
            if layout.touchedMemory {
                Button {
                    router.openFile("/MEMORY.md")
                } label: {
                    Label("Memory updated", systemImage: "brain")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                }
                .buttonStyle(.glass)
                .tint(.cyan)
                .accessibilityHint("Memory is added to every chat. Opens it to review what changed.")
                .accessibilityIdentifier("chat.memory")
            }
            ForEach(layout.sharedMedia(results: results), id: \.url) { media in
                if let source = ChatMedia.source(media.url) { ChatMediaView(source: source, title: media.name) }
            }
            ForEach(layout.confirmations(results: results), id: \.id) { confirmation in
                ConfirmCard(id: confirmation.id, summary: confirmation.summary)
            }
            ForEach(layout.shown) { step in
                switch step.block {
                case .text(let text) where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
                    MarkdownView(text: text) { url in links.open(url, router: router) }
                case .thinking(let text, _):
                    ThinkingStep(text: text, live: step.live)
                case .toolCall(let call) where ReplyLayout.isUI(step.block):
                    OpenUICardView(feed: feed, call: call, streaming: step.live)
                default:
                    EmptyView()
                }
            }
            ForEach(Array(layout.errors.enumerated()), id: \.offset) { index, error in
                ErrorCard(message: error, onRetry: index == layout.errors.count - 1 && !running ? onRetry : nil)
            }
            if messages.last?.stopReason == "aborted" {
                Text("Stopped.").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("chat.stopped")
            }
            if !streaming, !running, !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ReplyActions(text: answer)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.reply")
    }
}

/// Copy and share under a finished reply.
private struct ReplyActions: View {
    let text: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 2) {
            Button {
                UIPasteboard.general.string = text
                copied = true
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 32, height: 28)
            }
            .accessibilityLabel(copied ? "Copied" : "Copy reply")
            .accessibilityIdentifier("chat.reply.copy")
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
            .task(id: copied) {
                guard copied else { return }
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
            ShareLink(item: text) {
                Image(systemName: "square.and.arrow.up").frame(width: 32, height: 28)
            }
            .accessibilityLabel("Share reply")
        }
        .buttonStyle(.borderless)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.leading, -8)
    }
}

/// A failed model request (or run), with Retry when it's the latest.
struct ErrorCard: View {
    let message: String
    var onRetry: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            Text(message).font(.footnote).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            if let onRetry {
                Button("Retry", action: onRetry)
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.glass)
                    .controlSize(.small)
                    .accessibilityIdentifier("chat.retry")
            }
        }
        .padding(12)
        .background(.red.opacity(0.1), in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.red.opacity(0.25)))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat.error")
    }
}

/// Everything the model did on the way to its answer, as one row: what's happening now (the running tool and its
/// arguments, or the latest line of its thinking), or how long it worked; counts; and a tap to see every thought,
/// note, and tool call in order.
struct ActivityRow: View {
    let feed: ChatFeed
    let layout: ReplyLayout
    let running: Bool
    let startedAt: Double
    let endedAt: Double?
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]
    @State private var open = false

    var body: some View {
        // Only a reply that's still going has a clock to tick.
        TimelineView(.periodic(from: .now, by: running || endedAt == nil ? 1 : 3600)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            let status = layout.status(results: results, startedAt: startedAt, endedAt: endedAt, now: now)
            let failed = layout.failedCount(results: results)
            let counts = layout.counts(results: results, startedAt: startedAt, now: now)
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.snappy) { open.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.bold))
                            .rotationEffect(.degrees(open ? 90 : 0))
                            .foregroundStyle(.secondary)
                        Group {
                            if layout.active {
                                ProgressView().controlSize(.mini)
                            } else if failed > 0 {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            } else {
                                Image(systemName: "checklist").foregroundStyle(.tint)
                            }
                        }
                        .font(.caption)
                        .frame(width: 16)
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                title(status)
                                detail(status)
                                Spacer(minLength: 4)
                                Text(counts).font(.caption.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
                            }
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                title(status)
                                detail(status)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("\(status.title). \(status.detail). \(counts)")
                .accessibilityHint(open ? "Hides the steps" : "Shows every step")
                .accessibilityIdentifier("chat.activity")
                if open {
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(layout.steps) { step in
                            ActivityStep(feed: feed, step: step, results: results, tools: tools)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .transition(.opacity)
                }
            }
            .background(Color(.secondarySystemBackground).opacity(0.75), in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.quaternary))
        }
    }

    private func title(_ status: (title: String, detail: String, monospaced: Bool)) -> some View {
        Text(status.title + (layout.active ? "…" : ""))
            .font(.footnote.weight(.semibold))
            .lineLimit(1)
            .fixedSize()
            .id(status.title)
            .transition(.push(from: .bottom).combined(with: .opacity))
            .animation(.smooth, value: status.title)
    }

    @ViewBuilder
    private func detail(_ status: (title: String, detail: String, monospaced: Bool)) -> some View {
        if !status.detail.isEmpty {
            Text(status.detail)
                .font(status.monospaced ? .caption.monospaced() : .caption.italic())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

/// One step in the opened activity row.
struct ActivityStep: View {
    let feed: ChatFeed
    let step: ReplyLayout.Step
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]

    var body: some View {
        switch step.block {
        case .thinking(let text, _):
            ThinkingStep(text: text, live: step.live)
        case .text(let text) where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
            MarkdownView(text: text, font: .footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
        case .toolCall(let call):
            ToolStepView(feed: feed, call: call, result: results[call.id], live: tools[call.id])
        default:
            EmptyView()
        }
    }
}

/// A thought: "Thought" (or "Thinking…" while it streams), opened to read it.
struct ThinkingStep: View {
    let text: String
    let live: Bool
    @State private var open = false

    var body: some View {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    withAnimation(.snappy) { open.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold)).rotationEffect(.degrees(open ? 90 : 0))
                        Image(systemName: "brain").font(.caption)
                        Text(live ? "Thinking…" : "Thought").font(.caption.weight(.medium))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 6)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat.thought")
                if open {
                    Text(text)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) { Rectangle().fill(.quaternary).frame(width: 2) }
                        .padding(.leading, 8)
                }
            }
        }
    }
}

/// An admin operation the chat asked for (deleting things, changing settings, agents, projects, or MCP servers).
/// Nothing happens until you confirm here; your answer goes back to the chat as a message.
struct ConfirmCard: View {
    @Environment(DexClient.self) private var client
    let id: String
    let summary: String
    @State private var busy: Bool?
    @State private var error: String?

    var body: some View {
        let pending = client.state?.access.pending.first { $0.id == id }
        let status = pending?.status ?? "expired"
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 6) {
                Text("Dex wants to").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(.orange)
                Text(summary.isEmpty ? (pending?.summary ?? "") : summary).font(.body)
                if status == "pending" {
                    HStack(spacing: 10) {
                        Button { answer(true) } label: {
                            Label("Confirm", systemImage: "checkmark").opacity(busy == true ? 0 : 1)
                                .overlay { if busy == true { ProgressView() } }
                        }
                        .buttonStyle(.glassProminent)
                        .tint(.orange)
                        .accessibilityIdentifier("confirm.approve")
                        Button { answer(false) } label: {
                            Label("Decline", systemImage: "xmark").opacity(busy == false ? 0 : 1)
                                .overlay { if busy == false { ProgressView() } }
                        }
                        .buttonStyle(.glass)
                        .tint(.primary)
                        .accessibilityIdentifier("confirm.decline")
                    }
                    .disabled(busy != nil)
                    .padding(.top, 4)
                } else {
                    Text(Self.statusText(status) + (status == "failed" ? pending?.result.map { ": \($0)" } ?? "" : ""))
                        .font(.footnote)
                        .foregroundStyle(status == "approved" ? .green : status == "failed" ? .red : .secondary)
                        .accessibilityIdentifier("confirm.status")
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.orange.opacity(0.1), in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.orange.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("confirm.card")
        .sensoryFeedback(.success, trigger: status) { _, new in new == "approved" }
    }

    static func statusText(_ status: String) -> String {
        switch status {
        case "approved": "Confirmed"
        case "declined": "Declined"
        case "failed": "Confirmed, but it failed"
        default: "Expired: ask again if you still want it"
        }
    }

    private func answer(_ approve: Bool) {
        busy = approve
        error = nil
        Task {
            defer { busy = nil }
            do { try await client.run("resolvePendingAction", .string(id), .bool(approve)) } catch { self.error = error.localizedDescription }
        }
    }
}
