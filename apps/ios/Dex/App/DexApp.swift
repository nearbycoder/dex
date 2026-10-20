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
                .tint(.accentColor)
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
}

/// The window's content: sign-in, or the app for the signed-in user.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

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
        .task { await model.refreshIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refreshIfNeeded() } }
        }
    }
}

/// One window's connection and navigation.
struct SignedInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var client: DexClient?
    @State private var router = Router()

    var body: some View {
        Group {
            if let client {
                MainView()
                    .environment(client)
                    .environment(router)
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
        }
        .onDisappear { client?.stop() }
        .onChange(of: scenePhase) { _, phase in client?.setVisible(phase == .active) }
        .onOpenURL { url in _ = router.handle(url) }
        .onReceive(NotificationCenter.default.publisher(for: Notifications.openChat)) { note in
            if let id = note.object as? String { router.openChat(id) }
        }
    }
}
