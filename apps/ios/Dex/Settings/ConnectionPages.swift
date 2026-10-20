import DexCore
import SwiftUI

/// ClinePass and OpenCode Go: the subscriptions Dex's models run on.
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
                } footer: {
                    Text("Models marked Cline or OpenCode in the model menu run on that subscription. Connect either or both.")
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
