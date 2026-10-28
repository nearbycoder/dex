import DexCore
import SwiftUI

/// Everything run on a VM as it happens (the agent's commands, yours, and the VM's own lifecycle), with streamed
/// output, and a field to run your own command.
struct ActivityLogView: View {
    @Environment(DexClient.self) private var client
    let feed: MachineFeed
    let vm: VmInfo
    var command: FocusState<Bool>.Binding
    @State private var text = ""
    @State private var running = 0
    @State private var fullOutput: VmActivity?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if !feed.loaded {
                            ActivitySkeleton()
                        } else if feed.items.isEmpty {
                            Text("No activity yet. Commands Dex runs on this VM appear here as they happen.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .padding()
                                .accessibilityIdentifier("activity.empty")
                        }
                        ForEach(feed.items) { item in
                            VmActivityRow(item: item, startsOpen: item.id == feed.items.last?.id) { fullOutput = item }
                                .id(item.id)
                            Divider().padding(.horizontal, 16)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                }
                // Opens at the latest entry and follows new ones, but a short log starts at the top, under the picker.
                .defaultScrollAnchor(.top, for: .alignment)
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
                .onChange(of: feed.items.count) {
                    withAnimation(.smooth) { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onChange(of: feed.items.last?.output.count) {
                    proxy.scrollTo("end", anchor: .bottom)
                }
            }
            Divider()
            commandField
        }
        .sheet(item: $fullOutput) { item in OutputSheet(item: item) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("machine.activity")
    }

    private var commandField: some View {
        HStack(spacing: 8) {
            Text("$").font(.callout.monospaced().weight(.semibold)).foregroundStyle(.tint)
            TextField(vm.isRunning ? "Run a command" : "Run a command (starts the VM)", text: $text)
                .font(.callout.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused(command)
                .onSubmit(run)
                .disabled(!client.isConnected)
                .accessibilityIdentifier("machine.command")
            if running > 0 {
                ProgressView().controlSize(.small).accessibilityIdentifier("machine.command.running")
            }
            Button(action: run) {
                Image(systemName: "return")
            }
            .buttonStyle(.borderless)
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel("Run")
            .accessibilityIdentifier("machine.command.run")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func run() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        text = ""
        running += 1
        let key = vm.key
        Task {
            defer { running -= 1 }
            do { _ = try await client.vmRun(key, command: value) } catch { client.notice = error.localizedDescription }
        }
    }
}

/// One entry: who ran it, what, and how it went; opens to its output.
struct VmActivityRow: View {
    let item: VmActivity
    let startsOpen: Bool
    let showAll: () -> Void
    @State private var open: Bool?

    /// The most of the output shown inline (the rest is a tap away).
    static let inlineLimit = 4_000

    private var isOpen: Bool { open ?? (startsOpen || item.status == "running") }

    /// The output without its trailing line breaks.
    private var shownOutput: String {
        var output = item.output
        while output.last?.isNewline == true { output.removeLast() }
        return output
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy) { open = !isOpen }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                        .opacity(item.hasOutput ? 1 : 0)
                    ActorBadge(actor: item.actor)
                    Text(item.title)
                        .font(item.isCode ? .caption.monospaced() : .caption)
                        .foregroundStyle(item.isCode ? .primary : .secondary)
                        .lineLimit(isOpen ? 4 : 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    trailing
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!item.hasOutput)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("activity.row")

            if isOpen, item.hasOutput {
                let shown = shownOutput
                let clipped = shown.count > Self.inlineLimit
                VStack(alignment: .leading, spacing: 6) {
                    Text(clipped ? "…" + String(shown.suffix(Self.inlineLimit)) : shown)
                        .font(.caption2.monospaced())
                        .foregroundStyle(item.status == "error" ? Color.red : Color.primary.opacity(0.85))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("activity.output")
                    if clipped {
                        Button("Show All Output", action: showAll).font(.caption)
                    }
                }
                .padding(10)
                .background(.background.secondary, in: .rect(cornerRadius: 10))
                .padding(.leading, 18)
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        // A running entry opens and stays open (the web's ActivityItem).
        .onChange(of: item.status, initial: true) { _, status in
            if status == "running" { open = true }
        }
        .contextMenu {
            Button { UIPasteboard.general.string = item.title } label: { Label(item.isCode ? "Copy Command" : "Copy", systemImage: "doc.on.doc") }
            if item.hasOutput {
                Button { UIPasteboard.general.string = item.output } label: { Label("Copy Output", systemImage: "text.alignleft") }
                Button(action: showAll) { Label("Show All Output", systemImage: "arrow.up.left.and.arrow.down.right") }
            }
        }
    }

    @ViewBuilder
    private var trailing: some View {
        if item.status == "running" {
            ProgressView().controlSize(.mini)
        } else if let failure = item.failureText {
            Text(failure).font(.caption2.weight(.medium)).foregroundStyle(.red)
        } else {
            Text(Format.ago(item.at)).font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

/// Dex (the agent), You, or VM (setup and lifecycle).
struct ActorBadge: View {
    let actor: String

    var body: some View {
        let (label, symbol, color): (String, String?, Color) = switch actor {
        case "agent": ("Dex", "sparkles", .dexAccent)
        case "user": ("You", "person.fill", .blue)
        default: ("VM", nil, .secondary)
        }
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(label)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(color.opacity(0.14), in: .rect(cornerRadius: 5))
        .fixedSize()
    }
}

/// An entry's whole output (up to the 64 KB the log keeps).
struct OutputSheet: View {
    @Environment(\.dismiss) private var dismiss
    let item: VmActivity

    var body: some View {
        NavigationStack {
            ScrollView([.vertical, .horizontal]) {
                Text(item.output)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(item.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: item.output) { Label("Share", systemImage: "square.and.arrow.up") }
                }
            }
        }
    }
}

struct ActivitySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(0..<5, id: \.self) { index in
                HStack(spacing: 8) {
                    Capsule().fill(.quaternary).frame(width: 34, height: 14)
                    LineBone(width: [220, 160, 260, 120, 200][index], font: .caption)
                }
            }
        }
        .padding()
        .accessibilityIdentifier("activity.loading")
    }
}
