import DexCore
import Foundation
import Testing
import UserNotifications
@testable import Dex

@MainActor
@Suite struct NotificationPreferencesTests {
    func preferences() -> (NotificationPreferences, UserDefaults) {
        let suite = "dex.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        return (NotificationPreferences(defaults: defaults), defaults)
    }

    @Test func followsPermissionUntilYouChoose() async {
        let (preferences, _) = preferences()
        #expect(!preferences.allows(kind: "reply")) // iOS hasn't allowed it yet
        preferences.authorization = .authorized
        #expect(preferences.allows(kind: "reply"))
        #expect(preferences.kinds == Set(NotifyKinds.defaults))
        await preferences.setEnabled(false)
        #expect(!preferences.allows(kind: "reply"))
    }

    @Test func kindsAndTheChatOnScreen() {
        let (preferences, defaults) = preferences()
        preferences.authorization = .authorized
        preferences.setKind("scheduled", on: false)
        #expect(!preferences.allows(kind: "scheduled"))
        #expect(preferences.allows(kind: "error"))
        #expect(!preferences.allows(kind: "reply", sessionId: "s-1", visibleChat: "s-1"))
        #expect(preferences.allows(kind: "reply", sessionId: "s-1", visibleChat: "s-2"))
        preferences.onlyWhenAway = false
        #expect(preferences.allows(kind: "reply", sessionId: "s-1", visibleChat: "s-1"))

        // Kept on the device.
        let again = NotificationPreferences(defaults: defaults)
        #expect(!again.kinds.contains("scheduled"))
        #expect(again.onlyWhenAway == false)
    }
}

@MainActor
@Suite struct FilesModelTests {
    func client() -> DexClient {
        let agent = MockAgent()
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        return client
    }

    func connected(_ client: DexClient) async {
        for _ in 0..<100 where !client.isConnected { try? await Task.sleep(for: .milliseconds(20)) }
    }

    @Test func opensEditsAndSaves() async throws {
        let client = client()
        await connected(client)
        let model = FilesModel()
        await model.refresh(client)
        #expect(model.files?.contains { $0.path == Workspace.memory } == true)
        await model.load(Workspace.memory, client: client)
        #expect(model.open?.content?.hasPrefix("# Memory") == true)
        #expect(!model.dirty)
        model.open?.draft += "\n- New fact."
        #expect(model.dirty)
        try await model.save(client: client)
        #expect(!model.dirty)
        #expect(model.exportURL != nil)
        model.open?.draft = "changed"
        model.discard()
        #expect(model.open?.draft.hasSuffix("- New fact.") == true)
    }

    @Test func createsDeletesAndRuns() async throws {
        let client = client()
        await connected(client)
        let model = FilesModel()
        await model.refresh(client)
        let path = try await model.create("notes/new.md", client: client)
        #expect(path == "/workspace/notes/new.md")
        #expect(model.file(path) != nil)
        await #expect(throws: (any Error).self) { try await model.create("/etc/passwd", client: client) }
        await model.load(path, client: client)
        try await model.delete(path, client: client)
        #expect(model.open == nil && model.file(path) == nil)
        await model.run("echo hi > hi.txt", client: client)
        #expect(model.terminal.last?.exitCode == 0)
        #expect(model.file("/workspace/hi.txt") != nil)
        await model.run("nope", client: client)
        #expect(model.terminal.last?.exitCode == 127)
    }
}
