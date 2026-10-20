import DexCore
import SwiftUI

/// A tool call in a reply's activity: its icon, name, and arguments in a line; screenshots it took; a running VM
/// command's output as it arrives; and (opened) what it did, readably for known tools.
struct ToolStepView: View {
    @Environment(Router.self) private var router
    let feed: ChatFeed
    let call: ContentBlock.ToolCall
    let result: ToolResultMessage?
    let live: LiveTool?
    @State private var open = false

    var body: some View {
        let pending = result == nil
        let running = pending && live?.status == "running"
        let failed = result?.isError == true
        let output = result.map(ToolDisplay.resultText) ?? live?.output ?? ""
        let onVm = call.name.hasPrefix("vm_")
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .foregroundStyle(.secondary)
                    Image(systemName: ToolDisplay.symbol(call.name))
                        .font(.caption)
                        .foregroundStyle(failed ? .red : .green)
                        .frame(width: 16)
                    Text(call.name).font(.caption.weight(.semibold)).lineLimit(1).fixedSize()
                    Text(ReplyLayout.summarize(call.arguments))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if pending {
                        ProgressView().controlSize(.mini).opacity(running || live == nil ? 1 : 0.5)
                    } else if failed {
                        Text("failed").font(.caption2.weight(.semibold)).foregroundStyle(.red)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .contextMenu {
                Button { UIPasteboard.general.string = call.arguments.prettyText } label: { Label("Copy Arguments", systemImage: "curlybraces") }
                if !output.isEmpty { Button { UIPasteboard.general.string = output } label: { Label("Copy Output", systemImage: "doc.on.doc") } }
                if onVm { Button { router.openMachine(feed.sessionId) } label: { Label("Watch the VM", systemImage: "desktopcomputer") } }
            }
            .accessibilityLabel("\(ReplyLayout.activity(call.name)): \(ReplyLayout.summarize(call.arguments))\(failed ? ", failed" : pending ? ", running" : "")")
            .accessibilityIdentifier("chat.tool.\(call.name)")

            ForEach(Array((result?.images ?? []).enumerated()), id: \.offset) { _, image in
                ScreenshotView(feed: feed, data: image.data, ref: image.ref)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
            }
            // A running VM command streams open, so its output shows as it arrives.
            if onVm, pending, !output.isEmpty, !open {
                TerminalOutput(command: nil, output: String(output.suffix(4000)), failed: false, maxHeight: 180, followEnd: true)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
            }
            if open {
                ToolDetail(feed: feed, call: call, output: output, failed: failed, pending: pending)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                    .transition(.opacity)
            }
        }
        .background(Color(.tertiarySystemBackground).opacity(0.6), in: .rect(cornerRadius: 12, style: .continuous))
    }
}

