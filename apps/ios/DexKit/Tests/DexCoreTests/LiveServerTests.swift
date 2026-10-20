import Foundation
import Testing
@testable import DexCore

/// Against a real Dex (e.g. `npm run dev` with DEV_LOGIN): set DEX_LIVE_SERVER (http://localhost:5173) and
/// DEX_LIVE_TOKEN (a session token from the native sign-in) to run these. Skipped otherwise. They create and delete a
/// chat and a workspace file, and need no model subscription.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["DEX_LIVE_SERVER"] != nil))
struct LiveServerTests {
    let server = URL(string: ProcessInfo.processInfo.environment["DEX_LIVE_SERVER"] ?? "http://localhost:5173")!
    let token = ProcessInfo.processInfo.environment["DEX_LIVE_TOKEN"] ?? ""

    func connect() async throws -> DexClient {
        let user = try sessionUser()
        let client = DexClient(credentials: Credentials(server: server, token: token, user: user, expiresAt: .nowMs + 86_400_000),
                               factory: WebSocketTransportFactory(server: server, userId: user.id, token: token), cache: nil)
        client.start()
        await eventually(.seconds(20)) { client.isConnected }
        return client
    }

    /// The user named in the token's (unverified, base64url) payload.
    func sessionUser() throws -> Viewer {
        var payload = String(token.split(separator: ".").first ?? "").replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload += "=" }
        struct Claims: Decodable { let user: Viewer }
        return try JSONDecoder().decode(Claims.self, from: Data(base64Encoded: payload) ?? Data()).user
    }

    @Test func syncsStateAndCallsMethods() async throws {
        let client = try await connect()
        #expect(client.state != nil)
        let catalog: ModelCatalog = try await client.call("modelCatalog")
        #expect(!catalog.models.isEmpty)
        let files: [JSONValue] = try await client.call("listFiles")
        _ = files
        await #expect(throws: AgentError.self) { try await client.run("noSuchMethod") }
        client.stop()
    }

    @Test func createsSubscribesAndDeletesAChat() async throws {
        let client = try await connect()
        let session: SessionMeta = try await client.call("createSession", ["title": "iOS live test"])
        await eventually { client.state?.session(session.id) != nil }
        let feed = client.chat(session.id)
        await eventually(.seconds(10)) { feed.transcript.loaded }
        #expect(feed.transcript.entries.isEmpty)
        try await feed.rename("iOS live test (renamed)")
        await eventually { client.state?.session(session.id)?.title == "iOS live test (renamed)" }
        try await feed.settle(true)
        await eventually { client.state?.session(session.id)?.settledAt != nil }
        try await feed.delete()
        await eventually { client.state?.session(session.id) == nil }
        client.stop()
    }

    @Test func workspaceFiles() async throws {
        let client = try await connect()
        let path = "/workspace/ios-live-test.md"
        try await client.run("writeFile", .string(path), .string("# Hello from iOS"))
        struct File: Decodable { let path: String; let content: String? }
        let file: File = try await client.call("readFile", .string(path))
        #expect(file.content == "# Hello from iOS")
        try await client.run("deleteFile", .string(path))
        client.stop()
    }

    @Test func refreshesTheToken() async throws {
        let fresh = try await AuthClient(server: server).refresh(token: token)
        #expect(fresh.user.id == (try sessionUser()).id)
        #expect(fresh.token != token || fresh.expiresAt > 0)
    }

    @Test func rejectsABadToken() async throws {
        let user = try sessionUser()
        let connection = AgentConnection(factory: WebSocketTransportFactory(server: server, userId: user.id, token: "forged.token"))
        connection.start()
        await eventually(.seconds(10)) { connection.status == .signedOut }
    }
}
