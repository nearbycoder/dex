import DexCore
import Observation
import SwiftUI
import UserNotifications
import UIKit

/// Notifications on this device. Dex pushes them through APNs once this device is registered (`PushRegistration`), so
/// they arrive with the app closed; until then (a Dex without APNs keys, or an older agent) the app posts local ones
/// while it runs, when a chat's run finishes or fails and you aren't looking at it. Either way: one per chat (a newer
/// one replaces it), none for the chat on screen, a tap opens what it's about, and the app icon's badge counts the
/// unread chats.
@MainActor
@Observable
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    /// Posted when a notification was tapped: a window takes the link (`takePending`) and opens it.
    static let openURL = Notification.Name("dex.openURL")
    /// The person allowed notifications on this device.
    private(set) var authorized = false
    @ObservationIgnored private var asked = false
    /// What a tapped notification opens, until a window takes it (one may not exist yet on a cold launch).
    @ObservationIgnored private var pending: URL?
    /// The chat each foreground window shows, by window.
    @ObservationIgnored private var onScreen: [UUID: String] = [:]
    @ObservationIgnored private var badge: Int?

    func install() {
        UNUserNotificationCenter.current().delegate = self
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorized = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        asked = settings.authorizationStatus != .notDetermined
        // iOS remembers the token: asking again each launch is how a changed one comes back.
        if authorized, PushRegistration.shared.wanted { PushRegistration.shared.requestToken() }
    }

    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        return granted
    }

    /// Asks once, at a moment it makes sense (the first message you send, the first time you open a sidekick); never
    /// at launch, and not in UI tests, where the system prompt would cover the app.
    func requestPermissionIfNeeded() {
        guard !asked, !LaunchOptions.current.isUITest else { return }
        asked = true
        Task { _ = await requestPermission() }
    }

    // MARK: Local notifications

    func post(title: String, body: String, sessionId: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = sessionId
        content.userInfo = ["sessionId": sessionId]
        // One per chat (as the pushes' collapse id): a newer reply replaces the last.
        let request = UNNotificationRequest(identifier: "chat-\(sessionId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Takes a chat's notifications off the Lock Screen and Notification Center (you've seen it).
    func clear(sessionId: String) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["chat-\(sessionId)"])
        // Pushes are grouped by chat too (their thread): any left over from before the collapse id.
        let center = UNUserNotificationCenter.current()
        Task {
            let stale = await center.deliveredNotifications().filter { PushRoute.sessionId($0.request.content.userInfo) == sessionId }.map(\.request.identifier)
            if !stale.isEmpty { center.removeDeliveredNotifications(withIdentifiers: stale) }
        }
    }

    func clearAll() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        setBadge(0)
    }

    /// The app icon's badge: unread chats (pushes set it too, from the agent's count).
    func setBadge(_ count: Int) {
        guard count != badge else { return }
        badge = count
        UNUserNotificationCenter.current().setBadgeCount(count)
    }

    // MARK: Where you are

    /// A window shows this chat in the foreground (nil: none, or it's in the background).
    func setOnScreen(_ sessionId: String?, window: UUID) {
        onScreen[window] = sessionId
    }

    func isOnScreen(_ sessionId: String) -> Bool { onScreen.values.contains(sessionId) }

    /// The link a tapped notification opens, for the first window to ask.
    func takePending() -> URL? {
        defer { pending = nil }
        return pending
    }

    private func open(_ url: URL) {
        pending = url
        NotificationCenter.default.post(name: Self.openURL, object: nil)
    }

    // MARK: UNUserNotificationCenterDelegate

    /// In the foreground: a banner, unless it's about the chat on screen (you're reading it).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let sessionId = PushRoute.sessionId(notification.request.content.userInfo)
        let remote = notification.request.trigger is UNPushNotificationTrigger
        return await MainActor.run {
            if remote { WidgetSync.shared.reload() }
            if let sessionId, isOnScreen(sessionId) { return [] }
            return [.banner, .list, .sound, .badge]
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let url = PushRoute.url(for: response.notification.request.content.userInfo)
        await MainActor.run {
            if let url { open(url) }
        }
    }
}

