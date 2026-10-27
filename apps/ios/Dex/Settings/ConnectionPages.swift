import DexCore
import SwiftUI

/// ClinePass, OpenCode Go, and ChatGPT: the subscriptions Dex's models run on.
struct ModelSubscriptionsPage: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        if let state = client.state {
            Form {
                KeyConnectSection(
                    id: "cline", title: "ClinePass", connected: state.cline.connected,
                    status: state.cline.source == "user" ? state.cline.keyHint ?? "Connected" : "Shared deployment key",
                    statusIsHint: state.cline.source == "user",
                    placeholder: state.cline.source == "user" ? "New Cline API key" : "Cline API key",
                    footer: footer(state.cline, provider: "Cline"),
                    onConnect: { key in ConnectResult.from(try await client.run("connectCline", .string(key), timeout: 60)) },
                    onDisconnect: state.cline.source == "user" ? { ConnectResult.from(try await client.run("disconnectCline")) } : nil
                ) {
                    Text("Generate a key at app.cline.bot → Settings → API Keys. Needs a ClinePass subscription. Dex checks the key with Cline, then stores it encrypted in your agent; it never comes back to this app.")
                }
                Section {
                    ExternalLink(title: "Get a Cline API key", url: "https://app.cline.bot")
                    ExternalLink(title: "About ClinePass", url: "https://cline.bot/cline-pass")
                }

                KeyConnectSection(
                    id: "opencode", title: "OpenCode Go", connected: state.opencode.connected,
                    status: state.opencode.source == "user" ? state.opencode.keyHint ?? "Connected" : "This deployment's account",
                    statusIsHint: state.opencode.source == "user",
                    placeholder: state.opencode.source == "user" ? "New OpenCode API key" : "OpenCode API key",
                    footer: footer(state.opencode, provider: "OpenCode"),
                    onConnect: { key in ConnectResult.from(try await client.run("connectOpenCode", .string(key), timeout: 60)) },
                    onDisconnect: state.opencode.source == "user" ? { ConnectResult.from(try await client.run("disconnectOpenCode")) } : nil
                ) {
                    Text("Copy your key from the OpenCode console. Needs an OpenCode Go subscription ($10/month, or Go Plus for higher limits). Dex checks the key with OpenCode, then stores it encrypted in your agent.")
                }
                Section {
                    ExternalLink(title: "OpenCode console", url: "https://opencode.ai/auth")
                    ExternalLink(title: "About OpenCode Go", url: "https://opencode.ai/docs/go/")
                }

                ChatGPTConnectSection(status: state.chatgpt)
                Section {
                    ExternalLink(title: "About Sign in with ChatGPT", url: "https://developers.openai.com/siwc/token-sharing-open-source")
                } footer: {
                    Text("Models marked Cline, OpenCode, or ChatGPT in the model menu run on that subscription. Connect any or all of them.")
                }
            }
            .navigationTitle("Model Subscriptions")
        } else {
            FormSkeleton().navigationTitle("Model Subscriptions")
        }
    }

    private func footer(_ status: ClineStatus, provider: String) -> String? {
        guard status.connected else { return nil }
        let source = status.source == "user" ? "Your key" : "The deployment's key (you can add your own)"
        guard let verified = status.verifiedAt else { return source }
        return "\(source) · checked with \(provider) \(Format.ago(verified))"
    }
}

/// ChatGPT: Sign in with ChatGPT, so its models run on the user's Plus or Pro plan (chatgpt-connect.tsx on the web).
/// OpenAI only sends the browser back to a 127.0.0.1 address. The app listens there while the sign-in sheet is open
/// (ChatGPTSignIn) and finishes on its own; when it can't, the page opens in Safari, lands on an address that doesn't
/// load, and the user pastes that address here, as on the web.
struct ChatGPTConnectSection: View {
    @Environment(DexClient.self) private var client
    @Environment(\.openURL) private var openURL
    let status: ClineStatus

