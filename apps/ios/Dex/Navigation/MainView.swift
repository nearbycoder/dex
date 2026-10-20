import DexCore
import SwiftUI

/// The signed-in app: a Liquid Glass tab bar on iPhone that becomes a sidebar on iPad and an unfolded foldable.
struct MainView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var compact: Bool { sizeClass == .compact }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab(AppTab.chats.title, systemImage: AppTab.chats.symbol, value: AppTab.chats) {
                ChatsView()
            }
            .badge(inboxBadge)
            .accessibilityIdentifier("tab.chats")

            Tab(AppTab.machines.title, systemImage: AppTab.machines.symbol, value: AppTab.machines) {
                MachinesView()
            }
            .accessibilityIdentifier("tab.machines")

            Tab(AppTab.files.title, systemImage: AppTab.files.symbol, value: AppTab.files) {
                FilesView()
            }
            .accessibilityIdentifier("tab.files")

            if compact {
                // Compact width: one Library tab with its pages inside.
                Tab(AppTab.library.title, systemImage: AppTab.library.symbol, value: AppTab.library) {
                    LibraryView()
                }
                .accessibilityIdentifier("tab.library")
            } else {
                // Regular width: each Library page in the sidebar.
                TabSection("Library") {
                    ForEach(AppTab.libraryPages, id: \.self) { page in
                        Tab(page.title, systemImage: page.symbol, value: page) {
                            LibraryPageStack(page: page)
                        }
                        .accessibilityIdentifier("tab.\(page.rawValue)")
                    }
                }
            }

            Tab(AppTab.settings.title, systemImage: AppTab.settings.symbol, value: AppTab.settings) {
                SettingsView()
            }
            .accessibilityIdentifier("tab.settings")

            // iPhone has room for five tabs; the chat list has its own search there.
            if !compact {
                Tab(value: AppTab.search, role: .search) {
                    SearchView()
                }
                .accessibilityIdentifier("tab.search")
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: compact, initial: true) { _, compact in router.adapt(compact: compact) }
        .overlay(alignment: .top) { NoticeBanner() }
        .overlay { ConnectionOverlay() }
    }

    /// Chats with something new: busy ones, in the inbox.
    private var inboxBadge: Int {
        client.state?.sessions.filter { $0.busy }.count ?? 0
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