/// Watches a window's synced chats: keeps the badge, the widgets, and this device's push registration current, and
/// (without push) posts a local notification when a chat's run ends (`busy` true → false) where you aren't looking.
/// The reply's start comes from the open chat's transcript, or is read from the agent.
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
        changed()
    }

    func stop() {
        stopped = true
        endBackgroundTask()
    }

    func setActive(_ active: Bool) {
        appActive = active
        if active { endBackgroundTask() } else if sessions.contains(where: \.busy) { beginBackgroundTask() }
        if !active, let state = client.state { WidgetSync.shared.update(state) }
    }

    /// Follows the synced state without a view (it keeps working while the window is in the background).
    private func watch() {
        guard !stopped else { return }
        withObservationTracking {
            _ = client.state?.sessions
            _ = client.state?.characters
            _ = client.state?.push
            _ = client.isConnected
            _ = PushRegistration.shared.token
            _ = Notifications.shared.authorized
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.changed()
                self.watch()
            }
        }
    }

    private func changed() {
        guard let state = client.state else { return }
        let current = state.sessions
        let finished = ChatAlerts.finished(previous: sessions, current: current)
        // Read now (here, or on another device): its notification has done its job.
        let read = current.filter { session in !session.unread && sessions.contains { $0.id == session.id && $0.unread } }
        sessions = current
        for session in read { Notifications.shared.clear(sessionId: session.id) }
        if client.isConnected { Notifications.shared.setBadge(state.unreadCount) }
        WidgetSync.shared.update(state)
        Task { await PushRegistration.shared.sync(client) }
        // Pushes say it already, even with the app open.
        if !PushRegistration.shared.isActive(client) {
            for session in finished where ChatAlerts.shouldNotify(session, openChat: router.tab == .chats ? router.chat : nil, appActive: appActive) {
                Task { await notify(session) }
            }
        }
        if !appActive, !current.contains(where: \.busy) { endBackgroundTask() }
    }

    private func notify(_ session: SessionMeta) async {
        let character = client.state?.character(session.characterId)
        var reply: (text: String, error: String?)?
        var asked: String?
        if let feed = client.activeChat, feed.sessionId == session.id {
            reply = ChatAlerts.lastReply(feed.transcript)
            if reply == nil, feed.transcript.loaded { return }  // Stopped: nothing to say.
            asked = feed.transcript.displayItems.last { if case .user = $0 { true } else { false } }.flatMap(TranscriptView.text)
        } else if let result = try? await client.call("runUiOperation", .string(session.id), "app_read_session",
                                                      ["session_id": .string(session.id), "last_messages": 2], ["query": true], as: JSONValue.self),
                  result["ok"]?.bool == true {
            reply = (ChatAlerts.lastReply(readSession: result["result"] ?? .null) ?? "", nil)
            asked = (result["result"]?["messages"]?.array ?? []).last { $0["role"]?.string == "user" }?["text"]?.string
        }
        let failed = reply?.error != nil
        let preferences = NotificationPreferences.shared
        if let character {
            // Their own setting: every message, only ones they start (a schedule), or none.
            switch character.notifyLevel {
            case .off: return
            case .reachouts where !failed && asked.flatMap(UserText.scheduledPrompt) == nil: return
            default: break
            }
            guard preferences.allowsLocal(kind: failed ? "error" : "sidekick") else { return }
            let body = failed ? (reply?.error ?? "") : ChatAlerts.summarize(reply?.text ?? "")
            Notifications.shared.post(title: character.name, body: body.isEmpty ? "Sent you a message." : body, sessionId: session.id)
            return
        }
        guard preferences.allowsLocal(kind: failed ? "error" : asked.flatMap(UserText.scheduledPrompt) != nil ? "scheduled" : "reply") else { return }
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
    /// Notifications, the badge, push registration, and the widgets for this window's chats (see ChatNotifier), and
    /// which chat it has on screen.
    func chatNotifications() -> some View { modifier(ChatNotifications()) }
}

private struct ChatNotifications: ViewModifier {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var notifier: ChatNotifier?
    @State private var window = UUID()

    func body(content: Content) -> some View {
        // The chat this window shows, while it's in the foreground and the Chats tab is up.
        let onScreen = scenePhase == .active && router.tab == .chats ? router.chat : nil
        content
            .onAppear { if notifier == nil { notifier = ChatNotifier(client: client, router: router) } }
            .onDisappear {
                notifier?.stop()
                notifier = nil
                Notifications.shared.setOnScreen(nil, window: window)
            }
            .onChange(of: scenePhase) { _, phase in
                notifier?.setActive(phase == .active)
                if phase == .active { Task { await Notifications.shared.refreshAuthorization() } }
            }
            .onChange(of: onScreen, initial: true) { _, chat in Notifications.shared.setOnScreen(chat, window: window) }
            // Presence names the open chat only while it's on screen: behind another tab, a reply stays unread.
            .onChange(of: router.tab, initial: true) { _, tab in client.setChatOnScreen(tab == .chats) }
    }
}
