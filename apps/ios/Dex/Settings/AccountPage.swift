import DexCore
import SwiftUI

/// Who's signed in, to which Dex, and signing out here or everywhere.
struct AccountPage: View {
    @Environment(AppModel.self) private var model
    @Environment(DexClient.self) private var client
    @State private var confirmSignOut = false
    @State private var confirmEverywhere = false
    @State private var signingOutEverywhere = false

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    UserAvatar(viewer: client.viewer, size: 84)
                    Text(client.viewer?.name ?? "").font(.title2.weight(.semibold))
                    Text("@\(client.viewer?.login ?? "")").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("account.header")
            }
            Section {
                LabeledContent("Server") {
                    Text(client.server?.host() ?? "").textSelection(.enabled)
                }
                if let server = client.server {
                    Link(destination: server) {
                        Label("Open Dex on the web", systemImage: "safari")
                    }
                }
            } header: {
                Text("Dex")
            } footer: {
                Text("This app keeps its session in the Keychain on this device.")
            }
            Section {
                Button("Sign Out", role: .destructive) { confirmSignOut = true }
                    .accessibilityIdentifier("account.signOut")
            } footer: {
                Text("Signs out this device only.")
            }
            Section {
                Button(role: .destructive) {
                    confirmEverywhere = true
                } label: {
                    HStack {
                        Label("Sign Out Everywhere", systemImage: "lock.trianglebadge.exclamationmark").foregroundStyle(.red)
                        if signingOutEverywhere { Spacer(); ProgressView() }
                    }
                }
                .disabled(signingOutEverywhere)
                .accessibilityIdentifier("account.signOutEverywhere")
            } footer: {
                Text("Ends every session on every device, including this one. Use it if a device is lost or your password may have leaked.")
            }
        }
        .navigationTitle("Account")
        .confirmationDialog("Sign out of Dex on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                Task { await model.signOut(unregistering: client) }
            }
        }
        .confirmationDialog("Sign out of Dex on every device, including this one?", isPresented: $confirmEverywhere, titleVisibility: .visible) {
            Button("Sign Out Everywhere", role: .destructive) { Task { await signOutEverywhere() } }
                .accessibilityIdentifier("account.confirmEverywhere")
        } message: {
            Text("Every browser and app signed in to this Dex must sign in again.")
        }
    }

    /// Like the web: ask the agent to end every session (its sockets close with 4001), then forget this one either way.
    private func signOutEverywhere() async {
        signingOutEverywhere = true
        await PushRegistration.shared.unregister(client)
        _ = try? await client.run("signOutEverywhere")
        model.signOut(message: "You signed out on every device. Sign in again to continue.")
    }
}
