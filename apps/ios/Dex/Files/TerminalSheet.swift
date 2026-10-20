import DexCore
import SwiftUI

/// The workspace shell: run a command (bash, jq, curl, rg…) over the agent's files and see what it printed. It's
/// simulated in the agent, not a real machine: real programs run on a chat's VM.
struct TerminalSheet: View {
    @Environment(DexClient.self) private var client
    @Environment(FilesModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var command = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if model.terminal.isEmpty {
                            Text("Runs in /workspace with a simulated bash (jq, curl, rg, and the usual tools). Files it changes are saved. Real programs run on a chat's VM.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(model.terminal) { line in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("$ \(line.command)").foregroundStyle(.green)
                                if !line.output.isEmpty {
                                    Text(line.output.hasSuffix("\n") ? String(line.output.dropLast()) : line.output)
                                        .foregroundStyle(line.exitCode == 0 ? Color.primary : Color.red)
                                }
                                if line.exitCode != 0 {
                                    Text("exit \(line.exitCode)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                                }
                            }
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .id(line.id)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("terminal.line")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: model.terminal.count) {
                    if let last = model.terminal.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 10) {
                    Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(.green)
                    TextField(model.running ? "Running…" : "Run a command", text: $command)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .disabled(model.running || !client.isConnected)
                        .onSubmit { run() }
                        .accessibilityIdentifier("terminal.input")
                    if model.running { ProgressView().controlSize(.small) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .glassEffect(.regular.interactive(), in: .capsule)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .navigationTitle("Workspace Shell")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear", systemImage: "trash") { model.terminal = [] }
                        .disabled(model.terminal.isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }

    private func run() {
        let value = command
        command = ""
        Task {
            await model.run(value, client: client)
            focused = true
        }
    }
}
