import DexCore
import Observation
import SwiftUI

/// The app's places. On iPhone (compact width) the tab bar shows Chats, Machines, Files, Library, and Settings; on iPad
/// and an unfolded foldable the sidebar lists every place, with Library's pages listed on their own.
enum AppTab: String, Hashable, CaseIterable, Codable {
    case chats, machines, files, library, agents, projects, skills, mcp, settings, search

    var title: String {
        switch self {
        case .chats: "Chats"
        case .machines: "Machines"
        case .files: "Files"
        case .library: "Library"
        case .agents: "Agents"
        case .projects: "Projects"
        case .skills: "Skills"
        case .mcp: "MCP Servers"
        case .settings: "Settings"
        case .search: "Search"
        }
    }

    var symbol: String {
        switch self {
        case .chats: "bubble.left.and.text.bubble.right"
        case .machines: "desktopcomputer"
        case .files: "folder"
        case .library: "books.vertical"
        case .agents: "person.crop.square.on.square.angled"
        case .projects: "shippingbox"
        case .skills: "wand.and.sparkles"
        case .mcp: "point.3.connected.trianglepath.dotted"
        case .settings: "gearshape"
        case .search: "magnifyingglass"
        }
    }

    /// Library's pages, which compact width shows inside the Library tab.
    static let libraryPages: [AppTab] = [.agents, .projects, .skills, .mcp]
}

enum ChatSelection: Hashable {
    case new
    case chat(String)
}

/// Where a Library or Settings stack can go.
enum LibraryRoute: Hashable {
    case agent(String)
    case newAgent
    case project(String)
    case newProject
    case skill(String)
    case skillSearch
    case newSkill
    case mcpServer(String)
    case newMcpServer
    case mcpSearch
    case page(AppTab)
}

enum SettingsPage: String, Hashable, CaseIterable, Identifiable {
    case account, models, machines, github, defaults, secrets, access, notifications, usage, about
    var id: String { rawValue }

    var title: String {
        switch self {
        case .account: "Account"
        case .models: "Model Subscriptions"
        case .machines: "Cloud VMs"
        case .github: "GitHub"
        case .defaults: "Defaults & Instructions"
        case .secrets: "Secrets"
        case .access: "Access & API"
        case .notifications: "Notifications"
        case .usage: "Usage"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .models: "cpu"
        case .machines: "server.rack"
        case .github: "chevron.left.forwardslash.chevron.right"
        case .defaults: "slider.horizontal.3"
        case .secrets: "key"
        case .access: "lock.shield"
        case .notifications: "bell.badge"
        case .usage: "chart.bar.xaxis"
        case .about: "info.circle"
        }
    }
}

/// One window's navigation state. Kept per scene and restored, so folding or unfolding a foldable (or resizing an iPad
/// window across size classes) keeps the same chat, page, and selection.
@MainActor
@Observable
final class Router {
    var tab: AppTab = .chats
    /// The open chat, a new chat, or (compact width) nothing: the chat list.
    var chatSelection: ChatSelection?
    /// Prefill for a new chat (from an agent's or project's "Start chat").
    var newChatDraft: NewChatDraft?
    var machine: String?
    var file: String?
    var settingsPage: SettingsPage?
    var libraryPath: [LibraryRoute] = []
    var agentsPath: [LibraryRoute] = []
    var projectsPath: [LibraryRoute] = []
    var skillsPath: [LibraryRoute] = []
    var mcpPath: [LibraryRoute] = []
    var searchText = ""

    struct NewChatDraft: Equatable {
        var agentId: String?
        var projectId: String?
        var text: String = ""
    }

    // MARK: Deep links

    /// The open chat's id.
    var chat: String? {
        if case .chat(let id) = chatSelection { id } else { nil }
    }

    func openChat(_ id: String) {
        tab = .chats
        chatSelection = .chat(id)
    }

    func newChat(agentId: String? = nil, projectId: String? = nil, text: String = "") {
        tab = .chats
        newChatDraft = NewChatDraft(agentId: agentId, projectId: projectId, text: text)
        chatSelection = .new
    }

    func openFile(_ path: String) {
        tab = .files
        file = path
    }

    func openMachine(_ key: String) {
        tab = .machines
        machine = key
    }

    func openSettings(_ page: SettingsPage) {
        tab = .settings
        settingsPage = page
    }

    /// Opens a Library page, in the Library tab (compact) or its own sidebar item (regular).
    func open(_ route: LibraryRoute, compact: Bool) {
        let page: AppTab = switch route {
        case .agent, .newAgent: .agents
        case .project, .newProject: .projects
        case .skill, .skillSearch, .newSkill: .skills
        case .mcpServer, .newMcpServer, .mcpSearch: .mcp
        case .page(let tab): tab
        }
        if compact {
            tab = .library
            libraryPath = route == .page(page) ? [.page(page)] : [.page(page), route]
        } else {
            tab = page
            if case .page = route { return }
            switch page {
            case .agents: agentsPath = [route]
            case .projects: projectsPath = [route]
            case .skills: skillsPath = [route]
            case .mcp: mcpPath = [route]
            default: break
            }
        }
    }

    /// Keeps the selection valid across a size-class change (the compact Library tab isn't in the sidebar, and the
    /// sidebar's Library pages aren't in the tab bar).
    func adapt(compact: Bool) {
        if compact, AppTab.libraryPages.contains(tab) {
            let page = tab
            let inner: [LibraryRoute] = switch page {
            case .agents: agentsPath
            case .projects: projectsPath
            case .skills: skillsPath
            default: mcpPath
            }
            libraryPath = [.page(page)] + inner
            tab = .library
        } else if !compact, tab == .library {
            guard case .page(let page)? = libraryPath.first else {
                tab = .agents
                return
            }
            let inner = Array(libraryPath.dropFirst())
            switch page {
            case .agents: agentsPath = inner
            case .projects: projectsPath = inner
            case .skills: skillsPath = inner
            case .mcp: mcpPath = inner
            default: break
            }
            tab = page
        }
    }

    /// Opens what a `dex://` link points at: `dex://chat/<id>`, `dex://machine/<key>`, `dex://file/<path>`.
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "dex", let host = url.host() else { return false }
        let rest = url.path().split(separator: "/").map(String.init).joined(separator: "/")
        switch host {
        case "chat" where !rest.isEmpty: openChat(rest)
        case "machine" where !rest.isEmpty: openMachine(rest)
        case "file" where !rest.isEmpty: openFile("/" + rest)
        case "new": newChat()
        default: return false
        }
        return true
    }
}
