import DexCore
import Foundation
import Testing
@testable import Dex

/// Where a tapped notification goes, and the links widgets and notifications open.
@MainActor
@Suite struct PushRouteTests {
    @Test func remotePayloads() {
        // As apps/web/src/agent/native-push.ts sends them.
        #expect(PushRoute.url(for: ["url": "/chat/s-atlas", "sessionId": "s-atlas", "kind": "sidekick"]) == URL(string: "dex://chat/s-atlas"))
        #expect(PushRoute.url(for: ["url": "/chat/s-1", "sessionId": "s-1", "kind": "reply"]) == URL(string: "dex://chat/s-1"))
        #expect(PushRoute.url(for: ["url": "/machine/s-vm", "sessionId": "s-vm", "kind": "machine"]) == URL(string: "dex://machine/s-vm"))
        #expect(PushRoute.url(for: ["url": "/notifications", "sessionId": NSNull(), "kind": "test"]) == URL(string: "dex://settings/notifications"))
        // A path the app doesn't have falls back to the chat, if there is one.
        #expect(PushRoute.url(for: ["url": "/settings/mcp", "sessionId": "s-2", "kind": "mcp"]) == URL(string: "dex://chat/s-2"))
        #expect(PushRoute.url(for: ["url": "/", "kind": "snooze"]) == nil)
        // The app's own local notifications carry only the chat.
        #expect(PushRoute.url(for: ["sessionId": "s-3"]) == URL(string: "dex://chat/s-3"))
        #expect(PushRoute.sessionId(["sessionId": NSNull()]) == nil)
        #expect(PushRoute.sessionId(["aps": ["badge": 2], "sessionId": "s-4"]) == "s-4")
    }

    @Test func routesOpenWhereTheyPoint() {
        let router = Router()
        #expect(router.handle(PushRoute.url(for: ["url": "/chat/s-atlas", "sessionId": "s-atlas"])!))
        #expect(router.tab == .chats && router.chat == "s-atlas" && router.composeRequest == nil)
        #expect(router.handle(PushRoute.url(for: ["url": "/notifications"])!))
        #expect(router.tab == .settings && router.settingsPage == .notifications)
        #expect(router.handle(PushRoute.url(for: ["url": "/machine/s-vm"])!))
        #expect(router.tab == .machines && router.machine == "s-vm")
    }

    @Test func widgetLinks() {
        let router = Router()
        // A widget's Message button: the chat, with the caret in its box.
        #expect(router.handle(DexLink.chat("s-muse", compose: true)))
        #expect(router.chat == "s-muse" && router.composeRequest == "s-muse")
        #expect(router.handle(DexLink.chat("s-atlas")))
        #expect(router.chat == "s-atlas" && router.composeRequest == nil)
        #expect(router.handle(DexLink.newSidekick))
        #expect(router.tab == .chats && router.characterSheet == .new)
        #expect(!router.handle(URL(string: "dex://settings/nowhere")!))
    }

    @Test func environmentFollowsTheBuild() {
        // Tests run Debug builds (aps-environment development): APNs' sandbox.
        #expect(PushRegistration.environment == "sandbox")
    }
}
