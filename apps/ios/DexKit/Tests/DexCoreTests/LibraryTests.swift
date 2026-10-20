import Foundation
import Testing
@testable import DexCore

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder.dex.decode(T.self, from: Data(json.utf8))
}

@Suite struct LibraryModelTests {
    @Test func decodesGitHubRepos() throws {
        // As GitHubRepos.search returns them (apps/web/src/agent/github-repos.ts).
        let json = #"[{"fullName":"octocat/dex","private":true,"description":"","defaultBranch":"main","pushedAt":"2026-10-18T09:30:00Z","fork":false,"archived":false,"owner":"octocat","ownerAvatar":"https://avatars.githubusercontent.com/u/1?v=4","accessible":true,"language":null,"stars":0},{"fullName":"apple/swift","private":false,"description":"The Swift Programming Language","defaultBranch":"main","pushedAt":null,"fork":false,"archived":false,"owner":"apple","ownerAvatar":"","accessible":false,"language":"C++","stars":68900}]"#
        let repos = try decode([GitHubRepo].self, json)
        #expect(repos.count == 2)
        #expect(repos[0].isPrivate && repos[0].accessible && repos[0].language == nil && repos[0].name == "dex")
        #expect(repos[0].pushedAtMs == ISO8601DateFormatter().date(from: "2026-10-18T09:30:00Z").map { $0.timeIntervalSince1970 * 1000 })
        #expect(repos[1].stars == 68_900 && !repos[1].accessible && repos[1].pushedAtMs == nil)
        // Encodes `private`, not `isPrivate`.
        #expect(try JSONValue(encoding: repos[0])["private"] == true)
    }

