import DexCore
import SwiftUI

/// Compact width's Library tab: Agents, Projects, Skills, and MCP servers, each pushing its list and items.
struct LibraryView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.libraryPath) {
            List {
                Section {
                    ForEach(AppTab.libraryPages, id: \.self) { page in
                        NavigationLink(value: LibraryRoute.page(page)) {
                            HStack(spacing: 14) {
                                Image(systemName: page.symbol)
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 34, height: 34)
                                    .background(Self.tint(page).gradient, in: .rect(cornerRadius: 9, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(page.title)
                                    Text(Self.blurb(page)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer(minLength: 0)
                                if let count = count(page) {
                                    Text("\(count)").foregroundStyle(.secondary).monospacedDigit()
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .accessibilityIdentifier("library.\(page.rawValue)")
                    }
                }
            }
            .navigationTitle("Library")
            .navigationDestination(for: LibraryRoute.self) { route in
                LibraryDestination(route: route)
            }
        }
    }

    private func count(_ page: AppTab) -> Int? {
        guard let state = client.state else { return nil }
        return switch page {
        case .agents: state.agents.count
        case .projects: state.projects.count
        case .skills: state.skills.count
        case .mcp: state.mcp.count
        default: nil
        }
    }

    static func tint(_ page: AppTab) -> Color {
        switch page {
        case .agents: .purple
        case .projects: .blue
        case .skills: .orange
        default: .teal
        }
    }

    static func blurb(_ page: AppTab) -> String {
        switch page {
        case .agents: "Presets for a job: instructions, a model, tools"
        case .projects: "Repos and a setup script, ready on a VM"
        case .skills: "Instructions for particular tasks"
        default: "Remote tools for Dex"
        }
    }
}

/// A Library page in the sidebar (regular width): its list beside the open item. The page's path holds the open
/// item first, then anything opened from it.
struct LibraryPageStack: View {
    @Environment(Router.self) private var router
    let page: AppTab
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            LibraryPageList(page: page, selection: selection)
                .listColumn()
        } detail: {
            NavigationStack(path: inner) {
                Group {
                    if let open = path.wrappedValue.first {
                        LibraryDestination(route: open).id(open)
                    } else {
                        LibraryPlaceholder(page: page)
                    }
                }
                .navigationDestination(for: LibraryRoute.self) { route in
                    LibraryDestination(route: route)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var path: Binding<[LibraryRoute]> {
        switch page {
        case .agents: Binding(get: { router.agentsPath }, set: { router.agentsPath = $0 })
        case .projects: Binding(get: { router.projectsPath }, set: { router.projectsPath = $0 })
        case .skills: Binding(get: { router.skillsPath }, set: { router.skillsPath = $0 })
        default: Binding(get: { router.mcpPath }, set: { router.mcpPath = $0 })
        }
    }

    /// The list's selection: the open item.
    private var selection: Binding<LibraryRoute?> {
        let path = path
        return Binding(get: { path.wrappedValue.first }, set: { path.wrappedValue = $0.map { [$0] } ?? [] })
    }

    /// What's pushed in the detail column after the open item.
    private var inner: Binding<[LibraryRoute]> {
        let path = path
        return Binding(get: { Array(path.wrappedValue.dropFirst()) }, set: { tail in
            path.wrappedValue = path.wrappedValue.first.map { [$0] + tail } ?? tail
        })
    }
}

/// A page's list. `selection` is set in the sidebar layout (the list drives the detail column); nil when the list
/// pushes items in a stack.
struct LibraryPageList: View {
    let page: AppTab
    var selection: Binding<LibraryRoute?>? = nil

    var body: some View {
        switch page {
        case .agents: AgentsList(selection: selection)
        case .projects: ProjectsList(selection: selection)
        case .skills: SkillsList(selection: selection)
        default: McpList(selection: selection)
        }
    }
}

/// The detail column with nothing open.
struct LibraryPlaceholder: View {
    let page: AppTab

    var body: some View {
        switch page {
        case .agents: ContentUnavailableView("No Agent Selected", systemImage: page.symbol, description: Text("Pick an agent to edit it, or press ⌘N for a new one."))
        case .projects: ContentUnavailableView("No Project Selected", systemImage: page.symbol, description: Text("Pick a project to edit it, or press ⌘N for a new one."))
        case .skills: ContentUnavailableView("No Skill Selected", systemImage: page.symbol, description: Text("Pick a skill to read it, or search skills.sh for more."))
        default: ContentUnavailableView("No Server Selected", systemImage: page.symbol, description: Text("Pick a server to see its tools, or find one to add."))
        }
    }
}

/// What each Library route shows.
struct LibraryDestination: View {
    let route: LibraryRoute

    var body: some View {
        switch route {
        case .page(let page): LibraryPageList(page: page)
        case .agent(let id): AgentEditor(agentId: id).id(id)
        case .newAgent: AgentEditor(agentId: nil)
        case .project(let id): ProjectEditor(projectId: id).id(id)
        case .newProject: ProjectEditor(projectId: nil)
        case .skill(let id): SkillDetailView(skillId: id).id(id)
        case .newSkill: NewSkillPage()
        case .skillSearch: SkillSearchView()
        case .mcpServer(let id): McpServerDetail(serverId: id).id(id)
        case .newMcpServer: NewMcpServerPage()
        case .mcpSearch: McpSearchView()
        }
    }
}
