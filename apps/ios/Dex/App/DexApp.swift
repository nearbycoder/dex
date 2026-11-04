import DexCore
import SwiftUI

@main
struct DexApp: App {
    @State private var model = AppModel()
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .commands { DexCommands() }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.install()
        if LaunchOptions.current.isUITest { UIView.setAnimationsEnabled(true) }
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // A Home Screen quick action that launched the app: the window opens its link once it's up.
        if let item = options.shortcutItem { QuickActions.perform(item) }
        let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistration.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistration.shared.didFail(error)
    }
}

/// Hears Home Screen quick actions while the app is running.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
        QuickActions.perform(shortcutItem)
    }
}

/// Home Screen quick actions (a long press on the app icon), from Info.plist's UIApplicationShortcutItems: each carries
/// the dex:// link it opens in its `url`, which goes the way a tapped notification's does.
enum QuickActions {
    @discardableResult
    static func perform(_ item: UIApplicationShortcutItem) -> Bool {
        guard let link = item.userInfo?["url"] as? String, let url = URL(string: link) else { return false }
        Notifications.shared.open(url)
        return true
    }
}

/// The window's content: sign-in, or the app for the signed-in user.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    private var theme: ThemeStore { .shared }

    var body: some View {
        Group {
            switch model.phase {
            case .signedOut:
                SignInView()
                    .transition(.opacity)
            case .signedIn(let credentials):
                SignedInView()
                    .id(credentials.user.id + credentials.server.absoluteString)
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: model.phase)
        // The theme's accent and appearance, in every window; they change live from Settings → Appearance.
        .tint(theme.theme.accent)
        .preferredColorScheme(theme.appearance.colorScheme)
        // After the window exists: UIKit's own views (alerts, Safari) take the accent too.
        .onAppear { DispatchQueue.main.async { theme.applyToWindows() } }
        .task { await model.refreshIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refreshIfNeeded() } }
            if phase == .background { Drafts.shared.save() }
        }
    }
}

/// One window's connection and navigation.
struct SignedInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var client: DexClient?
    @State private var router = Router()
    @State private var usage = UsageGlanceStore()

    var body: some View {
        Group {
            if let client {
                MainView()
                    .chatNotifications()
                    .environment(client)
                    .environment(router)
                    .environment(usage)
                    .focusedSceneValue(router)
                    .focusedSceneValue(client)
            } else {
                ShellSkeleton()
            }
        }
        .onAppear {
            guard client == nil, let made = model.makeClient() else { return }
            client = made
            made.start()
            if let chat = model.launch.openChat { router.openChat(chat) }
            // A notification tapped, or a Home Screen quick action, to launch the app.
            if let url = Notifications.shared.takePending() { _ = router.handle(url) }
        }
        .onDisappear { client?.stop() }
        .onChange(of: scenePhase) { _, phase in client?.setVisible(phase == .active) }
        // dex:// links: widgets, notifications, other apps.
        .onOpenURL { url in _ = router.handle(url) }
        // A chat opened in a window of its own (Open in New Window, or a chat dragged out of the list).
        .onContinueUserActivity(Router.chatActivity) { activity in
            if let chat = activity.userInfo?["chat"] as? String { router.openChat(chat) }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notifications.openURL)) { _ in
            // The first window to take it opens it.
            if let url = Notifications.shared.takePending() { _ = router.handle(url) }
        }
    }
}
