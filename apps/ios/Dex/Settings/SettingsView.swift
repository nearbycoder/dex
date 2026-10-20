import DexCore
import SwiftUI

/// The Settings tab.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationSplitView {
            List(selection: $router.settingsPage) {
                ForEach(SettingsPage.allCases) { page in
                    Label(page.title, systemImage: page.symbol).tag(page)
                }
                Section {
                    Button("Sign Out", role: .destructive) { model.signOut() }
                        .accessibilityIdentifier("settings.signOut")
                }
            }
            .navigationTitle("Settings")
        } detail: {
            if let page = router.settingsPage {
                Text(page.title).navigationTitle(page.title)
            } else {
                EmptyStateView(title: "Settings", symbol: "gearshape")
            }
        }
    }
}
