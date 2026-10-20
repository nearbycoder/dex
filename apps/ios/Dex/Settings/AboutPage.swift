import DexCore
import SwiftUI

/// This app's version, the server's build, the connection, and links.
struct AboutPage: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Image("DexLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 72, height: 72)
                        .accessibilityHidden(true)
                    Text("Dex").font(.title2.weight(.semibold))
                    Text("Your durable agent, with its own cloud computer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .listRowBackground(Color.clear)
            }
            Section("This App") {
                LabeledContent("Version", value: Self.version)
                    .accessibilityIdentifier("about.version")
            }
            Section("Server") {
                LabeledContent("Address", value: client.server?.host() ?? "—")
                LabeledContent("Build") {
                    Text(serverBuild).textSelection(.enabled)
                }
                .accessibilityIdentifier("about.build")
                LabeledContent("Connection") {
                    HStack(spacing: 6) {
                        StatusDot(kind: connectionKind)
                        Text(connectionLabel)
                    }
                }
                .accessibilityIdentifier("about.connection")
                if let models = client.state?.models {
                    LabeledContent("Model list", value: "\(client.catalog.models.count) models · updated \(Format.ago(models.updatedAt))")
                }
            }
            Section {
                ExternalLink(title: "README", url: "https://github.com/nearbycoder/dex#readme")
                ExternalLink(title: "License", url: "https://github.com/nearbycoder/dex/blob/main/LICENSE")
            }
        }
        .navigationTitle("About")
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    /// The agent's build: an ISO date stamped at deploy, shown readably when it parses.
    private var serverBuild: String {
        guard let build = client.state?.build else { return "—" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: build) { return date.formatted(date: .abbreviated, time: .shortened) }
        return build
    }

    private var connectionKind: StatusDot.Kind {
        switch client.connection.status {
        case .connected: .running
        case .connecting, .waiting: .working
        default: .failed
        }
    }

    private var connectionLabel: String {
        switch client.connection.status {
        case .connected: "Connected"
        case .connecting: "Connecting…"
        case .waiting: "Reconnecting…"
        case .signedOut: "Signed out"
        default: "Offline"
        }
    }
}
