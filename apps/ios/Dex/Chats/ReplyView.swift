import DexCore
import SwiftUI

/// One reply: its work folded into an activity row, then what it shows you (answer text and UI cards).
struct ReplyView: View {
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let messages: [AssistantMessage]
    let streaming: Bool
    let endedAt: Double?
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]

    var body: some View {
        let layout = ReplyLayout(messages: messages, streaming: streaming)
        VStack(alignment: .leading, spacing: 10) {
            if !layout.steps.isEmpty {
                ActivityRow(layout: layout, streaming: streaming, startedAt: messages.first?.timestamp ?? .nowMs, endedAt: endedAt, results: results, tools: tools)
            }
            if layout.touchedMemory {
                Label("Updated memory (MEMORY.md)", systemImage: "brain")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(layout.shown) { step in
                switch step.block {
                case .text(let text) where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
                    MarkdownView(text: text) { url in open(url) }
                case .toolCall(let call) where ReplyLayout.isUI(step.block):
                    OpenUICardView(feed: feed, call: call, streaming: step.live)
                default:
                    EmptyView()
                }
            }
            ForEach(layout.errors, id: \.self) { error in
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("chat.reply")
    }

    private func open(_ url: URL) {
        if router.handle(url) { return }
        UIApplication.shared.open(url)
    }
}

/// Everything the model did on the way to its answer, as one row: what's happening now (or how long it took), counts,
/// and a tap to see every thought, note, and tool call in order.
struct ActivityRow: View {
    let layout: ReplyLayout
    let streaming: Bool
    let startedAt: Double
    let endedAt: Double?
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]
    @State private var open = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: layout.active ? 1 : 3600)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            let status = layout.status(results: results, startedAt: startedAt, endedAt: endedAt, now: now)
            let failed = layout.failedCount(results: results)
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
                        Text(status.title + (layout.active ? "…" : ""))
                            .font(.footnote.weight(.medium))
                            .contentTransition(.opacity)
                        if !status.detail.isEmpty {
                            Text(status.detail)
                                .font(status.monospaced ? .caption.monospaced() : .caption.italic())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Text(layout.counts(results: results, startedAt: startedAt, now: now))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat.activity")
                if open {
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(layout.steps) { step in
                            ActivityStep(step: step, results: results, tools: tools)
                        }
                    }
                    .padding(12)
                    .transition(.opacity)
                }
            }
            .background(Color(.secondarySystemBackground).opacity(0.7), in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.quaternary))
        }
    }
}

/// One step in the opened activity row.
struct ActivityStep: View {
    let step: ReplyLayout.Step
    let results: [String: ToolResultMessage]
    let tools: [String: LiveTool]
    @State private var open = false

    var body: some View {
        switch step.block {
        case .thinking(let text, _):
            DisclosureGroup(isExpanded: $open) {
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            } label: {
                Label(step.live ? "Thinking…" : "Thought", systemImage: "brain").font(.caption)
            }
        case .text(let text) where !text.trimmingCharacters(in: .whitespaces).isEmpty:
            MarkdownView(text: text, font: .footnote).foregroundStyle(.secondary)
        case .toolCall(let call):
            ToolStepView(call: call, result: results[call.id], live: tools[call.id])
        default:
            EmptyView()
        }
    }
}

/// A tool call: what it ran, and (opened) its arguments and output.
struct ToolStepView: View {
    let call: ContentBlock.ToolCall
    let result: ToolResultMessage?
    let live: LiveTool?
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 8) {
                if let args = call.arguments.object, !args.isEmpty {
                    CodeBlockView(code: call.arguments.prettyText, language: "arguments")
                }
                let output = result?.text ?? live?.output ?? ""
                if !output.isEmpty {
                    CodeBlockView(code: output, language: result?.isError == true ? "error" : "output")
                }
            }
        } label: {
            HStack(spacing: 6) {
                if result == nil, live?.status != "done" {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: result?.isError == true ? "xmark.octagon.fill" : "checkmark.circle.fill")
                        .foregroundStyle(result?.isError == true ? .red : .green)
                }
                Text(ReplyLayout.activity(call.name)).font(.caption.weight(.medium))
                Text(ReplyLayout.summarize(call.arguments)).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .accessibilityIdentifier("chat.tool.\(call.name)")
    }
}
