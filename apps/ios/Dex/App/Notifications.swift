import DexCore
import Observation
import SwiftUI
import UserNotifications
import UIKit

/// Local notifications: when a chat's run finishes or fails and you aren't looking at it (or the app is in the
/// background), while the app is running. Web Push (VAPID) can't reach a native app and the server has no APNs sender
/// yet, so a closed app isn't notified; a run still going when you leave keeps the app awake a little longer.
@MainActor
@Observable
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    /// Posted with a chat id when a notification is tapped.
    static let openChat = Notification.Name("dex.openChat")
    /// The person allowed notifications on this device.
    private(set) var authorized = false
    @ObservationIgnored private var asked = false

    func install() {
        UNUserNotificationCenter.current().delegate = self
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        asked = settings.authorizationStatus != .notDetermined
    }

    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        return granted
    }

    /// Asks once, the first time you send something (not in UI tests, where the system prompt would cover the app).
    func requestPermissionIfNeeded() {
        guard !asked, !LaunchOptions.current.isUITest else { return }
        asked = true
        Task { _ = await requestPermission() }
    }

    func post(title: String, body: String, sessionId: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = sessionId
        content.userInfo = ["sessionId": sessionId]
        // One per chat: a newer reply replaces the last.
        let request = UNNotificationRequest(identifier: "chat-\(sessionId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    func clear(sessionId: String) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["chat-\(sessionId)"])
    }

    func clearAll() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().setBadgeCount(0)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let id = response.notification.request.content.userInfo["sessionId"] as? String
        await MainActor.run {
            if let id { NotificationCenter.default.post(name: Self.openChat, object: id) }
        }
    }
}

/// Watches a window's synced chats and posts a notification when one's run ends (`busy` true → false) where you
/// aren't looking. The reply's start comes from the open chat's transcript, or is read from the agent.
@MainActor
final class ChatNotifier {
    private let client: DexClient
    private let router: Router
    private var sessions: [SessionMeta]
    private var appActive = true
    private var background: UIBackgroundTaskIdentifier = .invalid
    private var stopped = false

    init(client: DexClient, router: Router) {
        self.client = client
        self.router = router
        sessions = client.state?.sessions ?? []
        watch()
    }

    func stop() {
        stopped = true
        endBackgroundTask()
    }

    func setActive(_ active: Bool) {
        appActive = active
        if active { endBackgroundTask() } else if sessions.contains(where: \.busy) { beginBackgroundTask() }
    }

    /// Follows `client.state?.sessions` without a view (it keeps working while the window is in the background).
    private func watch() {
        guard !stopped else { return }
        withObservationTracking {
            _ = client.state?.sessions
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.changed()
                self.watch()
            }
        }
    }

    private func changed() {
        let current = client.state?.sessions ?? []
        let finished = ChatAlerts.finished(previous: sessions, current: current)
        sessions = current
        for session in finished where ChatAlerts.shouldNotify(session, openChat: router.tab == .chats ? router.chat : nil, appActive: appActive) {
            Task { await notify(session) }
        }
        if !appActive, !current.contains(where: \.busy) { endBackgroundTask() }
    }

    private func notify(_ session: SessionMeta) async {
        var reply: (text: String, error: String?)?
        if let feed = client.activeChat, feed.sessionId == session.id {
            reply = ChatAlerts.lastReply(feed.transcript)
            if reply == nil, feed.transcript.loaded { return }  // Stopped: nothing to say.
        } else if let result = try? await client.call("runUiOperation", .string(session.id), "app_read_session",
                                                      ["session_id": .string(session.id), "last_messages": 2], ["query": true], as: JSONValue.self),
                  result["ok"]?.bool == true {
            reply = (ChatAlerts.lastReply(readSession: result["result"] ?? .null) ?? "", nil)
        }
        let content = ChatAlerts.content(title: session.title, reply: reply?.text, error: reply?.error)
        Notifications.shared.post(title: content.title, body: content.body, sessionId: session.id)
    }

    /// Asks iOS for a little more time in the background so a run that's nearly done can still say so.
    private func beginBackgroundTask() {
        guard background == .invalid else { return }
        background = UIApplication.shared.beginBackgroundTask(withName: "Finish a reply") { [weak self] in
            Task { @MainActor in self?.endBackgroundTask() }
        }
    }

    private func endBackgroundTask() {
        guard background != .invalid else { return }
        UIApplication.shared.endBackgroundTask(background)
        background = .invalid
    }
}

extension View {
    /// Posts local notifications for this window's chats (see ChatNotifier).
    func chatNotifications() -> some View { modifier(ChatNotifications()) }
}

private struct ChatNotifications: ViewModifier {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var notifier: ChatNotifier?

    func body(content: Content) -> some View {
        content
            .onAppear { if notifier == nil { notifier = ChatNotifier(client: client, router: router) } }
            .onDisappear { notifier?.stop(); notifier = nil }
            .onChange(of: scenePhase) { _, phase in
                notifier?.setActive(phase == .active)
                if phase == .active { Task { await Notifications.shared.refreshAuthorization() } }
            }
    }
}
