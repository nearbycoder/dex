import DexCore
import SwiftUI

/// The Search tab: find a chat by title, or a skill, agent, or project.
struct SearchView: View {
    @Environment(DexClient.self) private var client
    @Environment(Router.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""

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
                            Button { router.openChat(session.id) } label: {
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
                            Button { router.open(.agent(agent.id), compact: sizeClass == .compact) } label: {
                                Label { Text(agent.name).foregroundStyle(.primary) } icon: { AgentAvatar(icon: agent.icon, color: agent.color, size: 26) }
                            }
                        }
                    }
                }
                if !query.isEmpty, !projects.isEmpty {
                    Section("Projects") {
                        ForEach(projects) { project in
                            Button { router.open(.project(project.id), compact: sizeClass == .compact) } label: {
                                Label { Text(project.name).foregroundStyle(.primary) } icon: { AgentAvatar(icon: project.icon, color: project.color, image: project.image, size: 26) }
                            }
                        }
                    }
                }
                if !query.isEmpty, !skills.isEmpty {
                    Section("Skills") {
                        ForEach(skills) { skill in
                            Button { router.open(.skill(skill.id), compact: sizeClass == .compact) } label: {
                                Label("/\(skill.id)", systemImage: "wand.and.sparkles").foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, placement: .automatic, prompt: "Chats, agents, projects, skills")
        }
    }

    private func matches(_ text: String) -> Bool { !query.isEmpty && text.localizedCaseInsensitiveContains(query) }
}
