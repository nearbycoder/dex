import DexCore
import SwiftUI

/// Compact width's Library tab: Agents, Projects, Skills, and MCP servers.
struct LibraryView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.libraryPath) {
            List {
                ForEach(AppTab.libraryPages, id: \.self) { page in
                    NavigationLink(value: LibraryRoute.page(page)) {
                        Label(page.title, systemImage: page.symbol)
                    }
                    .accessibilityIdentifier("library.\(page.rawValue)")
                }
            }
            .navigationTitle("Library")
            .navigationDestination(for: LibraryRoute.self) { route in
                LibraryDestination(route: route)
            }
        }
    }
}

/// A Library page in the sidebar (regular width), with its own stack.
struct LibraryPageStack: View {
    @Environment(Router.self) private var router
    let page: AppTab

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: binding) {
            LibraryDestination(route: .page(page))
                .navigationDestination(for: LibraryRoute.self) { route in
                    LibraryDestination(route: route)
                }
        }
    }

    private var binding: Binding<[LibraryRoute]> {
        switch page {
        case .agents: Binding(get: { router.agentsPath }, set: { router.agentsPath = $0 })
        case .projects: Binding(get: { router.projectsPath }, set: { router.projectsPath = $0 })
        case .skills: Binding(get: { router.skillsPath }, set: { router.skillsPath = $0 })
        default: Binding(get: { router.mcpPath }, set: { router.mcpPath = $0 })
        }
    }
}

/// What each Library route shows.
struct LibraryDestination: View {
    let route: LibraryRoute

    var body: some View {
        switch route {
        case .page(let page):
            Text(page.title).navigationTitle(page.title)
        default:
            Text(String(describing: route))
        }
    }
}
