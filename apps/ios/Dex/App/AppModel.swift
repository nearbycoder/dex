import DexCore
import Foundation
import Observation
import WebKit

/// App-wide sign-in: which Dex this app talks to and who is signed in. Each window makes its own `DexClient` from it.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case signedOut
        case signedIn(Credentials)
    }

    private(set) var phase: Phase
    /// Shown on the sign-in screen (e.g. after "Sign out everywhere" from another device).
    var signInMessage: String?
    /// The last server signed in to, prefilled on the sign-in screen.
    var lastServer: String {
        get { UserDefaults.standard.string(forKey: "dex.lastServer") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "dex.lastServer") }
    }

    let launch: LaunchOptions
    let cache: LocalCache
    private let store: CredentialStore
    /// The one mock agent every window talks to in mock mode (UI tests, demos).
    let mockAgent: MockAgent?

    init(launch: LaunchOptions = .current) {
        self.launch = launch
        store = CredentialStore(service: launch.mock ? "dev.trydex.app.mock" : "dev.trydex.app.session")
        if launch.resetState {
            store.clear()
            UserDefaults.standard.removeObject(forKey: "dex.lastServer")
        }
        let cacheRoot = launch.mock ? FileManager.default.temporaryDirectory.appending(path: "DexMockCache") : nil
        cache = LocalCache(root: cacheRoot)
        if launch.resetState { cache.clear() }
        if launch.mock {
            let agent = MockAgent()
            agent.chunkDelay = .milliseconds(launch.fastReplies ? 5 : 35)
            mockAgent = agent
            phase = launch.signedOut ? .signedOut : .signedIn(Self.mockCredentials)
        } else {
            mockAgent = nil
            if let saved = store.load(), !saved.isExpired() { phase = .signedIn(saved) } else { phase = .signedOut }
        }
    }

    static let mockCredentials = Credentials(
        server: URL(string: "https://mock.dex.local")!, token: "mock-token",
        user: Viewer(id: "mock", login: "octocat", name: "The Octocat", avatarUrl: nil), expiresAt: .nowMs + 30 * 86_400_000
    )

    var credentials: Credentials? {
        if case .signedIn(let credentials) = phase { credentials } else { nil }
    }

    /// A connection for one window.
    func makeClient() -> DexClient? {
        guard let credentials else { return nil }
        let factory: AgentTransportFactory = if let mockAgent {
            MockTransportFactory(agent: mockAgent)
        } else {
            WebSocketTransportFactory(server: credentials.server, userId: credentials.user.id, token: credentials.token)
        }
        let client = DexClient(credentials: credentials, factory: factory, cache: cache)
        if mockAgent != nil { client.setCatalog(MockData.catalog) }
        client.connection.onSignedOut = { [weak self] in
            self?.signOut(message: "You were signed out. Sign in again to continue.")
        }
        return client
    }

    // MARK: Signing in

    /// Finishes the native sign-in: trades the code from `dex://auth/callback` for a session.
    func completeSignIn(server: URL, callback: URL, pkce: PKCE) async throws {
        let code = try AuthClient.code(fromCallback: callback)
        let credentials = try await AuthClient(server: server).exchange(code: code, verifier: pkce.verifier)
        store.save(credentials)
        lastServer = server.absoluteString
        signInMessage = nil
        phase = .signedIn(credentials)
    }

    /// Signs in to the mock agent (UI tests of the sign-in screen).
    func signInToMock() {
        guard mockAgent != nil else { return }
        phase = .signedIn(Self.mockCredentials)
    }

    /// Renews the session token when less than a week is left (the server's sessions last 30 days).
    func refreshIfNeeded() async {
        guard mockAgent == nil, let credentials, credentials.needsRefresh() else { return }
        do {
            let fresh = try await AuthClient(server: credentials.server).refresh(token: credentials.token)
            store.save(fresh)
            phase = .signedIn(fresh)
        } catch AuthError.server(let message) where message == "Sign in again" {
            signOut(message: "Your session ended. Sign in again to continue.")
        } catch {
            // Offline or the server is busy: try again next launch; the token still works until it expires.
        }
    }

    /// Forgets the session and everything kept on this device.
    func signOut(message: String? = nil) {
        store.clear()
        cache.clear()
        signInMessage = message
        phase = .signedOut
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        Notifications.shared.clearAll()
    }
}

/// How the app was launched (UI tests pass these as arguments).
struct LaunchOptions {
    /// Run on the in-process mock agent instead of a server.
    var mock = false
    /// Start signed out (mock mode).
    var signedOut = false
    /// Forget saved sign-in and cache first.
    var resetState = false
    /// Mock replies stream quickly.
    var fastReplies = false
    /// Open this chat at launch.
    var openChat: String?

    static let current: LaunchOptions = {
        let arguments = ProcessInfo.processInfo.arguments
        var options = LaunchOptions()
        options.mock = arguments.contains("-DexMock")
        options.signedOut = arguments.contains("-DexSignedOut")
        options.resetState = arguments.contains("-DexReset")
        options.fastReplies = arguments.contains("-DexFast")
        if let index = arguments.firstIndex(of: "-DexOpenChat"), arguments.indices.contains(index + 1) { options.openChat = arguments[index + 1] }
        return options
    }()

    var isUITest: Bool { mock }
}