/// What a tool did, readably: a terminal, search results, a file, a Dex operation, or arguments and output.
private struct ToolDetail: View {
    @Environment(Router.self) private var router
    @Environment(LinkOpener.self) private var links
    let feed: ChatFeed
    let call: ContentBlock.ToolCall
    let output: String
    let failed: Bool
    let pending: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch ToolDisplay(call) {
            case .terminal(let command, let onVm):
                TerminalOutput(command: command, output: output, failed: failed, maxHeight: 360)
                if onVm {
                    Button { router.openMachine(feed.sessionId) } label: { Label("Watch the VM live", systemImage: "desktopcomputer") }
                        .font(.caption)
                        .buttonStyle(.borderless)
                }
            case .search(let query):
                let results = ToolDisplay.searchResults(output)
                Label(query, systemImage: "magnifyingglass").font(.caption.weight(.medium))
                if results.isEmpty {
                    OutputBlock(text: output, failed: failed)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(results) { item in
                            Button {
                                if let url = URL(string: item.url) { links.open(url, router: router) }
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).font(.footnote.weight(.semibold)).foregroundStyle(.tint).multilineTextAlignment(.leading)
                                    Text(URL(string: item.url)?.host() ?? item.url).font(.caption2).foregroundStyle(.green)
                                    if !item.snippet.isEmpty { Text(item.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(3).multilineTextAlignment(.leading) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("tool.search.results")
                }
            case .fetch(let url):
                Label(url, systemImage: "globe").font(.caption.monospaced()).lineLimit(2)
                OutputBlock(text: output, failed: failed)
            case .file(let path, let action, let onVm):
                Label(path + (onVm ? " (VM)" : ""), systemImage: "doc.text").font(.caption.monospaced().weight(.medium)).lineLimit(2)
                switch action {
                case .read:
                    OutputBlock(text: output, failed: failed)
                case .write(let content):
                    OutputBlock(text: content, failed: false)
                    if failed { OutputBlock(text: output, failed: true) }
                case .edit(let old, let new):
                    DiffView(old: old, new: new)
                    if failed { OutputBlock(text: output, failed: true) }
                }
            case .appCall(let operation, let arguments):
                Label(operation, systemImage: "slider.horizontal.3").font(.caption.monospaced().weight(.medium))
                if let object = arguments.object, !object.isEmpty { OutputBlock(text: arguments.prettyText, failed: false, secondary: true) }
                OutputBlock(text: output, failed: failed)
            case .generic:
                if let object = call.arguments.object, !object.isEmpty { OutputBlock(text: call.arguments.prettyText, failed: false, secondary: true) }
                OutputBlock(text: output, failed: failed)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.tool.detail")
    }
}

/// Output in a monospaced block that scrolls in both directions.
private struct OutputBlock: View {
    let text: String
    let failed: Bool
    var secondary = false

    var body: some View {
        if !text.isEmpty {
            ScrollView([.vertical, .horizontal]) {
                Text(String(text.suffix(12_000)))
                    .font(.caption.monospaced())
                    .foregroundStyle(failed ? .red : secondary ? .secondary : .primary)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 280)
            .fixedSize(horizontal: false, vertical: true)
            .background(Color(.systemBackground).opacity(0.7), in: .rect(cornerRadius: 10, style: .continuous))
        }
    }
}

/// A command and its output, the way a terminal shows them.
struct TerminalOutput: View {
    let command: String?
    let output: String
    let failed: Bool
    var maxHeight: CGFloat = 320
    /// Keep the newest output in view (a command still running).
    var followEnd = false

    var body: some View {
        let exit = ToolDisplay.exitCode(output)
        ScrollViewReader { proxy in
            ScrollView([.vertical, .horizontal]) {
                VStack(alignment: .leading, spacing: 4) {
                    if let command, !command.isEmpty {
                        (Text("$ ").foregroundStyle(.green) + Text(command).foregroundStyle(.white))
                            .font(.caption.monospaced().weight(.semibold))
                    }
                    if !output.isEmpty {
                        Text(String(output.suffix(12_000)))
                            .font(.caption.monospaced())
                            .foregroundStyle(failed ? Color(red: 1, green: 0.6, blue: 0.6) : Color(white: 0.85))
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: maxHeight)
            .fixedSize(horizontal: false, vertical: true)
            .onChange(of: output) { if followEnd { proxy.scrollTo("end", anchor: .bottom) } }
            .onAppear { if followEnd { proxy.scrollTo("end", anchor: .bottom) } }
        }
        .background(Color(white: 0.08), in: .rect(cornerRadius: 10, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if let exit, exit != 0 {
                Text("exit \(exit)").font(.caption2.monospaced().weight(.bold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.red.opacity(0.8), in: .capsule)
                    .padding(6)
            }
        }
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tool.terminal")
    }
}

/// An edit: the text it replaced and what it put there.
private struct DiffView: View {
    let old: String
    let new: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            lines(old, sign: "−", color: .red)
            lines(new, sign: "+", color: .green)
        }
        .font(.caption.monospaced())
        .clipShape(.rect(cornerRadius: 10, style: .continuous))
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func lines(_ text: String, sign: String, color: Color) -> some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(text.split(separator: "\n", omittingEmptySubsequences: false).prefix(200).enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 6) {
                        Text(sign).foregroundStyle(color)
                        Text(String(line)).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12))
        }
    }
}

/// A screenshot a tool took: inline, or loaded by its ref when shown (they're left out of transcripts).
struct ScreenshotView: View {
    let feed: ChatFeed
    let data: String
    let ref: String?
    @State private var image: UIImage?
    @State private var failed = false
    @State private var zoomed = false

    var body: some View {
        Group {
            if let image {
                Button { zoomed = true } label: {
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 320)
                        .clipShape(.rect(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("VM screenshot")
                .accessibilityIdentifier("chat.screenshot")
                .fullScreenCover(isPresented: $zoomed) { ImageViewer(image: image, title: "Screenshot") }
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(white: 0.08))
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .overlay {
                        if failed { Text("Screenshot unavailable").font(.caption).foregroundStyle(.secondary) } else { ProgressView() }
                    }
                    .accessibilityIdentifier("chat.screenshot.loading")
            }
        }
        .task(id: ref ?? data.prefix(32).description) {
            if !data.isEmpty, let bytes = Data(base64Encoded: data), let decoded = UIImage(data: bytes) { image = decoded; return }
            guard let ref else { failed = true; return }
            do { image = try await MediaLoader.shared.screenshot(ref: ref, feed: feed); failed = image == nil } catch { failed = true }
        }
    }
}
