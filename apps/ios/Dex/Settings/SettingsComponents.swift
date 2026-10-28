import DexCore
import SwiftUI

/// A short result under a form: green for done, red for a problem, orange for a warning.
struct InlineMessage: View {
    enum Tone { case ok, error, warning }
    let tone: Tone
    let text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.footnote)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(tone == .error ? "message.error" : "message.ok")
    }

    private var symbol: String {
        switch tone {
        case .ok: "checkmark.circle.fill"
        case .error: "exclamationmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        }
    }

    private var color: Color {
        switch tone {
        case .ok: .green
        case .error: .red
        case .warning: .orange
        }
    }
}

/// A value you can copy (an endpoint, a token, a command), in a monospaced line with a Copy button.
struct CopyRow: View {
    let label: String
    let value: String
    var secret = false
    var lines = 1
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 10) {
                Text(value)
                    .font(.callout.monospaced())
                    .foregroundStyle(secret ? Color.orange : Color.primary)
                    .lineLimit(lines)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = value
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .labelStyle(.iconOnly)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
                .sensoryFeedback(.success, trigger: copied) { _, new in new }
            }
        }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// A link out of the app (where to get a key, docs), with the arrow Settings uses.
struct ExternalLink: View {
    let title: String
    let url: String

    var body: some View {
        if let link = URL(string: url) {
            Link(destination: link) {
                HStack {
                    Text(title)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// A credential pasted once and verified (the web's SecretConnect): connected, the key hint with Replace and
/// Disconnect; not connected (or replacing), the field and Connect, with the result underneath.
struct KeyConnectSection<Help: View>: View {
    let id: String
    let title: String
    let connected: Bool
    /// "…a1b2", or who provides it.
    let status: String
    var statusIsHint = true
    let placeholder: String
    var footer: String? = nil
    let onConnect: (String) async throws -> ConnectResult
    var onDisconnect: (() async throws -> ConnectResult)? = nil
    @ViewBuilder var help: Help

    @State private var value = ""
    @State private var replacing = false
    @State private var busy = false
    @State private var message: (tone: InlineMessage.Tone, text: String)?
    @State private var confirmDisconnect = false
    @FocusState private var focused: Bool

    var body: some View {
        Section {
            if connected {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text(status)
                        .font(statusIsHint ? .body.monospaced() : .body)
                        .lineLimit(1)
                        .accessibilityIdentifier("\(id).status")
                    Spacer()
                    if !replacing {
                        Button("Replace") {
                            replacing = true
                            focused = true
                        }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("\(id).replace")
                    }
                }
            }
            if !connected || replacing {
                help
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    Image(systemName: "key").foregroundStyle(.secondary)
                    SecureField(placeholder, text: $value)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($focused)
                        .submitLabel(.go)
                        .onSubmit { Task { await connect() } }
                        .accessibilityIdentifier("\(id).key")
                }
                HStack {
                    Button {
                        Task { await connect() }
                    } label: {
                        HStack(spacing: 6) {
                            if busy { ProgressView().controlSize(.small) }
                            Text(busy ? "Checking…" : "Connect")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .prominentButton()
                    .disabled(value.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    .accessibilityIdentifier("\(id).connect")
                    if replacing {
                        Button("Cancel") {
                            replacing = false
                            value = ""
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            if let message {
                InlineMessage(tone: message.tone, text: message.text)
            }
            if connected, onDisconnect != nil {
                Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                    .accessibilityIdentifier("\(id).disconnect")
                    .confirmationDialog("Disconnect \(title)?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                        Button("Disconnect", role: .destructive) { Task { await disconnect() } }
                    }
            }
        } header: {
            Text(title)
        } footer: {
            if let footer { Text(footer) }
        }
    }

    private func connect() async {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !busy else { return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            let result = try await onConnect(key)
            if result.ok {
                value = ""
                replacing = false
                message = (.ok, result.note ?? "Connected.")
            } else {
                message = (.error, result.error ?? "That didn't work.")
            }
        } catch {
            message = (.error, error.localizedDescription)
        }
    }

    private func disconnect() async {
        message = nil
        do {
            let result = try await onDisconnect?() ?? ConnectResult(ok: true)
            // A disconnect that can't happen yet says why (e.g. VMs still on that account).
            if !result.ok { message = (.error, result.error ?? "Couldn't disconnect.") }
        } catch {
            message = (.error, error.localizedDescription)
        }
    }
}

/// Page placeholder rows while the state loads (the web's settings skeleton).
struct FormSkeleton: View {
    var sections = 2
    var rows = 3

    var body: some View {
        Form {
            ForEach(0..<sections, id: \.self) { _ in
                Section {
                    ForEach(0..<rows, id: \.self) { index in
                        LineBone(width: [220, 160, 260, 120][index % 4])
                    }
                }
            }
        }
        .redacted(reason: .placeholder)
    }
}
