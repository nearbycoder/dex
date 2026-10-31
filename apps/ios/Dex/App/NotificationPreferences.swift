import DexCore
import Foundation
import Observation
import UserNotifications

/// This device's choices for the local notifications the app posts while it runs, when its Dex can't push to it
/// (Settings → Notifications): on or off, which kinds (NOTIFY_KINDS), and whether to skip the chat you're looking at.
/// With push, the agent keeps the same choices for the device instead (`pushUpdate`). Whoever posts one asks first.
///
///     if NotificationPreferences.shared.allowsLocal(kind: "reply") { … }
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
        var saved = Set(defaults.stringArray(forKey: Self.kindsKey) ?? NotifyKinds.defaults)
        // Sidekicks' messages became a kind of their own: kinds chosen before then, with replies, want them too (as the
        // agent does for its devices).
        if defaults.object(forKey: Self.sidekickKindKey) == nil {
            if saved.contains("reply") { saved.insert("sidekick") }
            defaults.set(true, forKey: Self.sidekickKindKey)
        }
        kinds = saved
        onlyWhenAway = defaults.object(forKey: Self.awayKey) as? Bool ?? true
    }

    private static let sidekickKindKey = "dex.notify.hasSidekickKind"

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

    /// Whether a local notification of `kind` may be posted (iOS has the last word on whether it shows): you haven't
    /// turned them off here, and want the kind.
    func allowsLocal(kind: String) -> Bool {
        (choice ?? true) && kinds.contains(kind)
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
