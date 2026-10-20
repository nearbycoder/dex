import AuthenticationServices
import DexCore
import SwiftUI
import UIKit

/// Signing in to an OAuth MCP server: its sign-in page opens in the system browser sheet. The server's callback goes
/// to Dex (not back to the app), so the sheet closes on its own once the synced state says the server is ready, or
/// when the user closes it.
enum McpSignIn {
    /// Returns whether the server is ready afterwards.
    @MainActor
    static func run(_ authUrl: String, serverId: String, client: DexClient) async -> Bool {
        func ready() -> Bool { client.state?.mcp.first { $0.id == serverId }?.status == "ready" }
        guard let url = URL(string: authUrl) else { return ready() }
        // The mock agent signs in by itself; there's no page to open.
        let browser = !LaunchOptions.current.mock
        await withTaskGroup(of: Void.self) { group in
            if browser { group.addTask { await WebSignIn.present(url) } }
            group.addTask {
                let deadline = ContinuousClock.now + (browser ? .seconds(900) : .seconds(15))
                while !Task.isCancelled, ContinuousClock.now < deadline {
                    if await ready() { return }
                    try? await Task.sleep(for: .milliseconds(300))
                }
            }
            await group.next()
            group.cancelAll()
        }
        return ready()
    }
}

/// One ASWebAuthenticationSession, closed when its task is cancelled.
@MainActor
private final class WebSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<Void, Never>?

    static func present(_ url: URL) async {
        let signIn = WebSignIn()
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in signIn.start(url, continuation) }
        } onCancel: {
            Task { @MainActor in signIn.finish(cancel: true) }
        }
    }

    private func start(_ url: URL, _ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme("dex")) { [weak self] _, _ in
            Task { @MainActor in self?.finish(cancel: false) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { finish(cancel: false) }
    }

    private func finish(cancel: Bool) {
        if cancel { session?.cancel() }
        session = nil
        continuation?.resume()
        continuation = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first ?? ASPresentationAnchor()
        }
    }
}
