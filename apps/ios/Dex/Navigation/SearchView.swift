import DexCore
import SwiftUI

/// The Search tab: find a chat by title, or a skill, agent, or project. The field sits under the title, the results
/// keep a readable width on a wide iPad, and opening one (or leaving the tab) ends the search, so the keyboard and the
/// search's hidden tab bar don't follow you to the next page.
struct SearchView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""
    @State private var searching = false
    @State private var width: CGFloat = 0

    var body: some View {
        NavigationStack {
            let state = client.state
            let chats = (state?.sessions ?? []).filter { matches($0.title) }
            let agents = (state?.agents ?? []).filter { matches($0.name) || matches($0.description) }
            let projects = (state?.projects ?? []).filter { matches($0.name) || matches($0.description) }
            let skills = (state?.skills ?? []).filter { matches($0.id) || matches($0.description) }
            List {
                if query.isEmpty {
                    ContentUnavailableView("Search Dex", systemImage: "magnifyingglass", description: Text("Find chats, agents, projects, and skills."))
                        .listRowBackground(Color.clear)
                } else if chats.isEmpty, agents.isEmpty, projects.isEmpty, skills.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
                if !query.isEmpty, !chats.isEmpty {
                    Section("Chats") {
                        ForEach(chats.prefix(20)) { session in
                            Button { open { router.openChat(session.id) } } label: {
                                VStack(alignment: .leading) {
                                    Text(session.title).foregroundStyle(.primary)
                                    Text(Format.ago(session.updatedAt)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityIdentifier("search.chat.\(session.id)")
                        }
                    }
                }
                if !query.isEmpty, !agents.isEmpty {
                    Section("Agents") {
                        ForEach(agents) { agent in
                            Button { open { router.open(.agent(agent.id), compact: sizeClass == .compact) } } label: {
                                Label { Text(agent.name).foregroundStyle(.primary) } icon: { AgentAvatar(icon: agent.icon, color: agent.color, size: 26) }
                            }
                        }
                    }
                }
                if !query.isEmpty, !projects.isEmpty {
                    Section("Projects") {
                        ForEach(projects) { project in
                            Button { open { router.open(.project(project.id), compact: sizeClass == .compact) } } label: {
                                Label { Text(project.name).foregroundStyle(.primary) } icon: { AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 26) }
                            }
                        }
                    }
                }
                if !query.isEmpty, !skills.isEmpty {
                    Section("Skills") {
                        ForEach(skills) { skill in
                            Button { open { router.open(.skill(skill.id), compact: sizeClass == .compact) } } label: {
                                Label("/\(skill.id)", systemImage: "wand.and.sparkles").foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
            // Results read like text, not links.
            .tint(.primary)
            .contentMargins(.horizontal, max(0, (width - 720) / 2), for: .scrollContent)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .navigationTitle("Search")
            .searchable(text: $query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always), prompt: "Chats, agents, projects, skills")
            // Searching keeps the title and the tab bar, so the other tabs stay a tap away.
            .searchPresentationToolbarBehavior(.avoidHidingContent)
        }
        .onChange(of: router.tab) { _, tab in
            if tab != .search { searching = false }
        }
    }

    /// Ends the search, then opens a result.
    private func open(_ action: () -> Void) {
        searching = false
        action()
    }

    private func matches(_ text: String) -> Bool { !query.isEmpty && text.localizedCaseInsensitiveContains(query) }
}
