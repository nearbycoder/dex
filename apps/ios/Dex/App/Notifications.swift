import DexCore
import UserNotifications
import UIKit

/// Local notifications: when a reply finishes or fails in a chat you're not looking at, while the app is running.
/// Web Push (VAPID) can't reach a native app, and the server has no APNs sender yet, so a closed app isn't notified.
@MainActor
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    /// Posted with a chat id when a notification is tapped.
    static let openChat = Notification.Name("dex.openChat")

    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func post(title: String, body: String, sessionId: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = sessionId
        content.userInfo = ["sessionId": sessionId]
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
