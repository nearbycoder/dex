import DexCore
import Foundation
import Observation
import UIKit
import UserNotifications
import WidgetKit

/// Push to this device through APNs: its token, its registration with each Dex (`registerNativePush`, again on every
/// launch: the agent upserts), and whether it's in use. While it is, the app posts no local notifications of its own, so
/// nothing arrives twice; a Dex without APNs keys (or an older agent) gets the local ones as before. Mock mode makes up
/// a token and registers it with the mock agent only.
@MainActor
@Observable
final class PushRegistration {
    static let shared = PushRegistration()

    /// The APNs token, in hex.
    private(set) var token: String?
    /// Why iOS or the agent refused the last registration, if it did.
    private(set) var problem: String?
    private(set) var registering = false

    @ObservationIgnored private let defaults: UserDefaults
    /// Dexes (server and user) registered with the current token since launch.
    @ObservationIgnored private var registered: Set<String> = []
    @ObservationIgnored private var attempts: [String: Date] = [:]
    @ObservationIgnored private var asked = false
    /// You turned notifications off for this device (Settings → Notifications).
    private(set) var wanted: Bool

    static let wantedKey = "dex.push.wanted"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if LaunchOptions.current.resetState {
            for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("dex.push.") { defaults.removeObject(forKey: key) }
        }
        wanted = defaults.object(forKey: Self.wantedKey) as? Bool ?? true
    }

    /// "sandbox" for builds from Xcode (their aps-environment is development), "production" for TestFlight and the App
    /// Store. Read from the Info.plist, which takes it from the same build setting as the entitlement.
    static var environment: String {
        (Bundle.main.object(forInfoDictionaryKey: "DexApsEnvironment") as? String) == "production" && !LaunchOptions.current.mock ? "production" : "sandbox"
    }

    private static func key(_ client: DexClient) -> String { "\(client.server?.absoluteString ?? "")|\(client.viewer?.id ?? "")" }

    /// This device's id on a window's Dex, once registered.
    func deviceId(_ client: DexClient) -> String? { defaults.string(forKey: "dex.push.device.\(Self.key(client))") }

    /// The agent's record of this device.
    func device(_ client: DexClient) -> PushDevice? {
        guard let id = deviceId(client) else { return nil }
        return client.state?.push.devices.first { $0.id == id }
    }

    /// Push reaches this device from this Dex: it's registered and the agent still has it.
    func isActive(_ client: DexClient) -> Bool {
        client.state?.push.native.ios == true && device(client) != nil
    }

    // MARK: The token

    /// Asks iOS for the token (it's quick once permission is given; iOS remembers it).
    func requestToken() {
        guard token == nil, !asked else { return }
        asked = true
        if LaunchOptions.current.mock {
            didRegister(Data((0..<32).map { _ in UInt8(0xAB) }))
        } else {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func didRegister(_ data: Data) {
        let hex = PushToken.hex(data)
        if hex != token { registered = [] }
        token = hex
        problem = nil
    }

    func didFail(_ error: Error) {
        asked = false
        problem = error.localizedDescription
    }

    // MARK: Registering with Dex

    /// Keeps this device registered with a window's Dex (called as its state changes): once per launch, and again if
    /// the agent forgot it (a token APNs said was gone), at most once a minute.
    func sync(_ client: DexClient) async {
        guard wanted, Notifications.shared.authorized, client.isConnected, client.state?.push.native.ios == true else { return }
        guard let token else { return requestToken() }
        let key = Self.key(client)
        if registered.contains(key), device(client) != nil { return }
        if let last = attempts[key], Date.now.timeIntervalSince(last) < 60 { return }
        attempts[key] = .now
        registering = true
        defer { registering = false }
        do {
            let id = try await client.registerNativePush(token: token, environment: Self.environment,
                                                         label: PushToken.label(name: client.viewer?.name, model: UIDevice.current.model))
            defaults.set(id, forKey: "dex.push.device.\(key)")
            registered.insert(key)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Turns this device's notifications on (asking iOS first) or off (the agent forgets it).
    func setWanted(_ on: Bool, client: DexClient) async {
        wanted = on
        defaults.set(on, forKey: Self.wantedKey)
        if on {
            if !Notifications.shared.authorized { _ = await Notifications.shared.requestPermission() }
            attempts[Self.key(client)] = nil
            await sync(client)
        } else {
            await unregister(client)
        }
    }

    /// Stops pushes to this device from a window's Dex (signing out, or turning them off).
    func unregister(_ client: DexClient) async {
        let key = Self.key(client)
        registered.remove(key)
        guard let id = deviceId(client) else { return }
        defaults.removeObject(forKey: "dex.push.device.\(key)")
        _ = try? await client.run("pushUnsubscribe", .string(id), timeout: 5)
    }
}

/// Where tapping a notification goes: its `url` (a path in Dex: /chat/<id>, /machine/<key>, /notifications), else its
/// chat. Remote ones carry both; the app's local ones only the chat. Nonisolated: the notification center's delegate
/// calls it off the main actor.
nonisolated enum PushRoute {
    static func url(for userInfo: [AnyHashable: Any]) -> URL? {
        if let path = userInfo["url"] as? String, let url = link(path) { return url }
        if let id = userInfo["sessionId"] as? String, !id.isEmpty { return DexLink.chat(id) }
        return nil
    }

    /// A path in the web app as the app's own link.
    static func link(_ path: String) -> URL? {
        let parts = (URL(string: path)?.path() ?? path).split(separator: "/").map(String.init)
        switch parts.first {
        case "chat" where parts.count > 1: return DexLink.chat(parts[1])
        case "machine" where parts.count > 1: return URL(string: "dex://machine/\(parts[1])")
        case "notifications": return DexLink.notificationSettings
        case "settings" where parts.count > 1 && parts[1] == "notifications": return DexLink.notificationSettings
        default: return nil
        }
    }

    /// The chat a notification is about, if any.
    static func sessionId(_ userInfo: [AnyHashable: Any]) -> String? {
        (userInfo["sessionId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
}

/// Keeps the widgets' copy of your sidekicks (the App Group) current while the app runs, and has WidgetKit redraw them:
/// when sidekicks or chats change (a moment after they settle), when a push arrives, and when the theme changes.
@MainActor
final class WidgetSync {
    static let shared = WidgetSync()

    private var pending: Task<Void, Never>?
    private var last: SidekickSnapshot?
    /// The mock agent's sidekicks stay out of the real widgets.
    private var enabled: Bool { !LaunchOptions.current.mock }

    func update(_ state: DexState) {
        guard enabled, !SidekickSnapshot(state: state).sameContent(as: last) else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled else { return }
            let snapshot = SidekickSnapshot(state: state)
            guard !snapshot.sameContent(as: self.last) else { return }
            self.last = snapshot
            WidgetStore.shared?.save(snapshot, pictures: true)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Something changed that the widgets fetch for themselves (a push arrived).
    func reload() {
        guard enabled else { return }
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// The session the widgets fetch with: a copy of the app's, in the Keychain's App Group access group.
    func share(_ credentials: Credentials) {
        guard enabled else { return }
        AppGroup.credentials.save(credentials)
    }

    func savePalette(light: UInt32, dark: UInt32) {
        guard enabled else { return }
        let palette = WidgetPalette(light: light, dark: dark)
        guard palette != WidgetPalette.load() else { return }
        palette.save()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Signed out: the widgets forget the session and what they kept.
    func signedOut() {
        guard enabled else { return }
        AppGroup.credentials.clear()
        WidgetStore.shared?.clear()
        last = nil
        WidgetCenter.shared.reloadAllTimelines()
    }
}
