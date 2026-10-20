import DexCore
import Foundation
import Observation
import UserNotifications

/// This device's notification choices, kept on the device (Settings → Notifications): on or off, which kinds
/// (NOTIFY_KINDS), and whether to skip the chat you're looking at. The app posts local notifications while it runs;
/// whoever posts one asks `allows(kind:)` first.
///
///     if NotificationPreferences.shared.allows(kind: "reply", sessionId: id, visibleChat: router.chat) { … }
@MainActor
@Observable
final class NotificationPreferences {
    static let shared = NotificationPreferences()

    /// What iOS allows (asked for when you turn notifications on).
    var authorization: UNAuthorizationStatus = .notDetermined

    private let defaults: UserDefaults
    private static let enabledKey = "dex.notify.enabled"
    private static let kindsKey = "dex.notify.kinds"
    private static let awayKey = "dex.notify.onlyWhenAway"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        choice = defaults.object(forKey: Self.enabledKey) as? Bool
        kinds = Set(defaults.stringArray(forKey: Self.kindsKey) ?? NotifyKinds.defaults)
        onlyWhenAway = defaults.object(forKey: Self.awayKey) as? Bool ?? true
    }

    /// Your choice, if you made one; until then notifications follow iOS's permission.
    private var choice: Bool? {
        didSet { defaults.set(choice, forKey: Self.enabledKey) }
    }

    /// Notifications are on for this device: you turned them on (or never chose and iOS allows them).
    var enabled: Bool {
        (choice ?? true) && isAuthorized
    }

    var isAuthorized: Bool { [.authorized, .provisional, .ephemeral].contains(authorization) }
    var isDenied: Bool { authorization == .denied }

    var kinds: Set<String> {
        didSet { defaults.set(NotifyKinds.all.map(\.id).filter(kinds.contains), forKey: Self.kindsKey) }
    }

    /// Skip notifications about the chat open on screen.
    var onlyWhenAway: Bool {
        didSet { defaults.set(onlyWhenAway, forKey: Self.awayKey) }
    }

    /// Whether to post a notification of `kind` ("reply", "error", "scheduled", "machine", "mcp", "snooze").
    func allows(kind: String) -> Bool {
        enabled && kinds.contains(kind)
    }

    /// Whether to post one about `sessionId`, given the chat on screen (nil when none is, or the app is in the background).
    func allows(kind: String, sessionId: String?, visibleChat: String?) -> Bool {
        guard allows(kind: kind) else { return false }
        if onlyWhenAway, let sessionId, sessionId == visibleChat { return false }
        return true
    }

    func setKind(_ kind: String, on: Bool) {
        if on { kinds.insert(kind) } else { kinds.remove(kind) }
    }

    /// Turns notifications on (asking iOS first) or off. Returns whether they're on.
    @discardableResult
    func setEnabled(_ on: Bool) async -> Bool {
        if on {
            if authorization == .notDetermined { _ = await Notifications.shared.requestPermission() }
            await refresh()
            choice = true
        } else {
            choice = false
        }
        return enabled
    }

    /// Reads iOS's current permission (it can change in the Settings app while Dex is in the background).
    func refresh() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Posts a sample notification now.
    func sendTest() {
        let content = UNMutableNotificationContent()
        content.title = "Dex"
        content.body = "Notifications are working on this device."
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "dex-test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
    }
}