    @State private var signIn: (url: URL, redirectUri: String)?
    /// The app couldn't listen for the callback: the page opens in Safari and the address is pasted.
    @State private var manual = false
    @State private var capture: Task<Void, Never>?
    @State private var callback = ""
    @State private var starting = false
    @State private var checking = false
    @State private var message: (tone: InlineMessage.Tone, text: String)?
    @State private var confirmDisconnect = false

    var body: some View {
        Section {
            if status.connected {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text(status.keyHint ?? "Signed in")
                        .lineLimit(1)
                        .accessibilityIdentifier("chatgpt.status")
                    Spacer()
                    if signIn == nil {
                        Button("Sign In Again") { Task { await start() } }
                            .buttonStyle(.borderless)
                            .disabled(starting)
                            .accessibilityIdentifier("chatgpt.again")
                    }
                }
            }
            if let pending = signIn {
                if manual {
                    Text("Approve Dex on the ChatGPT page that opened in Safari. It then shows a page that can't be reached, at an address starting with \(pending.redirectUri). That's expected: copy the whole address and paste it here.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Approve Dex on the ChatGPT page. Dex finishes signing in by itself.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("If the page instead lands on an address starting with \(pending.redirectUri) that can't be reached, copy the whole address and paste it here.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("Open the ChatGPT Sign-In Page") { open() }
                    .disabled(checking)
                    .accessibilityIdentifier("chatgpt.open")
                HStack(spacing: 10) {
                    Image(systemName: "link").foregroundStyle(.secondary)
                    TextField("\(pending.redirectUri)?code=…", text: $callback)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.go)
                        .onSubmit { Task { await finish() } }
                        .accessibilityIdentifier("chatgpt.callback")
                }
                HStack {
                    Button {
                        Task { await finish() }
                    } label: {
                        HStack(spacing: 6) {
                            if checking { ProgressView().controlSize(.small) }
                            Text(checking ? "Checking…" : "Connect")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(callback.trimmingCharacters(in: .whitespaces).isEmpty || checking)
                    .accessibilityIdentifier("chatgpt.connect")
                    Button("Cancel") {
                        capture?.cancel()
                        signIn = nil
                        callback = ""
                        message = nil
                    }
                    .buttonStyle(.glass)
                }
            } else if !status.connected {
                Text("Use your ChatGPT Plus or Pro plan for GPT models, through OpenAI's Sign in with ChatGPT. Plus plans share their 5-hour limit with every app signed in this way. Dex stores the tokens encrypted in your agent; they never come back to this app.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await start() }
                } label: {
                    HStack(spacing: 6) {
                        if starting { ProgressView().controlSize(.small) }
                        Text("Sign in with ChatGPT")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(starting)
                .accessibilityIdentifier("chatgpt.start")
            }
            if let message {
                InlineMessage(tone: message.tone, text: message.text)
            }
            if status.connected {
                Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                    .accessibilityIdentifier("chatgpt.disconnect")
                    .confirmationDialog("Disconnect ChatGPT?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                        Button("Disconnect", role: .destructive) { Task { await disconnect() } }
                    }
            }
        } header: {
            Text("ChatGPT")
        } footer: {
            if status.connected, let verified = status.verifiedAt { Text("Signed in \(Format.ago(verified))") }
        }
    }

    private func start() async {
        guard !starting else { return }
        starting = true
        message = nil
        defer { starting = false }
        do {
            let answer = try await client.run("startChatGPTSignIn")
            guard let raw = answer["url"]?.string, let url = URL(string: raw) else {
                message = (.error, "Dex couldn't start the sign-in. Update Dex on the server and try again.")
                return
            }
            callback = ""
            manual = false
            signIn = (url, answer["redirectUri"]?.string ?? "http://127.0.0.1:1455/auth/callback")
            open()
        } catch {
            message = (.error, error.localizedDescription)
        }
    }

    /// Opens the sign-in page: in the sheet, listening for the callback, or in Safari to paste from.
    private func open() {
        guard let pending = signIn else { return }
        // The mock agent has no page to open: its address is pasted.
        if LaunchOptions.current.mock { return }
        if manual { return openURL(pending.url) }
        capture?.cancel()
        capture = Task {
            switch await ChatGPTSignIn.run(pending.url, redirectUri: pending.redirectUri) {
            case .captured(let address):
                guard !Task.isCancelled else { return }
                callback = address
                await finish()
            case .closed:
                break
            case .unavailable:
                guard !Task.isCancelled else { return }
                manual = true
                openURL(pending.url)
            }
        }
    }

    private func finish() async {
        let address = callback.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty, !checking else { return }
        checking = true
        message = nil
        defer { checking = false }
        do {
            let result = ConnectResult.from(try await client.run("finishChatGPTSignIn", .string(address), timeout: 60))
            if result.ok {
                capture?.cancel()
                signIn = nil
                callback = ""
                message = (.ok, "Signed in. ChatGPT's models are in the model menu.")
            } else {
                message = (.error, result.error ?? "That didn't work.")
            }
        } catch {
            message = (.error, error.localizedDescription)
        }
    }

    private func disconnect() async {
        message = nil
        capture?.cancel()
        signIn = nil
        do {
            _ = try await client.run("disconnectChatGPT")
        } catch {
            message = (.error, error.localizedDescription)
        }
    }
}

/// boat.dev: the account chats' VMs run (and bill) on, the default VM size, and when idle VMs stop.
struct CloudVMsPage: View {
    @Environment(DexClient.self) private var client
    @State private var minutes = 5

    var body: some View {
        if let state = client.state {
            Form {
                KeyConnectSection(
                    id: "boat", title: "boat.dev", connected: state.boat.connected,
                    status: state.boat.source == "user" ? state.boat.keyHint ?? "Connected" : "This deployment's account",
                    statusIsHint: state.boat.source == "user",
                    placeholder: state.boat.source == "user" ? "New boat.dev API key" : "boat.dev API key",
                    footer: "To switch accounts, delete your VMs first: they live in the account that made them.",
                    onConnect: { key in ConnectResult.from(try await client.run("connectBoat", .string(key), timeout: 60)) },
                    onDisconnect: state.boat.source == "user" ? { ConnectResult.from(try await client.run("disconnectBoat")) } : nil
                ) {
                    Text("Create an API key in your boat.dev account. Chats' VMs run on it, so boat.dev bills it for the time they run (they stop after a few idle minutes). Dex checks the key, then stores it encrypted in your agent.")
                }
                Section {
                    ExternalLink(title: "Open boat.dev", url: "https://boat.dev")
                }
                Section {
                    Picker("Size", selection: Binding(get: { state.settings.vmSize }, set: { size in
                        client.perform { try await client.run("updateSettings", ["vmSize": .string(size)]) }
                    })) {
                        ForEach(VmSizes.all, id: \.id) { size in Text(size.label).tag(size.id) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("vms.size")
                } header: {
                    Text("New VMs")
                } footer: {
                    Text("The size of each chat's VM when it starts. Projects can pick their own.")
                }
                Section {
                    Stepper(value: $minutes, in: 1...240, step: minutes < 15 ? 1 : 5) {
                        LabeledContent("Stop when idle for", value: "\(minutes) min")
                    }
                    .accessibilityIdentifier("vms.minutes")
                } footer: {
                    Text("A VM with nothing running stops after this long, so you only pay while it works. Its files stay.")
                }
            }
            .navigationTitle("Cloud VMs")
            .onAppear { minutes = state.settings.vmMinutes }
            .onChange(of: state.settings.vmMinutes) { _, value in minutes = value }
            .task(id: minutes) {
                // Saved after you stop tapping.
                guard minutes != client.state?.settings.vmMinutes else { return }
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled else { return }
                client.perform { try await client.run("updateSettings", ["vmMinutes": .number(Double(minutes))]) }
            }
        } else {
            FormSkeleton().navigationTitle("Cloud VMs")
        }
    }
}
