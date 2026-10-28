import DexCore
import SwiftUI

/// The Settings tab: a list of pages (Account, subscriptions, VMs, GitHub, defaults, secrets, access, notifications,
/// usage, about) beside the open one on iPad, pushed on iPhone. `router.openSettings(_:)` deep-links to a page.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var router = router
        NavigationSplitView {
            List(selection: $router.settingsPage) {
                Section {
                    AccountRow().tag(SettingsPage.account)
                }
                Section {
                    row(.appearance, detail: ThemeStore.shared.theme.name)
                }
                Section("Connections") {
                    row(.models, detail: subscriptionsDetail)
                    row(.machines, detail: client.state.map { $0.boat.connected ? "boat.dev" : "Not connected" })
                    row(.github, detail: client.state.map { $0.github.connected ? "@\($0.github.login ?? "")" : "Not connected" })
                }
                Section("Chats") {
                    row(.defaults, detail: client.state.map { client.catalog.name(of: $0.settings.defaultModel) })
                    row(.secrets, detail: client.state.map { "\($0.secrets.count)" })
                }
                Section("Access") {
                    row(.access, badge: client.state?.access.pending.filter { $0.isWaiting() }.count ?? 0)
                    row(.notifications, detail: NotificationPreferences.shared.enabled ? "On" : "Off")
                    row(.usage)
                }
                Section {
                    row(.about)
                }
                Section {
                    Button("Sign Out", role: .destructive) { confirmSignOut = true }
                        .accessibilityIdentifier("settings.signOut")
                }
            }
            .tint(.selectionAccent)
            .navigationTitle("Settings")
            .confirmationDialog("Sign out of Dex on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { model.signOut() }
            } message: {
                Text("Chats keep running on your Dex. Sign in again any time.")
            }
            .accessibilityIdentifier("settings.list")
            .listColumn()
        } detail: {
            NavigationStack {
                if let page = router.settingsPage {
                    SettingsPageView(page: page)
                        .id(page)
                } else {
                    EmptyStateView(title: "Settings", symbol: "gearshape", message: "Choose a page.")
                }
            }
        }
        .task { await NotificationPreferences.shared.refresh() }
        // Side by side, the page column always shows a page: Account until you pick another.
        .onChange(of: sizeClass, initial: true) { _, size in
            if size == .regular, router.settingsPage == nil { router.settingsPage = .account }
        }
    }

    private var subscriptionsDetail: String? {
        guard let state = client.state else { return nil }
        let names = [state.cline.connected ? "ClinePass" : nil, state.opencode.connected ? "OpenCode Go" : nil, state.chatgpt.connected ? "ChatGPT" : nil].compactMap { $0 }
        return names.isEmpty ? "None" : names.joined(separator: ", ")
    }

    private func row(_ page: SettingsPage, detail: String? = nil, badge: Int = 0) -> some View {
        HStack {
            Label(page.title, systemImage: page.symbol)
            Spacer(minLength: 8)
            if let detail {
                Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .badge(badge)
        .tag(page)
        .accessibilityIdentifier("settings.page.\(page.rawValue)")
    }
}

/// The signed-in person at the top of Settings, like the Apple Account row.
private struct AccountRow: View {
    @Environment(DexClient.self) private var client

    var body: some View {
        HStack(spacing: 14) {
            UserAvatar(viewer: client.viewer, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(client.viewer?.name ?? "Account").font(.title3.weight(.semibold))
                Text("@\(client.viewer?.login ?? "") · \(client.server?.host() ?? "")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("settings.page.account")
    }
}

/// One Settings page.
struct SettingsPageView: View {
    let page: SettingsPage

    var body: some View {
        switch page {
        case .account: AccountPage()
        case .appearance: AppearancePage()
        case .models: ModelSubscriptionsPage()
        case .machines: CloudVMsPage()
        case .github: GitHubPage()
        case .defaults: DefaultsPage()
        case .secrets: SecretsPage()
        case .access: AccessPage()
        case .notifications: NotificationsPage()
        case .usage: UsagePage()
        case .about: AboutPage()
        }
    }
}
