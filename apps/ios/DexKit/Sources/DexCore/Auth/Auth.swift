import CryptoKit
import Foundation
import Security

/// The signed-in user, as the server's session token names them.
public struct Viewer: Codable, Sendable, Hashable {
    /// Also the name of this user's DexAgent instance.
    public var id: String
    public var login: String
    public var name: String
    public var avatarUrl: String?
    public init(id: String, login: String, name: String, avatarUrl: String? = nil) { self.id = id; self.login = login; self.name = name; self.avatarUrl = avatarUrl }
}

/// What a signed-in app keeps: which Dex, who, and the session token (in the Keychain).
public struct Credentials: Codable, Sendable, Hashable {
    public var server: URL
    public var token: String
    public var user: Viewer
    /// Milliseconds since 1970.
    public var expiresAt: Double
    public init(server: URL, token: String, user: Viewer, expiresAt: Double) { self.server = server; self.token = token; self.user = user; self.expiresAt = expiresAt }

    /// Less than a week left: renew it.
    public func needsRefresh(now: Date = .now) -> Bool { expiresAt - now.timeIntervalSince1970 * 1000 < 7 * 24 * 3600 * 1000 }
    public func isExpired(now: Date = .now) -> Bool { expiresAt <= now.timeIntervalSince1970 * 1000 }
}

/// PKCE (RFC 7636) for the native sign-in handoff (apps/web/src/server/native-auth.ts).
public struct PKCE: Sendable, Hashable {
    public let verifier: String
    public let challenge: String

    public init() {
        var bytes = [UInt8](repeating: 0, count: 48)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        self.init(verifier: Data(bytes).base64URLEncoded)
    }

    public init(verifier: String) {
        self.verifier = verifier
        self.challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
    }
}

public extension Data {
    var base64URLEncoded: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

public enum AuthError: LocalizedError, Equatable {
    case invalidServer
    case server(String)
    case callback(String)
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .invalidServer: "Enter your Dex's address, like https://dex.example.com."
        case .server(let message): message
        case .callback(let message): message
        case .cancelled: "Sign-in was cancelled."
        }
    }
}

/// The native sign-in endpoints.
public struct AuthClient: Sendable {
    public static let callbackScheme = "dex"
    public let server: URL
    private let session: URLSession

    public init(server: URL, session: URLSession = DexHTTP.session) {
        self.server = server
        self.session = session
    }

    /// Turns what someone typed into a server address: https by default, http only for local development.
    public static func normalize(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") {
            let local = text.hasPrefix("localhost") || text.hasPrefix("127.0.0.1") || text.hasPrefix("192.168.") || text.hasSuffix(".local")
            text = (local ? "http://" : "https://") + text
        }
        guard var components = URLComponents(string: text), let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host, !host.isEmpty else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    /// Where the browser sheet starts.
    public func startURL(challenge: String) -> URL {
        var components = URLComponents(url: server.appending(path: "auth/native/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "challenge", value: challenge)]
        return components.url!
    }

    /// The code from `dex://auth/callback?code=…`.
    public static func code(fromCallback url: URL) throws -> String {
        guard url.scheme == callbackScheme, url.host() == "auth", url.path() == "/callback",
              let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty
        else { throw AuthError.callback("Dex sent back an unexpected sign-in link.") }
        return code
    }

    struct TokenResponse: Decodable {
        let token: String
        let user: Viewer
        let expiresAt: Double
    }

    struct ErrorResponse: Decodable { let error: String }

    /// Trades the sign-in code (and the verifier only this app knows) for a session token.
    public func exchange(code: String, verifier: String) async throws -> Credentials {
        var request = URLRequest(url: server.appending(path: "auth/native/token"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "verifier": verifier])
        return try await credentials(for: request)
    }

    /// A fresh token for a still-valid one.
    public func refresh(token: String) async throws -> Credentials {
        var request = DexHTTP.request(server.appending(path: "auth/native/refresh"), token: token)
        request.httpMethod = "POST"
        return try await credentials(for: request)
    }

    private func credentials(for request: URLRequest) async throws -> Credentials {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            if let error = try? JSONDecoder().decode(ErrorResponse.self, from: data) { throw AuthError.server(error.error) }
            throw AuthError.server(status == 404 ? "This Dex doesn't support the app yet. Update it to the latest version." : "Sign-in failed (HTTP \(status)).")
        }
        let body = try JSONDecoder().decode(TokenResponse.self, from: data)
        return Credentials(server: server, token: body.token, user: body.user, expiresAt: body.expiresAt)
    }
}

/// Keeps credentials in the Keychain, this device only.
public struct CredentialStore: Sendable {
    public let service: String
    public init(service: String = "dev.trydex.app.session") { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "credentials"]
    }

    public func load() -> Credentials? {
        var query = self.query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    @discardableResult
    public func save(_ credentials: Credentials) -> Bool {
        guard let data = try? JSONEncoder().encode(credentials) else { return false }
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    public func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
