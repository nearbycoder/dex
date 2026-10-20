import DexCore
import SwiftUI
import WebKit

/// GitHub for chats' VMs: "Connect with GitHub" (the server's OAuth flow) or a pasted fine-grained token.
struct GitHubPage: View {
    @Environment(AppModel.self) private var model
    @Environment(DexClient.self) private var client
    @State private var useToken = false
    @State private var connecting = false
    @State private var message: (tone: InlineMessage.Tone, text: String)?
    @State private var confirmDisconnect = false

    var body: some View {
        if let state = client.state {
            let github = state.github
            let oauth = github.oauthAvailable ?? false
            Form {
                if !oauth || useToken || (github.connected && github.via == "token") {
                    tokenSection(github)
                    if oauth, !github.connected {
                        Section {
                            Button("Connect with GitHub instead") { useToken = false }
                                .accessibilityIdentifier("github.useOAuth")
                        }
                    }
                } else if github.connected {
                    if github.expired == true {
                        Section {
                            Label("GitHub stopped accepting this connection (revoked or expired). New VMs can't sign in and repo search shows public repos only until you reconnect.", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                            Button("Reconnect") { startOAuth() }
                                .buttonStyle(.glassProminent)
                                .accessibilityIdentifier("github.reconnectExpired")
                        }
                    }
                    Section {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            Text("@\(github.login ?? "")").accessibilityIdentifier("github.status")
                            Spacer()
                            Text("via GitHub").font(.footnote).foregroundStyle(.secondary)
                        }
                        Button("Reconnect") { startOAuth() }
                            .accessibilityIdentifier("github.reconnect")
                        Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                            .accessibilityIdentifier("github.disconnect")
                    } header: {
                        Text("Connected")
                    } footer: {
                        Text("Disconnecting revokes the token at GitHub too, so it stops working everywhere, VMs included.")
                    }
                } else {
                    Section {
                        Button {
                            startOAuth()
                        } label: {
                            Label("Connect with GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(connecting)
                        .accessibilityIdentifier("github.connectOAuth")
                        Button("Use a fine-grained token instead") { useToken = true }
                            .accessibilityIdentifier("github.useToken")
                    } footer: {
                        Text("GitHub asks you to approve repo and workflow access for Dex. The token is stored encrypted in your agent; new VMs sign the GitHub CLI and git in with it. It can reach every repo you can, so for access limited to chosen repos, use a fine-grained token instead.")
                    }
                }
                if let message {
                    Section { InlineMessage(tone: message.tone, text: message.text) }
                }
            }
            .navigationTitle("GitHub")
            .confirmationDialog("Disconnect GitHub?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) {
                    client.perform { try await client.run("disconnectGitHub", timeout: 30) }
                }
            } message: {
                Text("New VMs won't be able to clone private repos or push.")
            }
            .sheet(isPresented: $connecting) {
                if let credentials = model.credentials {
                    GitHubConnectSheet(server: credentials.server, token: credentials.token) { outcome in
                        connecting = false
                        switch outcome {
                        case .connected: message = (.ok, "GitHub is connected. New VMs sign in with it.")
                        case .failed(let text): message = (.error, text)
                        case .cancelled: break
                        }
                    }
                }
            }
        } else {
            FormSkeleton().navigationTitle("GitHub")
        }
    }

    @ViewBuilder
    private func tokenSection(_ github: GitHubStatus) -> some View {
        KeyConnectSection(
            id: "github", title: "Fine-grained token", connected: github.connected,
            status: "@\(github.login ?? "")\(github.via == "token" ? " · token" : "")\(github.expired == true ? " · GitHub stopped accepting it: replace it" : "")",
            statusIsHint: false,
            placeholder: "github_pat_…",
            footer: "New VMs sign the GitHub CLI and git in with it. Anything on a VM can use it, so limit it to the repos Dex needs. Existing VMs pick up a new token after “Re-run setup”.",
            onConnect: { token in ConnectResult.from(try await client.run("connectGitHub", .string(token), "token", timeout: 60)) },
            onDisconnect: { ConnectResult.from(try await client.run("disconnectGitHub")) }
        ) {
            Text("Create a fine-grained token with Contents and Pull requests set to Read and write.")
        }
        Section {
            ExternalLink(title: "Create a fine-grained token", url: "https://github.com/settings/personal-access-tokens/new")
        }
    }

    private func startOAuth() {
        message = nil
        // The demo Dex has no GitHub app: connect as if GitHub said yes.
        if model.mockAgent != nil {
            client.perform {
                let result = ConnectResult.from(try await client.run("connectGitHub", "mock-oauth-token", "oauth"))
                message = result.ok ? (.ok, "GitHub is connected. New VMs sign in with it.") : (.error, result.error ?? "")
            }
            return
        }
        connecting = true
    }
}

/// "Connect with GitHub" in the app. The server's flow (`/auth/github/connect` → GitHub → `/auth/github/connect/callback`
/// → `/settings?github=connected`) checks the Dex session cookie at both ends and finishes on an https page, so it runs
/// here in a web view with its own throwaway cookie jar holding just this app's session cookie for the Dex host.
/// (ASWebAuthenticationSession can add a header only to the first request, so the callback would arrive without the
/// session, and it can only finish on a custom scheme or an associated https domain, which a self-hosted Dex isn't.)
struct GitHubConnectSheet: View {
    enum Outcome { case connected, failed(String), cancelled }

    let server: URL
    let token: String
    let finish: (Outcome) -> Void
    @State private var host = ""
    @State private var loading = true

    var body: some View {
        NavigationStack {
            OAuthWebView(server: server, token: token, host: $host, loading: $loading, finish: finish)
                .ignoresSafeArea(edges: .bottom)
                .overlay { if loading && host.isEmpty { ProgressView() } }
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { finish(.cancelled) }
                    }
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill").font(.caption2)
                            Text(host).font(.subheadline.weight(.medium)).lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if loading { ProgressView().controlSize(.small) }
                    }
                }
        }
    }
}

private struct OAuthWebView: UIViewRepresentable {
    let server: URL
    let token: String
    @Binding var host: String
    @Binding var loading: Bool
    let finish: (GitHubConnectSheet.Outcome) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        let start = server.appending(path: "auth/github/connect")
        if let cookie = DexHTTP.cookie(server: server, token: token) {
            configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { view.load(URLRequest(url: start)) }
        } else {
            view.load(URLRequest(url: start))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: OAuthWebView
        private var done = false
        init(_ parent: OAuthWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            await MainActor.run { self.parent.host = url.host() ?? "" }
            guard url.host() == parent.server.host() else { return .allow }
            // The flow ends back on Dex: Settings with its result, or sign-in if the session didn't count.
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            switch url.path() {
            case "/settings":
                let error = query.first { $0.name == "github_error" }?.value
                await complete(error.map { .failed($0) } ?? .connected)
                return .cancel
            case "/login":
                await complete(.failed("Dex didn't accept this app's session for the GitHub sign-in. Sign out and in again, or paste a token instead."))
                return .cancel
            default:
                return .allow
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { parent.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.loading = false
            let code = (error as NSError).code
            if code != NSURLErrorCancelled, code != 102 { Task { await complete(.failed(error.localizedDescription)) } }
        }

        @MainActor private func complete(_ outcome: GitHubConnectSheet.Outcome) {
            guard !done else { return }
            done = true
            parent.finish(outcome)
        }
    }
}
