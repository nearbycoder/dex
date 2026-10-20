import DexCore
import SwiftUI

/// The Machines tab: every chat's VM, and the open one's live desktop and activity.
struct MachinesView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationSplitView {
            List(client.state?.vms ?? [], selection: $router.machine) { vm in
                Text(client.state?.session(vm.key)?.title ?? vm.key).tag(vm.key)
            }
            .navigationTitle("Machines")
        } detail: {
            if let key = router.machine {
                Text(key).navigationTitle("Machine")
            } else {
                EmptyStateView(title: "No machine selected", symbol: "desktopcomputer")
            }
        }
    }
}

/// The floating button over a chat whose VM runs; opens a picture-in-picture view of its desktop.
struct VmPreviewOverlay: View {
    let vm: VmInfo
    var body: some View { EmptyView() }
}
