import Foundation
import Testing
@testable import DexCore

@Suite struct UsageReportTests {
    /// The shape `usageReport("month")` sends (apps/web/src/shared/usage.ts), trimmed.
    static let json = #"""
    {"range":"month","since":1790812800000,"until":1792368000000,
     "cline":{"responses":120,"inputTokens":900000,"outputTokens":50000,"cacheReadTokens":400000,"totalTokens":950000,"listCost":4.21,
       "byModel":[{"model":"cline-pass/glm-5.3","responses":100,"totalTokens":800000,"listCost":3.5}],
       "byChat":[{"sessionId":"s-1","title":"Fix the test","totalTokens":500000,"listCost":2.1},{"sessionId":"s-2","title":"Deleted chat","totalTokens":1000,"listCost":0.01}]},
     "opencode":{"responses":0,"inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"totalTokens":0,"listCost":0,"byModel":[],"byChat":[],
       "connected":true,"limits":{"rolling":{"percent":12.5,"resetsAt":"2026-10-19T17:00:00.000Z","limited":false},
         "weekly":{"percent":100,"resetsAt":"2026-10-22T00:00:00Z","limited":true},"monthly":{"percent":40,"resetsAt":"2026-11-01T00:00:00.000Z","limited":false}},
       "limitsError":null},
     "boat":{"hours":3.5,"cost":0.063,"running":false,"bySize":[{"size":"small","hours":3.5,"cost":0.063}],
       "runs":[{"startedAt":1792300000000,"endedAt":null,"size":"small","hours":0.25,"cost":0.0045}]},
     "cloudflare":{"configured":true,"error":null,"since":1790812800000,
       "lines":[{"label":"Worker requests","quantity":120000,"unit":"requests","cost":0.036,"allowanceUsed":0.012},
                {"label":"Workers AI","quantity":3000,"unit":"neurons","cost":0,"allowanceUsed":null,"accountWide":true}],"meteredCost":0.2},
     "daily":[{"date":"2026-10-01","cline":0.5,"opencode":0,"boat":0.01,"cloudflare":0.005},{"date":"2026-10-02","cline":0.7,"opencode":0.2,"boat":0,"cloudflare":0.004}]}
    """#

    @Test func decodesRealShape() throws {
        let report = try JSONDecoder.dex.decode(UsageReport.self, from: Data(Self.json.utf8))
        #expect(report.range == .month)
        #expect(report.cline.byModel.first?.model == "cline-pass/glm-5.3")
        #expect(report.cline.byChat.last?.isDeleted == true)
        #expect(report.opencode.connected == true)
        #expect(report.opencode.limits?.weekly.limited == true)
        #expect(report.opencode.limits?.rolling.resetDate != nil)
        #expect(report.opencode.limits?.weekly.resetDate != nil)
        #expect(report.boat.runs.first?.endedAt == nil)
        #expect(report.boat.runs.first?.durationLabel == "15 min")
        #expect(report.cloudflare.lines[1].accountWide == true)
        #expect(report.cloudflare.lines[1].allowanceUsed == nil)
        #expect(report.daily.count == 2)
        #expect(abs(report.daily[1].total(UsageSeries.allCases) - 0.904) < 1e-9)
        #expect(report.daily[0].day == Date(timeIntervalSince1970: 1_790_812_800))
    }

    @Test func decodesAnOldAgentsReport() throws {
        // No OpenCode fields at all (before OpenCode Go), no Cloudflare.
        let report = try JSONDecoder.dex.decode(UsageReport.self, from: Data(#"{"range":"30d","since":1,"until":2,"cline":{"totalTokens":5},"boat":{},"daily":[]}"#.utf8))
        #expect(report.range == .days30)
        #expect(report.opencode.connected == nil && report.opencode.limits == nil)
        #expect(report.cloudflare.configured == false)
    }

    @Test func summaryMatchesTheWeb() throws {
        let report = try JSONDecoder.dex.decode(UsageReport.self, from: Data(Self.json.utf8))
        let summary = report.summary(clineConnected: true)
        #expect(summary.series == [.cline, .boat, .cloudflare, .opencode])
        #expect(abs(summary.plans - 24.99) < 0.0001)
        #expect(abs(summary.headline - (24.99 + 0.063)) < 0.0001)
        #expect(summary.headlineLabel == "Estimated bill this month")

        var other = report
        other.range = .all
        other.opencode = ModelUsage()
        let unconnected = other.summary(clineConnected: false)
        #expect(unconnected.series == [.cline, .boat, .cloudflare])
        #expect(unconnected.plans == PlanFees.workersPaid)
        #expect(!unconnected.showOpenCode)
        #expect(unconnected.showCline) // used in the period
        #expect(unconnected.headline == report.boat.cost)
        #expect(unconnected.headlineLabel == "Variable spend")
    }

    @Test func formats() {
        #expect(UsageFormat.usd(0) == "$0.00")
        #expect(UsageFormat.usd(0.004) == "<$0.01")
        #expect(UsageFormat.usd(12.345) == "$12.35")
        #expect(UsageFormat.usd(1234.4) == "$1,234")
        #expect(UsageFormat.compact(980) == "980")
        #expect(UsageFormat.compact(1_234) == "1.2K")
        #expect(UsageFormat.compact(3_400_000) == "3.4M")
    }

    @Test func allowanceResetLabels() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let iso = { (seconds: Double) in MockAgent.iso((1_000_000 + seconds) * 1000) }
        #expect(OpenCodeWindow(percent: 1, resetsAt: iso(-5)).resetsLabel(now: now) == "resetting now")
        #expect(OpenCodeWindow(percent: 1, resetsAt: iso(12 * 60)).resetsLabel(now: now) == "resets in 12 min")
        #expect(OpenCodeWindow(percent: 1, resetsAt: iso(5 * 3600)).resetsLabel(now: now) == "resets in 5 h")
        #expect(OpenCodeWindow(percent: 1, resetsAt: iso(5 * 86400)).resetsLabel(now: now).hasPrefix("resets "))
        #expect(OpenCodeWindow(percent: 140, resetsAt: "").clampedPercent == 100)
    }

    @Test @MainActor func mockReportsEveryRange() throws {
        for range in UsageRange.allCases {
            let report = MockUsage.report(range: range, openCodeConnected: true)
            #expect(!report.daily.isEmpty)
            #expect(report.opencode.limits != nil)
            #expect(try JSONValue(encoding: report).decode(UsageReport.self) == report)
        }
        #expect(MockUsage.report(range: .days30, openCodeConnected: false).daily.count == 30)
    }
}

@Suite struct AccessTests {
    @Test func decodesCreatedToken() throws {
        let json = #"{"token":{"id":"t-9","label":"Claude Code","scope":"admin","createdAt":1,"lastUsedAt":null,"expiresAt":null},"secret":"dexk.abc"}"#
        let created = try JSONDecoder.dex.decode(CreatedAccessToken.self, from: Data(json.utf8))
        #expect(created.secret == "dexk.abc")
        #expect(created.token.scopeLabel == "Full")
        #expect(created.token.expiresAt == nil && !created.token.isExpired())
        var expiring = created.token
        expiring.expiresAt = 10
        #expect(expiring.isExpired(now: 11))
    }

    @Test func mcpSetup() {
        let endpoint = McpSetup.endpoint(server: URL(string: "https://dex.example.com/")!)
        #expect(endpoint == "https://dex.example.com/api/mcp")
        #expect(McpSetup.claudeCommand(endpoint: endpoint, token: "dexk.x") == #"claude mcp add --transport http dex https://dex.example.com/api/mcp --header "Authorization: Bearer dexk.x""#)
        let config = try? JSONValue.parse(McpSetup.jsonConfig(endpoint: endpoint, token: "dexk.x"))
        #expect(config?["mcpServers"]?["dex"]?["headers"]?["Authorization"]?.string == "Bearer dexk.x")
    }

    @Test func pendingExpiresAfterAnHour() {
        let action = PendingAction(id: "a", sessionId: "s", operation: "op", summary: "x", createdAt: 0, status: "pending")
        #expect(action.isWaiting(now: 1_000))
        #expect(!action.isWaiting(now: 3_600_001))
        var answered = action
        answered.status = "approved"
        #expect(!answered.isWaiting(now: 1))
    }

    @Test func connectResults() throws {
        #expect(ConnectResult.from(.null).ok)
        #expect(ConnectResult.from(["ok": false, "error": "Nope"]).error == "Nope")
        #expect(ConnectResult.from(["ok": true, "note": "Active"]).note == "Active")
        #expect(ConnectResult.from(["ok": true, "login": "octocat"]).login == "octocat")
    }

    @Test func scheduledPrompts() throws {
        let json = #"[{"id":"1","prompt":"Daily digest","sessionId":null,"when":"2026-10-20T09:00:00.000Z","cron":"0 9 * * *"},{"id":"2","prompt":"Once","sessionId":"s-1","when":"2026-10-21T10:30:00Z","cron":null}]"#
        let prompts = try JSONDecoder.dex.decode([ScheduledPrompt].self, from: Data(json.utf8))
        #expect(prompts[0].cron == "0 9 * * *" && prompts[0].sessionId == nil)
        #expect(prompts[0].date == Date(timeIntervalSince1970: 1_792_486_800))
        #expect(prompts[1].date == Date(timeIntervalSince1970: 1_792_578_600))
    }

    @Test func pushDeviceKinds() {
        let device = PushDevice(id: "d", label: "Mac", kinds: ["error", "reply"], onlyWhenAway: true, createdAt: 0)
        #expect(device.kinds(setting: "scheduled", on: true) == ["reply", "error", "scheduled"])
        #expect(device.kinds(setting: "reply", on: false) == ["error"])
    }
}

@Suite struct SecretNameTests {
    @Test func validates() {
        #expect(SecretName.isValid("MY_API_KEY"))
        #expect(SecretName.isValid("_PRIVATE2"))
        #expect(SecretName.isValid("my_key")) // saved upper-cased
        #expect(SecretName.problem("") == "Enter a name.")
        #expect(SecretName.problem("1PASSWORD") != nil)
        #expect(SecretName.problem("MY-KEY") != nil)
        #expect(SecretName.problem(String(repeating: "A", count: 65)) != nil)
        #expect(SecretName.problem("PATH")?.contains("reserved") == true)
        #expect(SecretName.problem("DEX_SECRET_X")?.contains("reserved") == true)
    }

    @Test func sanitizesWhileTyping() {
        #expect(SecretName.sanitize("my-api key") == "MY_API_KEY")
        #expect(SecretName.sanitize("é") == "_")
        #expect(SecretName.sanitize(String(repeating: "a", count: 80)).count == 64)
    }
}

@Suite struct WorkspaceTests {
    static let files = [
        WorkspaceFile(path: "/workspace/MEMORY.md", size: 100, mtime: 5),
        WorkspaceFile(path: "/workspace/notes/b.md", size: 10, mtime: 9),
        WorkspaceFile(path: "/workspace/notes/a.md", size: 300, mtime: 1),
        WorkspaceFile(path: "/workspace/notes/deep/c.txt", size: 1, mtime: 2),
        WorkspaceFile(path: "/workspace/index.html", size: 50, mtime: 7)
    ]

    @Test func buildsFoldersFromFlatPaths() {
        let tree = WorkspaceTree.build(Self.files)
        #expect(tree.map(\.name) == ["notes", "index.html", "MEMORY.md"])
        let notes = tree[0]
        #expect(notes.isFolder && notes.path == "/workspace/notes")
        #expect(notes.children?.map(\.name) == ["deep", "a.md", "b.md"])
        #expect(notes.children?[0].children?.first?.path == "/workspace/notes/deep/c.txt")
        #expect(notes.size == 311 && notes.mtime == 9 && notes.fileCount == 3)
    }

    @Test func sorts() {
        #expect(WorkspaceTree.build(Self.files, sort: .modified).map(\.name) == ["notes", "index.html", "MEMORY.md"])
        #expect(WorkspaceTree.build(Self.files, sort: .size).first?.children?.map(\.name) == ["deep", "a.md", "b.md"])
        #expect(WorkspaceTree.build(Self.files, sort: .size).dropFirst().map(\.name) == ["MEMORY.md", "index.html"])
    }

    @Test func searchesPaths() {
        #expect(WorkspaceTree.search(Self.files, "notes").map(\.name) == ["a.md", "b.md", "c.txt"])
        #expect(WorkspaceTree.search(Self.files, "memory").map(\.path) == ["/workspace/MEMORY.md"])
    }

    @Test func resolvesPathsLikeTheAgent() {
        #expect(Workspace.resolve("notes/a.md") == "/workspace/notes/a.md")
        #expect(Workspace.resolve("./notes/../a.md") == "/workspace/a.md")
        #expect(Workspace.resolve("/workspace/x.md") == "/workspace/x.md")
        #expect(Workspace.problem("/etc/passwd") != nil)
        #expect(Workspace.problem("") != nil)
        #expect(Workspace.problem("notes/") != nil)
        #expect(Workspace.problem("notes/new.md") == nil)
        #expect(Workspace.previewKind("a/B.MD") == .markdown)
        #expect(Workspace.previewKind("x.htm") == .html)
        #expect(Workspace.previewKind("x.txt") == nil)
    }

    @Test func decodesCommandAndFile() throws {
        let result = try JSONDecoder.dex.decode(CommandResult.self, from: Data(#"{"stdout":"a\n","stderr":"b\n","exitCode":1}"#.utf8))
        #expect(result.output == "a\nb\n" && result.exitCode == 1)
        let file = try JSONDecoder.dex.decode(WorkspaceFileContent.self, from: Data(#"{"path":"/workspace/x.bin","content":null,"size":3}"#.utf8))
        #expect(file.content == nil && file.size == 3)
    }
}

@Suite @MainActor struct MockSettingsTests {
    func call(_ agent: MockAgent, _ method: String, _ args: [JSONValue] = []) async throws -> JSONValue {
        try await agent.handlers[method]!(args, MockConnection(agent: agent))
    }

    @Test func secretsAndTokens() async throws {
        let agent = MockAgent()
        #expect(try await call(agent, "saveSecret", ["new_key", "v", "note"]).string == "NEW_KEY")
        #expect(agent.state.secrets.contains { $0.name == "NEW_KEY" && $0.note == "note" })
        // An empty value keeps the saved one (a note edit).
        _ = try await call(agent, "saveSecret", ["NEW_KEY", .null, "changed"])
        #expect(agent.state.secrets.first { $0.name == "NEW_KEY" }?.note == "changed")
        await #expect(throws: (any Error).self) { try await self.call(agent, "saveSecret", ["OTHER", ""]) }
        _ = try await call(agent, "removeSecret", ["NEW_KEY"])
        #expect(!agent.state.secrets.contains { $0.name == "NEW_KEY" })

        let created = try await call(agent, "createAccessToken", ["Laptop", "admin", .null]).decode(CreatedAccessToken.self)
        #expect(created.secret.hasPrefix("dexk.") && created.token.expiresAt == nil)
        _ = try await call(agent, "revokeAccessToken", [.string(created.token.id)])
        #expect(!agent.state.access.tokens.contains { $0.id == created.token.id })
    }

    @Test func connectionsAndFiles() async throws {
        let agent = MockAgent()
        #expect(try await call(agent, "connectOpenCode", ["bad-key"])["ok"]?.bool == false)
        #expect(try await call(agent, "connectOpenCode", ["sk-good1234"])["ok"]?.bool == true)
        #expect(agent.state.opencode.keyHint == "…1234")
        // A running VM keeps the boat.dev key.
        #expect(try await call(agent, "disconnectBoat")["ok"]?.bool == false)

        let files = try await call(agent, "listFiles").decode([WorkspaceFile].self)
        #expect(files.contains { $0.path == Workspace.memory })
        _ = try await call(agent, "writeFile", ["notes/new.md", "# Hi"])
        #expect(try await call(agent, "readFile", ["/workspace/notes/new.md"]).decode(WorkspaceFileContent.self).content == "# Hi")
        let ls = try await call(agent, "runCommand", ["cat notes/new.md"]).decode(CommandResult.self)
        #expect(ls.stdout == "# Hi" && ls.exitCode == 0)
        _ = try await call(agent, "deleteFile", ["/workspace/notes"])
        #expect(try await call(agent, "listFiles").decode([WorkspaceFile].self).allSatisfy { !$0.path.hasPrefix("/workspace/notes/") })
    }
}
