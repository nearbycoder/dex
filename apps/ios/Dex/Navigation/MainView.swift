import DexCore
import SwiftUI

/// The signed-in app: a Liquid Glass tab bar on iPhone that becomes a sidebar on iPad and an unfolded foldable.
struct MainView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    /// The tab bar's five tabs, or the sidebar with each Library page. A phone in landscape is short (compact height)
    /// and keeps its five tabs even where it's wide enough for regular width (Pro Max, Air): swapping the set of tabs
    /// on every rotation moves you around and makes UIKit rebuild the bar mid-rotation. Only a screen that's both wide
    /// and tall (iPad, an unfolded foldable, a big iPad window) gets the sidebar.
    private var compact: Bool { sizeClass == .compact || verticalSizeClass == .compact }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab(AppTab.chats.title, systemImage: AppTab.chats.symbol, value: AppTab.chats) {
                ChatsView().tint(.dexAccent)
            }
            .badge(inboxBadge)
            .accessibilityIdentifier("tab.chats")

            Tab(AppTab.machines.title, systemImage: AppTab.machines.symbol, value: AppTab.machines) {
                MachinesView().tint(.dexAccent)
            }
            .accessibilityIdentifier("tab.machines")

            Tab(AppTab.files.title, systemImage: AppTab.files.symbol, value: AppTab.files) {
                FilesView().tint(.dexAccent)
            }
            .accessibilityIdentifier("tab.files")

            if compact {
                // Compact width: one Library tab with its pages inside.
                Tab(AppTab.library.title, systemImage: AppTab.library.symbol, value: AppTab.library) {
                    LibraryView().tint(.dexAccent)
                }
                .accessibilityIdentifier("tab.library")
            } else {
                // Regular width: each Library page in the sidebar.
                TabSection("Library") {
                    ForEach(AppTab.libraryPages, id: \.self) { page in
                        Tab(page.title, systemImage: page.symbol, value: page) {
                            LibraryPageStack(page: page).tint(.dexAccent)
                        }
                        .accessibilityIdentifier("tab.\(page.rawValue)")
                    }
                }
            }

            Tab(AppTab.settings.title, systemImage: AppTab.settings.symbol, value: AppTab.settings) {
                SettingsView().tint(.dexAccent)
            }
            .accessibilityIdentifier("tab.settings")

            // iPhone has room for five tabs; the chat list has its own search there.
            if !compact {
                Tab(value: AppTab.search, role: .search) {
                    SearchView().tint(.dexAccent)
                }
                .accessibilityIdentifier("tab.search")
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        // The sidebar's selected row, readable in dark mode; each tab's content keeps the accent.
        .tint(compact ? .dexAccent : .selectionAccent)
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: compact, initial: true) { _, compact in router.adapt(compact: compact) }
        .background(TabBarRelayout(trigger: router.tab))
        .overlay(alignment: .top) { NoticeBanner() }
        .overlay { ConnectionOverlay() }
    }

    /// Chats with something new: busy ones, in the inbox.
    private var inboxBadge: Int {
        client.state?.sessions.filter { $0.busy }.count ?? 0
    }
}

/// Works around a layout gap in the sidebar-adaptable tab view on iPad: a page picked from the overlay sidebar
/// (portrait) keeps the insets it had while the sidebar covered the tab bar, so its own bars end up under the floating
/// tab bar until the next rotation. Once the sidebar has closed, this has the tab bar controller lay the page out
/// again by hiding and showing its tab bar in one pass (nothing moves on screen).
struct TabBarRelayout: UIViewRepresentable {
    let trigger: AppTab

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard context.coordinator.last != trigger else { return }
        context.coordinator.last = trigger
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak view] in
            guard let view, view.traitCollection.horizontalSizeClass == .regular,
                  let controller = Self.tabBarController(from: view.window?.rootViewController), !controller.isTabBarHidden else { return }
            UIView.performWithoutAnimation {
                controller.setTabBarHidden(true, animated: false)
                controller.setTabBarHidden(false, animated: false)
                controller.view.layoutIfNeeded()
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var last: AppTab?
    }

    private static func tabBarController(from controller: UIViewController?) -> UITabBarController? {
        guard let controller else { return nil }
        if let tabs = controller as? UITabBarController { return tabs }
        for child in controller.children {
            if let found = tabBarController(from: child) { return found }
        }
        return tabBarController(from: controller.presentedViewController)
    }
}

/// A short message no screen claimed (a failed action), shown at the top for a few seconds.
struct NoticeBanner: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        if let notice = client.notice {
            Label(notice, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular.tint(.red.opacity(0.25)), in: .capsule)
                .padding(.top, 8)
                .padding(.horizontal)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { client.notice = nil }
                .task(id: notice) {
                    try? await Task.sleep(for: .seconds(4))
                    client.notice = nil
                }
                .accessibilityIdentifier("notice")
        }
    }
}

/// Says when the app is offline or reconnecting, without blocking anything (the last state stays usable).
struct ConnectionOverlay: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        VStack {
            Spacer()
            switch client.connection.status {
            case .waiting:
                Label("Reconnecting…", systemImage: "wifi.exclamationmark")
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 96)
                    .transition(.opacity)
                    .accessibilityIdentifier("reconnecting")
            default:
                EmptyView()
            }
        }
        .allowsHitTesting(false)
        .animation(.smooth, value: client.connection.status)
    }
}
