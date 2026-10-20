import Foundation

/// The mock agent's methods for: Agents, projects, GitHub, skills, and MCP servers.
extension MockAgent {
    func installLibraryHandlers() {
        installAgentHandlers()
        installProjectHandlers()
        installSkillHandlers()
        installMcpHandlers()
    }

    // MARK: Agents

    private func installAgentHandlers() {
        register("saveAgent") { [unowned self] args, _ in
            let draft = try args.value(0).decode(AgentDraft.self)
            let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw AgentError.remote("Give the agent a name.") }
            let now = Double.nowMs
            let existing = self.state.agent(draft.id)
            let model = self.catalog.model(draft.model) != nil ? draft.model : self.state.settings.defaultModel
            let agent = AgentProfile(
                id: existing?.id ?? "\(Skills.slug(name).prefix(32))-\(UUID().uuidString.prefix(6).lowercased())", name: String(name.prefix(60)),
                description: String(draft.description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)),
                icon: AgentIconNames.contains(draft.icon) ? draft.icon : "bot", color: AgentColorNames.contains(draft.color) ? draft.color : "emerald",
                instructions: draft.instructions, starter: draft.starter, model: model, thinking: draft.thinking,
                mcpServers: draft.mcpServers.filter { id in self.state.mcp.contains { $0.id == id } }, createdAt: existing?.createdAt ?? now, updatedAt: now
            )
            if let index = self.state.agents.firstIndex(where: { $0.id == agent.id }) { self.state.agents[index] = agent } else { self.state.agents.append(agent) }
            self.publish()
            return try JSONValue(encoding: agent)
        }
        register("deleteAgent") { [unowned self] args, _ in
            let id = args.string(0)
            self.state.agents.removeAll { $0.id == id }
            for index in self.state.sessions.indices where self.state.sessions[index].agentId == id { self.state.sessions[index].agentId = nil }
            self.publish()
            return .null
        }
    }

    // MARK: Projects and GitHub

    /// Tiny pictures standing in for a repo's favicon and logo, and its owner's avatar.
    public static let mockFavicon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR42mNgoAUQ2Nn4HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCSqJGWqZCZSAQCA52SMJOWVBgAAAABJRU5ErkJggg=="
    public static let mockLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQ0lEQVR42mNgoCVITvv4H4Qp0kyWIeiaSTIEl2aiDCGkGa8hxGrGagipmjEModgAir1AlUCkSjRSJSFRJSlTJTMRCwALDTEAxqvbZQAAAABJRU5ErkJggg=="
    public static let mockAvatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJ0lEQVR42mP4dUb0PzJWV9dCwYTkGYaBAaRqQJcfDgaMpoPRdADEABEOKJ/u2/GjAAAAAElFTkSuQmCC"

    /// Repos the mock GitHub connection reaches (octocat's and the dex-labs org's), then public ones from search.
    static func mockRepos(now: Double = .nowMs) -> [GitHubRepo] {
        func ago(_ hours: Double) -> String { ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: (now - hours * 3_600_000) / 1000)) }
        return [
            GitHubRepo(fullName: "octocat/dex", description: "Personal agent harness on Cloudflare.", pushedAt: ago(2), language: "TypeScript", stars: 412),
            GitHubRepo(fullName: "octocat/dotfiles", description: "My shell and editor setup.", pushedAt: ago(30), language: "Shell", stars: 3),
            GitHubRepo(fullName: "octocat/hello-world", description: "My first repository on GitHub!", pushedAt: ago(24 * 40), language: nil, stars: 2_810),
            GitHubRepo(fullName: "octocat/old-site", description: "The 2019 website.", pushedAt: ago(24 * 900), archived: true, language: "HTML"),
            GitHubRepo(fullName: "dex-labs/billing", isPrivate: true, description: "Invoices and Stripe webhooks.", pushedAt: ago(5), language: "Go", stars: 0),
            GitHubRepo(fullName: "dex-labs/ios-app", isPrivate: true, description: "The native app.", pushedAt: ago(1), language: "Swift", stars: 0),
            GitHubRepo(fullName: "dex-labs/website", description: "trydex.dev", pushedAt: ago(72), fork: true, language: "Astro", stars: 14),
            GitHubRepo(fullName: "apple/swift", description: "The Swift Programming Language", pushedAt: ago(1), accessible: false, language: "C++", stars: 68_900),
            GitHubRepo(fullName: "vercel/next.js", description: "The React Framework", pushedAt: ago(3), accessible: false, language: "JavaScript", stars: 131_000),
            GitHubRepo(fullName: "cloudflare/agents", description: "Build and deploy AI agents on Cloudflare.", pushedAt: ago(8), accessible: false, language: "TypeScript", stars: 3_400)
        ].map { repo in
            var repo = repo
            repo.ownerAvatar = MockAgent.mockAvatar
            return repo
        }
    }

    private func installProjectHandlers() {
        register("saveProject") { [unowned self] args, _ in
            let draft = try args.value(0).decode(ProjectDraft.self)
            let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw AgentError.remote("Give the project a name.") }
            var repos: [ProjectRepo] = []
            var dirs = Set<String>()
            for repo in draft.repos where !repo.url.trimmingCharacters(in: .whitespaces).isEmpty {
                guard let url = Repos.normalize(repo.url) else { throw AgentError.remote("\"\(repo.url)\" isn't a repo. Use owner/repo or an https:// git URL.") }
                let base = repo.dir.trimmingCharacters(in: .whitespaces).isEmpty ? Repos.dirName(url) : repo.dir.trimmingCharacters(in: .whitespaces)
                var dir = base
                var n = 2
                while dirs.contains(dir) { dir = "\(base)-\(n)"; n += 1 }
                dirs.insert(dir)
                repos.append(ProjectRepo(url: url, branch: repo.branch.trimmingCharacters(in: .whitespaces), dir: dir))
            }
            let now = Double.nowMs
            let existing = self.state.project(draft.id)
            let project = ProjectProfile(
                id: existing?.id ?? "\(Skills.slug(name).prefix(32))-\(UUID().uuidString.prefix(6).lowercased())", name: String(name.prefix(60)),
                description: draft.description.trimmingCharacters(in: .whitespacesAndNewlines), icon: AgentIconNames.contains(draft.icon) ? draft.icon : "briefcase",
                color: AgentColorNames.contains(draft.color) ? draft.color : "sky", repos: repos, setupScript: draft.setupScript, instructions: draft.instructions,
                starter: draft.starter, vmSize: draft.vmSize, image: draft.image?.hasPrefix("data:image/") == true ? draft.image : nil,
                createdAt: existing?.createdAt ?? now, updatedAt: now
            )
            if let index = self.state.projects.firstIndex(where: { $0.id == project.id }) { self.state.projects[index] = project } else { self.state.projects.append(project) }
            self.publish()
            return try JSONValue(encoding: project)
        }
        register("deleteProject") { [unowned self] args, _ in
            let id = args.string(0)
            self.state.projects.removeAll { $0.id == id }
            for index in self.state.sessions.indices where self.state.sessions[index].projectId == id { self.state.sessions[index].projectId = nil }
            self.publish()
            return .null
        }
        register("searchGitHubRepos") { [unowned self] args, _ in
            let query = (args.string(0) ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let owner = args.string(1)?.lowercased()
            let connected = self.state.github.connected && self.state.github.expired != true
            var repos = MockAgent.mockRepos().filter { connected || !$0.accessible }
            if let owner { repos = repos.filter { $0.owner.lowercased() == owner } }
            if query.isEmpty {
                repos = repos.filter { $0.accessible && !$0.archived }
            } else {
                let words = query.split(separator: " ").map(String.init)
                repos = repos.filter { repo in words.allSatisfy { repo.fullName.lowercased().contains($0) || repo.description.lowercased().contains($0) } }
            }
            try await Task.sleep(for: .milliseconds(150))
            return try JSONValue(encoding: repos)
        }
        register("listGitHubBranches") { args, _ in
            let fullName = args.string(0) ?? ""
            try await Task.sleep(for: .milliseconds(120))
            if fullName == "octocat/dex" {
                return ["main", "develop", "feat/ios-native", "feat/android", "fix/flaky-dates", "release/1.0", "release/1.1", "docs/readme", "chore/deps", "spike/voice"]
            }
            return ["main", "develop"]
        }
        register("githubRepoAccess") { [unowned self] _, _ in
            let github = self.state.github
            guard github.connected else { return try JSONValue(encoding: GitHubAccess(connected: false)) }
            return try JSONValue(encoding: GitHubAccess(
                connected: true, login: github.login, via: github.via, orgs: [.init(login: "dex-labs", avatarUrl: MockAgent.mockAvatar)],
                manageUrl: "https://github.com/settings/connections/applications/mock"
            ))
        }
        register("projectImageCandidates") { args, _ in
            guard Repos.githubRepo(args.string(0) ?? "") != nil else { return [] }
            try await Task.sleep(for: .milliseconds(200))
            return try JSONValue(encoding: [
                ProjectImageCandidate(path: "public/favicon.png", dataUrl: MockAgent.mockFavicon),
                ProjectImageCandidate(path: "assets/logo.png", dataUrl: MockAgent.mockLogo),
                ProjectImageCandidate(path: "avatar", dataUrl: MockAgent.mockAvatar)
            ])
        }
    }

    // MARK: Skills

    static let mockDirectory: [DirectorySkill] = [
        DirectorySkill(source: "anthropics/skills", skillId: "pdf", name: "pdf", installs: 48_200),
        DirectorySkill(source: "anthropics/skills", skillId: "frontend-design", name: "frontend-design", installs: 91_400),
        DirectorySkill(source: "anthropics/skills", skillId: "docx", name: "docx", installs: 21_000),
        DirectorySkill(source: "obra/superpowers", skillId: "test-driven-development", name: "test-driven-development", installs: 7_350),
        DirectorySkill(source: "obra/superpowers", skillId: "code-review", name: "code-review", installs: 12_900),
        DirectorySkill(source: "vercel-labs/agent-skills", skillId: "seo-audit", name: "seo-audit", installs: 1_280),
        DirectorySkill(source: "mattpocock/skills", skillId: "write-docs", name: "write-docs", installs: 640)
    ]

    private static func mockPreview(_ skill: DirectorySkill) -> SkillPreview {
        SkillPreview(
            name: skill.skillId, description: "Use when a task involves \(skill.skillId.replacingOccurrences(of: "-", with: " ")).",
            instructions: "# \(skill.skillId)\n\nFollow these steps:\n\n1. Read the request carefully.\n2. Use the scripts in `scripts/` when they help.\n3. Check your work before answering.",
            source: skill.source, path: "skills/\(skill.skillId)", url: "https://github.com/\(skill.source)/tree/HEAD/skills/\(skill.skillId)",
            files: [.init(path: "scripts/run.py", size: 2_300), .init(path: "reference.md", size: 5_100)], size: 11_400
        )
    }

    private func skillDetail(_ id: String) -> SkillDetail? {
        guard let info = state.skills.first(where: { $0.id == id }) else { return nil }
        let stored = store["skill:\(id)"]
        let files = (try? stored?["fileList"]?.decode([SkillDetail.FileEntry].self)) ?? (info.files > 0 ? [.init(path: "reference.md", size: 4_200), .init(path: "scripts/check.sh", size: 900)].prefix(info.files).map { $0 } : [])
        let instructions = stored?["instructions"]?.string ?? "# \(id)\n\n\(info.description)\n\n- Keep it short.\n- Cite the sources you used."
        return SkillDetail(id: info.id, description: info.description, source: info.source, path: info.path, auto: info.auto, files: info.files, size: info.size,
                           installedAt: info.installedAt, updatedAt: info.updatedAt, instructions: instructions, fileList: files)
    }

    private func storeSkill(_ detail: SkillDetail) {
        let info = detail.info
        if let index = state.skills.firstIndex(where: { $0.id == info.id }) { state.skills[index] = info } else { state.skills.append(info) }
        store["skill:\(detail.id)"] = ["instructions": .string(detail.instructions), "fileList": (try? JSONValue(encoding: detail.fileList)) ?? []]
        publish()
    }

    private func installSkillHandlers() {
        register("searchSkills") { args, _ in
            let query = (args.string(0) ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            guard query.count >= 2 else { return [] }
            try await Task.sleep(for: .milliseconds(120))
            let words = query.split(separator: " ").map(String.init)
            let found = MockAgent.mockDirectory.filter { skill in words.contains { skill.id.lowercased().contains($0) } }.sorted { $0.installs > $1.installs }
            return try JSONValue(encoding: found)
        }
        register("previewSkill") { args, _ in
            guard let skill = MockAgent.mockDirectory.first(where: { $0.source == args.string(0) && $0.skillId == args.string(1) }) else {
                throw AgentError.remote("No skill \(args.string(1) ?? "") in \(args.string(0) ?? "").")
            }
            try await Task.sleep(for: .milliseconds(150))
            return try JSONValue(encoding: MockAgent.mockPreview(skill))
        }
        register("installSkill") { [unowned self] args, _ in
            guard let skill = MockAgent.mockDirectory.first(where: { $0.source == args.string(0) && $0.skillId == args.string(1) }) else {
                throw AgentError.remote("No skill \(args.string(1) ?? "") in \(args.string(0) ?? "").")
            }
            let preview = MockAgent.mockPreview(skill)
            let now = Double.nowMs
            let detail = SkillDetail(id: skill.skillId, description: preview.description, source: skill.source, path: preview.path, auto: args.value(2).bool ?? true,
                                     files: preview.files.count, size: preview.size, installedAt: now, updatedAt: now, instructions: preview.instructions, fileList: preview.files)
            self.storeSkill(detail)
            return try JSONValue(encoding: detail)
        }
        register("getSkill") { [unowned self] args, _ in
            guard let detail = self.skillDetail(args.string(0) ?? "") else { return .null }
            return try JSONValue(encoding: detail)
        }
        register("saveSkill") { [unowned self] args, _ in
            let input = try args.value(0).decode(SkillInput.self)
            let name = Skills.slug(input.name)
            guard Skills.isValidName(name) else { throw AgentError.remote("Name it with lowercase letters, digits, and dashes.") }
            guard !input.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AgentError.remote("Say when to use it.") }
            guard !input.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AgentError.remote("Write its instructions.") }
            let previous = input.id.flatMap { self.skillDetail($0) }
            if name != input.id, self.state.skills.contains(where: { $0.id == name }) { throw AgentError.remote("There's already a skill named \(name).") }
            if let previous, previous.id != name {
                self.state.skills.removeAll { $0.id == previous.id }
                self.store["skill:\(previous.id)"] = nil
            }
            let now = Double.nowMs
            let detail = SkillDetail(id: name, description: input.description, source: previous?.source, path: previous?.path, auto: input.auto ?? previous?.auto ?? true,
                                     files: previous?.files ?? 0, size: input.instructions.utf8.count + (previous?.fileList.reduce(0) { $0 + $1.size } ?? 0),
                                     installedAt: previous?.installedAt ?? now, updatedAt: now, instructions: input.instructions, fileList: previous?.fileList ?? [])
            self.storeSkill(detail)
            return try JSONValue(encoding: detail)
        }
        register("setSkillAuto") { [unowned self] args, _ in
            guard let index = self.state.skills.firstIndex(where: { $0.id == args.string(0) }) else { throw AgentError.remote("No skill \(args.string(0) ?? "").") }
            self.state.skills[index].auto = args.value(1).bool ?? true
            self.publish()
            return .null
        }
        register("updateSkill") { [unowned self] args, _ in
            guard var detail = self.skillDetail(args.string(0) ?? "") else { throw AgentError.remote("No skill \(args.string(0) ?? "").") }
            guard detail.source != nil else { throw AgentError.remote("\(detail.id) wasn't installed from GitHub.") }
            try await Task.sleep(for: .milliseconds(200))
            detail.updatedAt = .nowMs
            self.storeSkill(detail)
            return try JSONValue(encoding: detail)
        }
        register("removeSkill") { [unowned self] args, _ in
            let id = args.string(0)
            let existed = self.state.skills.contains { $0.id == id }
            self.state.skills.removeAll { $0.id == id }
            self.publish()
            return .bool(existed)
        }
    }

    // MARK: MCP servers

    static let mockRegistry: [RegistryServer] = [
        RegistryServer(source: "smithery", name: "@upstash/context7-mcp", title: "Context7", description: "Up-to-date docs for any library, right in your prompt.",
                       repository: "https://github.com/upstash/context7", url: "", uses: 182_000, verified: true),
        RegistryServer(source: "smithery", name: "@exa-labs/exa-mcp", title: "Exa Search", description: "Web search and crawling with Exa.",
                       url: "", headers: [RegistryHeader(name: "Authorization", description: "Your Exa API key", required: true, secret: true, value: "Bearer {api_key}")],
                       uses: 41_300, verified: true),
        RegistryServer(source: "smithery", name: "weather-tools", title: "Weather tools", description: "Forecasts and alerts.", url: "", uses: 900, verified: false),
        RegistryServer(source: "registry", name: "io.github.acme/docs-mcp", description: "Search Acme's documentation.", version: "1.4.0",
                       repository: "https://github.com/acme/docs-mcp", url: "https://docs.acme.dev/mcp", updatedAt: "2026-09-01T00:00:00Z"),
        RegistryServer(source: "registry", name: "dev.weatherly/forecast", description: "Weather forecasts by city.", version: "0.3.0",
                       url: "https://mcp.weatherly.dev/sse", transport: "sse", updatedAt: "2024-03-11T00:00:00Z"),
        RegistryServer(source: "registry", name: "io.github.someone/files", description: "Read and write files in a folder.", version: "2.0.1",
                       repository: "https://github.com/someone/files", transport: "stdio",
                       run: .init(command: "npx -y @someone/files-mcp /data", env: [RegistryHeader(name: "FILES_TOKEN", description: "Access token", required: true, secret: true)]),
                       updatedAt: "2026-08-20T00:00:00Z")
    ]

    private static let mockTools = [McpToolInfo(name: "search", description: "Search everything."), McpToolInfo(name: "fetch", description: "Read one result."),
                                    McpToolInfo(name: "summarize", description: "Summarize a page.")]

    private func installMcpHandlers() {
        register("saveMcpServer") { [unowned self] args, _ in
            let draft = try args.value(0).decode(McpServerDraft.self)
            let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return try JSONValue(encoding: McpConnectResult(ok: false, error: "Give the server a name.")) }
            let existing = self.state.mcp.first { $0.id == draft.id }
            let now = Double.nowMs
            var server = McpServerInfo(id: existing?.id ?? "m-\(Skills.slug(name).prefix(20))-\(UUID().uuidString.prefix(4).lowercased())", name: name, url: "",
                                       defaultOn: draft.defaultOn, prefix: existing?.prefix ?? String(Skills.slug(name).replacingOccurrences(of: "-", with: "_").prefix(20)),
                                       status: "ready", tools: MockAgent.mockTools, createdAt: existing?.createdAt ?? now, updatedAt: now)
            if let local = draft.local {
                guard !local.command.trimmingCharacters(in: .whitespaces).isEmpty else { return try JSONValue(encoding: McpConnectResult(ok: false, error: "Enter the command that starts the server.")) }
                server.local = McpLocal(command: local.command, envNames: local.env.map(\.name).filter { !$0.isEmpty })
            } else {
                guard let url = URL(string: draft.url.trimmingCharacters(in: .whitespaces)), url.scheme == "https", url.host() != nil else {
                    return try JSONValue(encoding: McpConnectResult(ok: false, error: "MCP servers need an https:// URL."))
                }
                server.url = url.absoluteString
                server.transport = draft.transport
                server.auth = draft.auth
                if draft.auth == "headers" {
                    var names: [String] = []
                    for header in draft.headers where !header.name.trimmingCharacters(in: .whitespaces).isEmpty {
                        let saved = existing?.headerNames.contains(header.name) == true
                        if header.value.isEmpty, !saved { return try JSONValue(encoding: McpConnectResult(ok: false, error: "Enter a value for the \(header.name) header.")) }
                        names.append(header.name)
                    }
                    guard !names.isEmpty else { return try JSONValue(encoding: McpConnectResult(ok: false, error: "Add at least one header, e.g. Authorization: Bearer <key>.")) }
                    server.headerNames = names
                }
            }
            let failing = server.url.contains("fail")
            if failing { server.status = "failed"; server.error = "Couldn't connect: 502 Bad Gateway"; server.tools = [] }
            if server.auth == "oauth" { server.status = "authenticating"; server.tools = [] }
            if let index = self.state.mcp.firstIndex(where: { $0.id == server.id }) { self.state.mcp[index] = server } else { self.state.mcp.append(server) }
            self.publish()
            if failing { return try JSONValue(encoding: McpConnectResult(ok: false, id: server.id, error: server.error)) }
            if server.auth == "oauth" { return try JSONValue(encoding: self.beginMockSignIn(server.id)) }
            return try JSONValue(encoding: McpConnectResult(ok: true, id: server.id))
        }
        register("connectMcpServer") { [unowned self] args, _ in
            guard let index = self.state.mcp.firstIndex(where: { $0.id == args.string(0) }) else {
                return try JSONValue(encoding: McpConnectResult(ok: false, error: "No such MCP server."))
            }
            let id = self.state.mcp[index].id
            if self.state.mcp[index].auth == "oauth", self.state.mcp[index].status != "ready" { return try JSONValue(encoding: self.beginMockSignIn(id)) }
            self.state.mcp[index].status = "connecting"
            self.publish()
            try await Task.sleep(for: .milliseconds(300))
            if let index = self.state.mcp.firstIndex(where: { $0.id == id }) {
                self.state.mcp[index].status = "ready"
                self.state.mcp[index].error = nil
                if self.state.mcp[index].tools.isEmpty { self.state.mcp[index].tools = MockAgent.mockTools }
            }
            self.publish()
            return try JSONValue(encoding: McpConnectResult(ok: true, id: id))
        }
        register("setMcpServerDefault") { [unowned self] args, _ in
            guard let index = self.state.mcp.firstIndex(where: { $0.id == args.string(0) }) else { return .null }
            self.state.mcp[index].defaultOn = args.value(1).bool ?? false
            self.publish()
            return .null
        }
        register("deleteMcpServer") { [unowned self] args, _ in
            let id = args.string(0)
            self.state.mcp.removeAll { $0.id == id }
            for index in self.state.agents.indices { self.state.agents[index].mcpServers.removeAll { $0 == id } }
            self.publish()
            return .null
        }
        register("searchMcpRegistry") { args, _ in
            let query = (args.string(0) ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let source = args.string(1) ?? "smithery"
            try await Task.sleep(for: .milliseconds(source == "registry" ? 300 : 120))
            let words = query.split(separator: " ").map(String.init)
            let found = MockAgent.mockRegistry.filter { server in
                server.source == source && (words.isEmpty || words.contains { word in
                    [server.name, server.title, server.description].contains { $0.lowercased().contains(word) }
                })
            }
            return try JSONValue(encoding: found)
        }
        register("checkMcpServer") { args, _ in
            let server = try args.value(0).decode(RegistryServer.self)
            try await Task.sleep(for: .milliseconds(250))
            return try JSONValue(encoding: MockAgent.mockReport(for: server))
        }
    }

    /// An OAuth server: the sign-in page's address. The mock signs the user in a moment later, as if they finished
    /// signing in in the browser.
    private func beginMockSignIn(_ id: String) -> McpConnectResult {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1_200))
            guard let self, let index = self.state.mcp.firstIndex(where: { $0.id == id }), self.state.mcp[index].status == "authenticating" else { return }
            self.state.mcp[index].status = "ready"
            self.state.mcp[index].tools = MockAgent.mockTools
            self.publish()
        }
        return McpConnectResult(ok: true, id: id, authUrl: "https://mock.dex.local/oauth/authorize?server=\(id)")
    }

    static func mockReport(for server: RegistryServer) -> McpCheckReport {
        if let run = server.run {
            return McpCheckReport(url: "", checks: [
                McpCheck(id: "runs", label: "Runs on your MCP VM", status: "info", detail: run.command),
                McpCheck(id: "env", label: "Needs", status: "info", detail: run.env.map { "\($0.name) (\($0.description))" }.joined(separator: "; ")),
                McpCheck(id: "repo", label: "Source", status: "pass", detail: "someone/files · 240 stars · pushed this month")
            ], auth: "none", tools: [], checkedAt: .nowMs)
        }
        let url = server.url.isEmpty ? "https://server.smithery.ai/\(server.name)/mcp" : server.url
        let publisher = McpRegistry.publisher(server.name)
        var checks = [McpCheck(id: "https", label: "Secure endpoint", status: "pass", detail: "Served over HTTPS from \(URL(string: url)?.host() ?? url)")]
        if server.source == "smithery" {
            checks.append(McpCheck(id: "hosting", label: "Hosting", status: "info", detail: "Runs on Smithery: you sign in through Smithery, and your requests pass through it."))
        } else if publisher.kind == "domain" {
            checks.append(McpCheck(id: "publisher", label: "Publisher", status: "pass", detail: "\(publisher.id) (ownership verified by the MCP Registry); the endpoint is on the same domain."))
        } else {
            checks.append(McpCheck(id: "publisher", label: "Publisher", status: "info", detail: "GitHub account \(publisher.id) (ownership verified by the MCP Registry)."))
        }
        if let updated = server.updatedAt, updated.hasPrefix("2024") {
            checks.append(McpCheck(id: "fresh", label: "Registry entry", status: "warn", detail: "Active, updated \(updated.prefix(10)) (over a year ago)."))
        }
        let auth = server.needsKey ? "headers" : server.source == "smithery" ? "oauth" : "none"
        let tools = server.transport == "sse" ? [] : ["search", "fetch", "list_pages"]
        if server.transport == "sse" {
            checks.append(McpCheck(id: "reachable", label: "Responds", status: "fail", detail: "Couldn't connect: no answer in 8 seconds"))
        } else {
            checks.append(McpCheck(id: "reachable", label: "Responds", status: "pass", detail: auth == "none" ? "MCP 2025-06-18 · \(server.title), no sign-in needed." : "Asks for sign-in (401)."))
            checks.append(McpCheck(id: "tools", label: "Tools", status: "pass", detail: "\(tools.count) tools"))
        }
        if auth == "headers" { checks.append(McpCheck(id: "auth", label: "Credentials", status: "info", detail: "Needs Authorization: Your API key.")) }
        if server.repository != nil {
            checks.append(McpCheck(id: "repo", label: "Source", status: "pass", detail: "1.2K stars · pushed 3 days ago"))
            checks.append(McpCheck(id: "license", label: "License", status: "pass", detail: "MIT"))
        } else {
            checks.append(McpCheck(id: "repo", label: "Source", status: "warn", detail: "No public source repository listed."))
        }
        return McpCheckReport(url: url, checks: checks, auth: auth, header: auth == "headers" ? "Authorization" : nil, tools: tools, checkedAt: .nowMs)
    }
}

/// The icon and color names the server accepts (shared/agents.ts).
let AgentIconNames: Set<String> = [
    "bot", "git-pull-request", "shield-check", "search-code", "bug", "rocket", "pen-line", "book-open", "terminal", "database", "globe",
    "telescope", "chart", "brain", "wrench", "palette", "lightbulb", "mail", "calendar", "briefcase", "messages", "code", "file-text", "sparkles"
]
let AgentColorNames: Set<String> = ["emerald", "sky", "violet", "amber", "rose", "orange", "teal", "zinc"]
