import Foundation
import Testing
@testable import DexCore

/// Unread chats, sidekicks' notification settings, push to the app, scheduled notes, and the widgets' snapshot.
@Suite struct UnreadDecodingTests {
    @Test func sessionUnreadFields() throws {
        let json = #"{"id":"s-1","title":"Lisbon","unread":true,"lastReply":"Here's the plan.","repliedAt":1792300000000}"#
        let session = try JSONDecoder().decode(SessionMeta.self, from: Data(json.utf8))
        #expect(session.unread && session.lastReply == "Here's the plan." && session.repliedAt == 1_792_300_000_000)

        // An agent from before unread.
        let old = try JSONDecoder().decode(SessionMeta.self, from: Data(#"{"id":"s-2","title":"Old"}"#.utf8))
        #expect(!old.unread && old.lastReply == nil && old.repliedAt == nil)
    }

    @Test func sidekickNotify() throws {
        let json = #"{"id":"atlas","name":"Atlas","sessionId":"s-a","notify":"reachouts"}"#
        let atlas = try JSONDecoder().decode(CharacterProfile.self, from: Data(json.utf8))
        #expect(atlas.notifyLevel == .reachouts)
        #expect(try JSONDecoder().decode(CharacterProfile.self, from: Data(#"{"id":"m","name":"Muse"}"#.utf8)).notifyLevel == .all)
        #expect(try JSONDecoder().decode(CharacterProfile.self, from: Data(#"{"id":"m","notify":"loud"}"#.utf8)).notifyLevel == .all)
        #expect(SidekickNotify.all.toggled == .off && SidekickNotify.reachouts.toggled == .off && SidekickNotify.off.toggled == .all)
        #expect(SidekickNotify.allCases.map(\.label) == ["Every message", "When they reach out", "Off"])
    }

    @Test func draftSendsNotifyOnlyWhenChanged() throws {
        let atlas = CharacterProfile(id: "atlas", name: "Atlas", image: "data:image/png;base64,AAAA", notify: "reachouts", sessionId: "s-a")
        // The editor's draft leaves it out (the server keeps it), and its picture too.
        let plain = try JSONValue(encoding: CharacterDraft(atlas))
        #expect(plain["notify"] == nil && plain["image"] == nil && plain["look"] == nil)
        let changed = try JSONValue(encoding: CharacterDraft.withNotify(atlas, .off))
        #expect(changed["notify"]?.string == "off" && changed["id"]?.string == "atlas" && changed["image"] == nil && changed["look"] == nil)
    }

    @Test func pushStatusNativeAndPlatforms() throws {
        let json = #"""
        {"configured":true,"publicKey":"B","native":{"ios":true,"android":false},
         "devices":[{"id":"d1","label":"Mac · Safari","kinds":["reply"],"onlyWhenAway":true,"createdAt":1,"lastSentAt":null,"error":null},
                    {"id":"d2","platform":"ios","label":"Josh's iPhone · iPhone app","kinds":["sidekick","reply"],"onlyWhenAway":false,"createdAt":2,"lastSentAt":3,"error":null}]}
        """#
        let status = try JSONDecoder().decode(PushStatus.self, from: Data(json.utf8))
        #expect(status.native.ios && !status.native.android)
        #expect(status.devices.map(\.platform) == ["web", "ios"])
        // An agent from before the apps had push.
        let old = try JSONDecoder().decode(PushStatus.self, from: Data(#"{"configured":false,"publicKey":null,"devices":[]}"#.utf8))
        #expect(!old.native.ios && !old.native.android)
        #expect(NotifyKinds.all.first?.id == "sidekick" && NotifyKinds.all.first?.label == "Sidekicks")
        #expect(NotifyKinds.defaults.contains("sidekick"))
    }

    @Test func unreadCount() {
        var state = DexState()
        state.sessions = [
            SessionMeta(id: "a", title: "A", model: "", thinking: "low", createdAt: 0, updatedAt: 0, unread: true),
            SessionMeta(id: "b", title: "B", model: "", thinking: "low", createdAt: 0, updatedAt: 0, characterId: "c", unread: true),
            SessionMeta(id: "c", title: "C", model: "", thinking: "low", createdAt: 0, updatedAt: 0)
        ]
        #expect(state.unreadCount == 2)
    }

    @Test func pushTokenAndLabel() {
        #expect(PushToken.hex(Data([0x00, 0xAB, 0x10, 0xFF])) == "00ab10ff")
        #expect(PushToken.label(name: "Josh Hamilton", model: "iPhone") == "Josh's iPhone · iPhone app")
        #expect(PushToken.label(name: nil, model: "iPad") == "iPad · iPad app")
    }

    @Test func scheduledNote() {
        #expect(UserText.scheduledPrompt("[Scheduled task] Check in on the plan") == "Check in on the plan")
        #expect(UserText.scheduledPrompt("Check in on the plan") == nil)
        #expect(UserText.scheduledPrompt("Hi [Scheduled task] later") == nil)
    }
}

@Suite struct WidgetSnapshotTests {
    /// `GET /api/sidekicks`, as apps/web/src/routes/api.sidekicks.ts answers it.
    static let json = #"""
    {"unread":3,"sidekicks":[
      {"id":"muse","name":"Muse","tagline":"Your creative sparring partner","color":"violet","image":"data:image/png;base64,iVBORw0KGgo=","avatar":"",
       "sessionId":"s-muse","unread":false,"busy":false,"lastReply":"Want me to sketch a logo next?","repliedAt":1792300000000},
      {"id":"atlas","name":"Atlas","tagline":"Keeps your life organized","color":"sky","image":null,"avatar":"🧭",
       "sessionId":"s-atlas","unread":true,"busy":true,"lastReply":null,"repliedAt":null}]}
    """#

    @Test func decodesTheRoute() throws {
        let snapshot = try WidgetFeed.decode(Data(Self.json.utf8), status: 200, retryAfter: nil, now: 42)
        #expect(snapshot.unread == 3 && snapshot.updatedAt == 42)
        #expect(snapshot.sidekicks.map(\.id) == ["muse", "atlas"])
        let muse = try #require(snapshot.sidekick("muse"))
        #expect(muse.imageData == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        #expect(muse.line == "Want me to sketch a logo next?")
        let atlas = try #require(snapshot.sidekick("atlas"))
        #expect(atlas.unread && atlas.busy && atlas.imageData == nil && atlas.glyph == "🧭" && atlas.line == "Keeps your life organized")
        #expect(snapshot.unreadSidekicks == 1)

        // `?images=0` leaves the pictures out altogether.
        let lean = try WidgetFeed.decode(Data(#"{"unread":0,"sidekicks":[{"id":"muse","name":"Muse","sessionId":"s-muse"}]}"#.utf8), status: 200, retryAfter: nil)
        #expect(lean.sidekicks.first?.image == nil && lean.sidekicks.first?.color == "violet")
    }

    @Test func failures() {
        #expect(throws: WidgetFeed.Failure.signedOut) { try WidgetFeed.decode(Data(), status: 401, retryAfter: nil) }
        #expect(throws: WidgetFeed.Failure.unavailable(retryAfter: 2)) { try WidgetFeed.decode(Data(), status: 503, retryAfter: "2") }
        #expect(throws: WidgetFeed.Failure.http(500)) { try WidgetFeed.decode(Data(), status: 500, retryAfter: nil) }
        #expect(throws: WidgetFeed.Failure.http(200)) { try WidgetFeed.decode(Data("<html>".utf8), status: 200, retryAfter: nil) }
    }

    @Test func request() {
        let request = WidgetFeed.request(server: URL(string: "https://dex.example.com")!, token: "abc", images: false)
        #expect(request.url?.absoluteString == "https://dex.example.com/api/sidekicks?images=0")
        #expect(request.value(forHTTPHeaderField: "Cookie") == "dex_session=abc")
        #expect(request.value(forHTTPHeaderField: "Origin") == nil)
        #expect(WidgetFeed.request(server: URL(string: "https://dex.example.com/")!, token: "abc", images: true).url?.absoluteString == "https://dex.example.com/api/sidekicks")
    }

    @Test func fromState() {
        var state = DexState()
        state.characters = [CharacterProfile(id: "muse", name: "Muse", tagline: "Hi", image: "data:image/png;base64,AA==", color: "violet", sessionId: "s-muse")]
        state.sessions = [
            SessionMeta(id: "s-muse", title: "Muse", model: "", thinking: "low", createdAt: 0, updatedAt: 0, characterId: "muse", unread: true, lastReply: "Hey!", repliedAt: 5),
            SessionMeta(id: "s-x", title: "X", model: "", thinking: "low", createdAt: 0, updatedAt: 0, unread: true)
        ]
        let snapshot = SidekickSnapshot(state: state, now: 9)
        #expect(snapshot.unread == 2)
        #expect(snapshot.sidekicks == [WidgetSidekick(id: "muse", name: "Muse", tagline: "Hi", color: "violet", image: "data:image/png;base64,AA==", sessionId: "s-muse",
                                                       unread: true, lastReply: "Hey!", repliedAt: 5)])
        #expect(snapshot.sameContent(as: SidekickSnapshot(state: state, now: 10)))
        #expect(!snapshot.sameContent(as: snapshot.withoutImages))
    }

    @Test func storeKeepsPicturesAsFiles() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "dex-widget-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = WidgetStore(root: root)
        let full = try WidgetFeed.decode(Data(Self.json.utf8), status: 200, retryAfter: nil, now: .nowMs)
        store.save(full, pictures: true)
        #expect(store.load() == full.withoutImages)
        #expect(store.picture("muse") == full.sidekick("muse")?.imageData)
        #expect(store.picture("atlas") == nil)
        #expect(store.picturesAreRecent() && store.hasPictures(for: full))
        #expect(!store.picturesAreRecent(now: .nowMs + WidgetStore.pictureLifetime + 1))

        // A fetch without pictures keeps the ones there are; a new sidekick needs a fetch with them.
        var lean = full.withoutImages
        lean.sidekicks.append(WidgetSidekick(id: "rex", name: "Rex", sessionId: "s-rex"))
        store.save(lean, pictures: false)
        #expect(store.picture("muse") != nil)
        #expect(!store.hasPictures(for: lean))

        store.clear()
        #expect(store.load() == nil && store.picture("muse") == nil && !store.picturesAreRecent())
    }

    @Test func links() {
        #expect(DexLink.chat("s-muse").absoluteString == "dex://chat/s-muse")
        #expect(DexLink.chat("s-muse", compose: true).absoluteString == "dex://chat/s-muse?compose=1")
    }
}

@MainActor
@Suite struct UnreadMockTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        agent.chunkDelay = .milliseconds(1)
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func seededUnread() async {
        let (_, client) = await connected()
        await eventually { client.state?.session(MockAgent.atlasChatId) != nil }
        let atlas = client.state?.session(MockAgent.atlasChatId)
        #expect(atlas?.unread == true && atlas?.lastReply == MockAgent.atlasCheckIn)
        #expect(client.state?.character(MockAgent.atlasId)?.notifyLevel == .reachouts)
        #expect(client.state?.session(MockData.chartChatId)?.unread == true)
        #expect(client.state?.push.native.ios == true)
    }

    @Test func openingAChatMarksItRead() async throws {
        let (_, client) = await connected()
        await eventually { client.state?.session(MockAgent.atlasChatId)?.unread == true }
        // On screen in a visible window: presence marks it read.
        _ = client.chat(MockAgent.atlasChatId)
        await eventually { client.state?.session(MockAgent.atlasChatId)?.unread == false }
        try await client.markUnread(MockAgent.atlasChatId)
        await eventually { client.state?.session(MockAgent.atlasChatId)?.unread == true }
        await client.markRead(MockAgent.atlasChatId)
        await eventually { client.state?.session(MockAgent.atlasChatId)?.unread == false }
    }

    @Test func aReplyWhileAwayIsUnread() async throws {
        let (_, client) = await connected()
        let feed = client.chat(MockData.welcomeId)
        // In the background: the reply waits, unread.
        client.setVisible(false)
        try await feed.send("Thanks!")
        await eventually(.seconds(10)) { client.state?.session(MockData.welcomeId)?.unread == true }
        #expect(client.state?.session(MockData.welcomeId)?.lastReply?.contains("short answer") == true)
        client.setVisible(true)
        await eventually { client.state?.session(MockData.welcomeId)?.unread == false }
    }

    @Test func behindAnotherTabStaysUnread() async throws {
        let (agent, client) = await connected()
        _ = client.chat(MockData.welcomeId)
        client.setChatOnScreen(false)
        await eventually { agent.connections.first?.presence.sessionId == nil }
        #expect(client.watchedChat == nil)
        client.setChatOnScreen(true)
        await eventually { agent.connections.first?.presence.sessionId == MockData.welcomeId }
    }

    @Test func notifySettingAndNativePush() async throws {
        let (agent, client) = await connected()
        await eventually { client.state?.character(MockAgent.museId) != nil }
        let muse = try #require(client.state?.character(MockAgent.museId))
        let quiet = try await client.setCharacterNotify(muse, .off)
        #expect(quiet.notifyLevel == .off && quiet.image == muse.image && quiet.look == muse.look)
        // Saving the editor's draft (no notify) keeps it.
        var draft = CharacterDraft(quiet)
        draft.tagline = "New tagline"
        #expect(try await client.saveCharacter(draft).notifyLevel == .off)

        let id = try await client.registerNativePush(token: String(repeating: "ab", count: 32), environment: "sandbox", label: "Mona's iPhone · iPhone app")
        await eventually { client.state?.push.devices.contains { $0.id == id && $0.platform == "ios" } == true }
        // Again (every launch): the same device.
        #expect(try await client.registerNativePush(token: String(repeating: "ab", count: 32), environment: "sandbox", label: "Mona's iPhone · iPhone app") == id)
        #expect(agent.state.push.devices.filter { $0.platform == "ios" }.count == 1)
    }
}