    @Test func decodesGitHubAccess() throws {
        let access = try decode(GitHubAccess.self, #"{"connected":true,"login":"octocat","via":"oauth","orgs":[{"login":"dex-labs","avatarUrl":"https://a/1"}],"manageUrl":"https://github.com/settings/connections/applications/abc"}"#)
        #expect(access.orgs.first?.login == "dex-labs" && access.via == "oauth")
        let none = try decode(GitHubAccess.self, #"{"connected":false,"login":null,"via":null,"orgs":[],"manageUrl":null}"#)
        #expect(!none.connected && none.manageUrl == nil)
    }

    @Test func decodesSkills() throws {
        let detail = try decode(SkillDetail.self, ##"{"id":"pdf","description":"Work with PDFs.","source":"anthropics/skills","path":"skills/pdf","auto":false,"files":2,"size":9000,"installedAt":1,"updatedAt":2,"instructions":"# PDF","fileList":[{"path":"forms.md","size":4000},{"path":"scripts/fill.py","size":1000}]}"##)
        #expect(detail.fileList.count == 2 && !detail.auto && detail.instructions == "# PDF")
        #expect(detail.sourceURL?.absoluteString == "https://github.com/anthropics/skills/tree/HEAD/skills/pdf")
        #expect(detail.info.files == 2)
        let mine = try decode(SkillDetail.self, #"{"id":"notes","description":"d","source":null,"path":null,"auto":true,"files":0,"size":10,"installedAt":1,"updatedAt":1,"instructions":"x","fileList":[]}"#)
        #expect(mine.sourceURL == nil)

        let results = try decode([DirectorySkill].self, #"[{"id":"anthropics/skills/pdf","source":"anthropics/skills","skillId":"pdf","name":"pdf","installs":48210}]"#)
        #expect(results[0].installs == 48_210 && results[0].id == "anthropics/skills/pdf")

        let preview = try decode(SkillPreview.self, #"{"name":"pdf","description":"d","instructions":"i","source":"anthropics/skills","path":"skills/pdf","url":"https://github.com/anthropics/skills/tree/HEAD/skills/pdf","files":[{"path":"a.md","size":3}],"size":120}"#)
        #expect(preview.files.first?.path == "a.md" && preview.size == 120)
    }

    @Test func decodesRegistryAndReports() throws {
        let json = #"{"source":"registry","name":"io.github.acme/docs-mcp","title":"Docs mcp","description":"Docs","version":"1.0.0","repository":null,"url":"https://docs.acme.dev/mcp","transport":"streamable-http","run":null,"headers":[{"name":"Authorization","description":"Key","required":true,"secret":true,"value":"Bearer {api_key}"}],"templated":false,"updatedAt":"2026-09-01T00:00:00Z","status":"active","uses":null,"verified":null}"#
        let server = try decode(RegistryServer.self, json)
        #expect(server.needsKey && server.headers[0].value == "Bearer {api_key}" && server.uses == nil)
        // Sent back to checkMcpServer exactly as received, nulls included.
        #expect(try JSONValue(encoding: server) == JSONValue.parse(json))

        let report = try decode(McpCheckReport.self, #"{"url":"https://docs.acme.dev/mcp","checks":[{"id":"https","label":"Secure endpoint","status":"pass","detail":"ok"},{"id":"reachable","label":"Responds","status":"fail","detail":"no"}],"auth":"headers","header":"Authorization","tools":["search"],"checkedAt":5}"#)
        #expect(report.failed && report.header == "Authorization" && report.tools == ["search"])

        let stdio = try decode(RegistryServer.self, #"{"source":"registry","name":"io.github.x/files","transport":"stdio","url":"","run":{"command":"npx -y files","env":[{"name":"TOKEN","description":"","required":true,"secret":true,"value":null}]}}"#)
        #expect(stdio.run?.command == "npx -y files" && stdio.needsKey && stdio.title == "Files")
    }

    @Test func decodesConnectResults() throws {
        #expect(try decode(McpConnectResult.self, #"{"ok":true,"id":"m1","authUrl":"https://x/authorize"}"#).authUrl == "https://x/authorize")
        let failed = try decode(McpConnectResult.self, #"{"ok":false,"error":"MCP servers need an https:// URL."}"#)
        #expect(!failed.ok && failed.id == nil && failed.error?.contains("https") == true)
    }

    @Test func draftsEncodeLikeTheServerExpects() throws {
        let agent = AgentDraft(name: "Reviewer", model: "cline-pass/glm-5.3", thinking: "high", mcpServers: ["m1"])
        let agentJSON = try JSONValue(encoding: agent)
        #expect(agentJSON["id"] == nil && agentJSON["mcpServers"] == ["m1"] && agentJSON["thinking"] == "high")

        // A project always sends vmSize and image, null meaning "the default" and "no picture".
        let project = ProjectDraft(id: "p1", name: "Dex", repos: [ProjectRepo(url: "octocat/dex", branch: "", dir: "")])
        let projectJSON = try JSONValue(encoding: project)
        #expect(projectJSON["vmSize"] == .null && projectJSON["image"] == .null && projectJSON["id"] == "p1")
        #expect(projectJSON["repos"]?[0] == ["url": "octocat/dex", "branch": "", "dir": ""])

        let server = McpServerDraft(name: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "headers", headers: [NameValue(name: "Authorization", value: "")])
        let serverJSON = try JSONValue(encoding: server)
        #expect(serverJSON["headers"] == [["name": "Authorization", "value": ""]] && serverJSON["local"] == nil && serverJSON["defaultOn"] == false)
        let local = McpServerDraft(name: "Files", local: .init(command: "npx -y files", env: [NameValue(name: "TOKEN", value: "x")]))
        #expect(try JSONValue(encoding: local)["local"] == ["command": "npx -y files", "env": [["name": "TOKEN", "value": "x"]]])

        let skill = try JSONValue(encoding: SkillInput(name: "notes", description: "d", instructions: "i"))
        #expect(skill["id"] == nil && skill["auto"] == nil && skill["name"] == "notes")
    }

    @Test func repoURLs() {
        #expect(Repos.normalize("octocat/dex") == "https://github.com/octocat/dex.git")
        #expect(Repos.normalize("github.com/octocat/dex.git/") == "https://github.com/octocat/dex.git")
        #expect(Repos.normalize("https://gitlab.com/team/app.git") == "https://gitlab.com/team/app.git")
        #expect(Repos.normalize("http://gitlab.com/team/app") == nil)
        #expect(Repos.normalize("https://gitlab.com/app") == nil)
        #expect(Repos.normalize("not a repo") == nil)
        #expect(Repos.githubFullName("https://github.com/octocat/dex.git") == "octocat/dex")
        #expect(Repos.githubRepo("octocat/dex") == "octocat/dex")
        #expect(Repos.githubRepo("https://gitlab.com/team/app.git") == nil)
        #expect(Repos.label("https://github.com/octocat/dex.git") == "octocat/dex")
        #expect(Repos.label("https://gitlab.com/team/app.git") == "gitlab.com/team/app")
        #expect(Repos.dirName("https://github.com/octocat/dex.git") == "dex")
        #expect(Repos.dirName("octocat/my repo") == "my-repo")
        #expect(Repos.isGitHub("octocat/dex") && !Repos.isGitHub("https://gitlab.com/team/app.git"))
    }

    @Test func skillAndRegistryHelpers() {
        #expect(Skills.slug("  Release Notes!! v2 ") == "release-notes-v2")
        #expect(Skills.isValidName("release-notes") && !Skills.isValidName("-x") && !Skills.isValidName(""))
        #expect(Skills.formatInstalls(980) == "980" && Skills.formatInstalls(4_500) == "4.5K" && Skills.formatInstalls(48_210) == "48K" && Skills.formatInstalls(1_260_000) == "1.3M")
        let installed = Skills.installedKeys([SkillInfo(id: "pdf", description: "", source: "anthropics/skills", path: "skills/pdf")])
        #expect(installed.contains("anthropics/skills/pdf"))
        #expect(McpRegistry.title("io.github.owner/my-server") == "My server")
        #expect(McpRegistry.publisher("io.github.owner/x") == ("github", "owner"))
        #expect(McpRegistry.publisher("com.example/x") == ("domain", "example.com"))
        #expect(McpTemplate.all.map(\.id) == ["deepwiki", "cloudflare-docs", "github", "linear", "notion", "sentry"])
    }
}

@MainActor
@Suite struct LibraryMockTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func agentsAndProjects() async throws {
        let (_, client) = await connected()
        let agent = try await client.saveAgent(AgentDraft(name: "Travel Planner", icon: "globe", color: "rose", model: "cline-pass/glm-5.3", thinking: "low", mcpServers: ["m-linear", "gone"]))
        #expect(agent.mcpServers == ["m-linear"])
        await eventually { client.state?.agent(agent.id) != nil }
        try await client.deleteAgent(agent.id)
        await eventually { client.state?.agent(agent.id) == nil }

        let project = try await client.saveProject(ProjectDraft(name: "Site", repos: [ProjectRepo(url: "octocat/dex", branch: "", dir: ""), ProjectRepo(url: "dex-labs/dex", branch: "main", dir: "")],
                                                                 image: MockAgent.mockFavicon))
        #expect(project.repos.map(\.dir) == ["dex", "dex-2"])
        #expect(project.image == MockAgent.mockFavicon)
        await #expect(throws: AgentError.self) { _ = try await client.saveProject(ProjectDraft(name: "Bad", repos: [ProjectRepo(url: "nope")])) }
    }

    @Test func gitHub() async throws {
        let (agent, client) = await connected()
        let all = try await client.searchGitHubRepos("")
        #expect(all.allSatisfy { $0.accessible && !$0.archived })
        let org = try await client.searchGitHubRepos("", owner: "dex-labs")
        #expect(org.allSatisfy { $0.owner == "dex-labs" } && org.contains { $0.isPrivate })
        let swift = try await client.searchGitHubRepos("swift")
        #expect(swift.contains { $0.fullName == "apple/swift" && !$0.accessible })
        #expect(try await client.listGitHubBranches("octocat/dex").first == "main")
        let access = try await client.githubRepoAccess()
        #expect(access.connected && access.orgs.count == 1)
        let pictures = try await client.projectImageCandidates("octocat/dex")
        #expect(pictures.last?.isAvatar == true && pictures.allSatisfy { $0.dataUrl.hasPrefix("data:image/png;base64,") })
        // An expired connection only finds public repos.
        agent.state.github.expired = true
        #expect(try await client.searchGitHubRepos("").isEmpty)
    }

    @Test func skills() async throws {
        let (_, client) = await connected()
        let results = try await client.searchSkills("pdf")
        #expect(results.first?.id == "anthropics/skills/pdf")
        let preview = try await client.previewSkill(source: "anthropics/skills", skillId: "pdf")
        #expect(preview.files.count == 2)
        let installed = try await client.installSkill(source: "anthropics/skills", skillId: "pdf", auto: false)
        #expect(!installed.auto)
        await eventually { client.state?.skills.contains { $0.id == "pdf" } == true }
        let keys = Skills.installedKeys(client.state?.skills ?? [])
        #expect(keys.contains("anthropics/skills/pdf"))
        try await client.setSkillAuto("pdf", true)
        await eventually { client.state?.skills.first { $0.id == "pdf" }?.auto == true }
        let renamed = try await client.saveSkill(SkillInput(id: "release-notes", name: "Changelog", description: "Writes changelogs.", instructions: "# Changelog"))
        #expect(renamed.id == "changelog")
        await eventually { client.state?.skills.contains { $0.id == "release-notes" } == false }
        #expect(try await client.getSkill("changelog")?.instructions == "# Changelog")
        _ = try await client.updateSkill("pdf")
        try await client.removeSkill("pdf")
        await eventually { client.state?.skills.contains { $0.id == "pdf" } == false }
        #expect(try await client.getSkill("pdf") == nil)
    }

    @Test func mcpServers() async throws {
        let (_, client) = await connected()
        let smithery = try await client.searchMcpRegistry("search", source: "smithery")
        #expect(smithery.contains { $0.verified == true && $0.uses != nil })
        let report = try await client.checkMcpServer(smithery[0])
        #expect(!report.checks.isEmpty && report.url.hasPrefix("https://"))

        let added = try await client.saveMcpServer(McpServerDraft(name: "Docs", url: "https://docs.acme.dev/mcp", auth: "headers", headers: [NameValue(name: "Authorization", value: "Bearer x")]))
        #expect(added.ok && added.authUrl == nil)
        let id = try #require(added.id)
        await eventually { client.state?.mcp.first { $0.id == id }?.status == "ready" }
        // An empty value keeps the saved header.
        let edited = try await client.saveMcpServer(McpServerDraft(id: id, name: "Docs", url: "https://docs.acme.dev/mcp", auth: "headers", headers: [NameValue(name: "Authorization", value: "")]))
        #expect(edited.ok)
        try await client.setMcpServerDefault(id, true)
        await eventually { client.state?.mcp.first { $0.id == id }?.defaultOn == true }

        let oauth = try await client.saveMcpServer(McpServerDraft(name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth"))
        #expect(oauth.authUrl != nil)
        await eventually(.seconds(5)) { client.state?.mcp.first { $0.id == oauth.id }?.status == "ready" }

        let bad = try await client.saveMcpServer(McpServerDraft(name: "Bad", url: "http://x.dev/mcp"))
        #expect(!bad.ok && bad.error != nil)
        try await client.deleteMcpServer(id)
        await eventually { client.state?.mcp.contains { $0.id == id } == false }
    }
}
