import Foundation

/// The sample Dex the mock agent starts with: a few chats in each inbox state, the starter agents, a project, skills,
/// MCP servers, a running VM, secrets, and an access token. Times are relative to now.
public enum MockData {
    static let minute: Double = 60_000
    static let hour: Double = 3_600_000
    static let day: Double = 86_400_000

    public static let welcomeId = "s-welcome"
    public static let vmChatId = "s-vm"
    public static let chartChatId = "s-chart"

    public static let chartProgram = """
    root = Card([header, chart, stats, actions])
    header = CardHeader("Weekly visits", "Last 7 days")
    chart = BarChart(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [Series("Visits", [120, 180, 150, 210, 260, 190, 230])])
    stats = Table([Col("Metric", ["Total", "Best day"]), Col("Value", ["1,340", "Friday"])])
    actions = Buttons([Button("Explain the peak", @ToAssistant("Why was Friday the busiest day?"))])
    """

    public static func state(now: Double = .nowMs) -> DexState {
        var state = DexState()
        state.cline = ClineStatus(connected: true, source: "user", keyHint: "…a1b2", verifiedAt: now - day)
        state.opencode = ClineStatus(connected: false)
        state.boat = BoatStatus(connected: true, source: "user", keyHint: "…9f3c")
        state.vmConfigured = true
        state.github = GitHubStatus(connected: true, login: "octocat", via: "oauth", oauthAvailable: true)
        state.settings = DexSettings(defaultModel: "cline-pass/glm-5.3", defaultThinking: "low", instructions: "Answer briefly.", vmSize: "small", vmMinutes: 5)
        state.sessions = [
            SessionMeta(id: welcomeId, title: "Plan a weekend in Lisbon", model: "cline-pass/glm-5.3", thinking: "low", createdAt: now - 2 * hour, updatedAt: now - 5 * minute),
            SessionMeta(id: chartChatId, title: "Site traffic this week", model: "cline-pass/kimi-k3", thinking: "high", createdAt: now - day, updatedAt: now - 3 * hour, agentId: "data-analyst"),
            SessionMeta(id: vmChatId, title: "Fix the flaky test in dex", model: "cline-pass/glm-5.3", thinking: "high", createdAt: now - 3 * hour, updatedAt: now - 20 * minute, agentId: "pr-author", projectId: "p-dex"),
            SessionMeta(id: "s-snoozed", title: "Renew the domain", model: "cline-pass/glm-5.3", thinking: "low", createdAt: now - 3 * day, updatedAt: now - 2 * day, snoozedUntil: now + day),
            SessionMeta(id: "s-settled", title: "Compare note-taking apps", model: "cline-pass/qwen3.8-max", thinking: "medium", createdAt: now - 5 * day, updatedAt: now - 4 * day, agentId: "researcher", settledAt: now - 4 * day)
        ]
        state.vms = [
            VmInfo(key: vmChatId, id: "box-1234", status: "running", size: "small", lastActiveAt: now - minute, busy: false, setup: VmSetup(status: "done", step: nil, error: nil)),
            VmInfo(key: welcomeId, id: "box-5678", status: "stopped", size: "small", lastActiveAt: now - day)
        ]
        state.agents = [
            AgentProfile(id: "pr-author", name: "PR Author", description: "Implements a change on the VM and opens a pull request.", icon: "git-pull-request", color: "violet", instructions: "You turn a request into a pull request.", starter: "In github.com/OWNER/REPO, ", model: "cline-pass/glm-5.3", thinking: "high", createdAt: now - 30 * day, updatedAt: now - 30 * day),
            AgentProfile(id: "pr-reviewer", name: "PR Reviewer", description: "Reviews a pull request for bugs, risk, and missing tests.", icon: "shield-check", color: "sky", instructions: "You review pull requests like a careful senior engineer.", starter: "Review https://github.com/OWNER/REPO/pull/", model: "cline-pass/deepseek-v4-pro", thinking: "high", createdAt: now - 30 * day, updatedAt: now - 30 * day),
            AgentProfile(id: "researcher", name: "Researcher", description: "Digs into a topic on the web and reports back with sources.", icon: "telescope", color: "amber", instructions: "You research questions thoroughly.", starter: "Research ", model: "cline-pass/qwen3.8-max", thinking: "medium", createdAt: now - 30 * day, updatedAt: now - 30 * day),
            AgentProfile(id: "data-analyst", name: "Data Analyst", description: "Crunches data on the VM and answers with charts.", icon: "chart", color: "teal", instructions: "You analyze data and explain it visually.", starter: "Analyze ", model: "cline-pass/kimi-k3", thinking: "high", createdAt: now - 30 * day, updatedAt: now - 30 * day)
        ]
        state.projects = [
            ProjectProfile(id: "p-dex", name: "Dex", description: "The Dex monorepo.", icon: "code", color: "emerald", repos: [ProjectRepo(url: "octocat/dex", branch: "main", dir: "dex")], setupScript: "npm ci", instructions: "Run npm test before committing.", starter: "In the dex repo, ", vmSize: nil, createdAt: now - 10 * day, updatedAt: now - 2 * day)
        ]
        state.skills = [
            SkillInfo(id: "frontend-design", description: "Build distinctive, production-grade web interfaces.", source: "anthropics/skills", path: "skills/frontend-design", auto: true, files: 2, size: 8_400, installedAt: now - 7 * day, updatedAt: now - 7 * day),
            SkillInfo(id: "release-notes", description: "Write release notes from merged pull requests.", source: nil, path: nil, auto: false, files: 0, size: 1_200, installedAt: now - 3 * day, updatedAt: now - 3 * day)
        ]
        state.mcp = [
            McpServerInfo(id: "m-linear", name: "Linear", url: "https://mcp.linear.app/mcp", transport: "streamable-http", auth: "oauth", defaultOn: true, prefix: "linear", status: "ready", tools: [McpToolInfo(name: "list_issues", description: "List issues"), McpToolInfo(name: "create_issue", description: "Create an issue")], createdAt: now - 6 * day, updatedAt: now - day),
            McpServerInfo(id: "m-fs", name: "Filesystem", url: "", transport: "streamable-http", auth: "none", local: McpLocal(command: "npx -y @modelcontextprotocol/server-filesystem /data", envNames: []), defaultOn: false, prefix: "fs", status: "disconnected", tools: [], createdAt: now - 2 * day, updatedAt: now - 2 * day)
        ]
        state.secrets = [
            SavedSecret(name: "OPENAI_API_KEY", note: "For the eval scripts", updatedAt: now - 4 * day),
            SavedSecret(name: "STRIPE_TEST_KEY", note: "", updatedAt: now - day)
        ]
        state.access = AccessState(
            tokens: [AccessToken(id: "t-1", label: "Claude Code", scope: "write", createdAt: now - 9 * day, lastUsedAt: now - hour, expiresAt: now + 21 * day)],
            audit: [
                AuditEntry(id: 2, at: now - hour, actor: "mcp", actorLabel: "Claude Code", operation: "app_list_sessions", summary: "Listed chats", ok: true),
                AuditEntry(id: 1, at: now - 2 * hour, actor: "chat", actorLabel: "Plan a weekend in Lisbon", operation: "app_create_agent", summary: "Created agent Travel Planner", ok: true)
            ],
            pending: []
        )
        state.push = PushStatus(configured: true, publicKey: "BMock", devices: [PushDevice(id: "d-1", label: "Mac · Safari", kinds: ["reply", "error"], onlyWhenAway: true, createdAt: now - 20 * day, lastSentAt: now - day)])
        state.build = "2026-10-19T12:00:00.000Z"
        state.models = ModelListVersion(version: "mock-1", updatedAt: now - hour)
        return state
    }

    public static let catalog = ModelCatalog(version: "mock-1", updatedAt: .nowMs, models: [
        DexModel(id: "cline-pass/glm-5.3", provider: "clinepass", name: "GLM-5.3", maker: "zai", contextWindow: 1_048_576, maxTokens: 131_072,
                 cost: .init(input: 1.4, output: 4.4), thinkingLevelMap: ["off": nil, "minimal": nil, "low": "low", "medium": nil, "high": "high", "xhigh": "max"]),
        DexModel(id: "cline-pass/kimi-k3", provider: "clinepass", name: "Kimi K3", maker: "moonshot", input: ["text", "image"], contextWindow: 1_048_576,
                 cost: .init(input: 3, output: 15), thinkingLevelMap: ["off": nil, "minimal": nil, "low": nil, "medium": nil, "high": "max", "xhigh": nil]),
        DexModel(id: "cline-pass/deepseek-v4-pro", provider: "clinepass", name: "DeepSeek V4 Pro", maker: "deepseek", contextWindow: 1_000_000, cost: .init(input: 1.74, output: 3.48)),
        DexModel(id: "cline-pass/qwen3.8-max", provider: "clinepass", name: "Qwen3.8 Max", maker: "qwen", input: ["text", "image"], cost: .init(input: 2, output: 6)),
        DexModel(id: "opencode-go/glm-5.3", apiId: "glm-5.3", provider: "opencode-go", name: "GLM-5.3", maker: "zai", cost: .init(input: 1.4, output: 4.4)),
        DexModel(id: "opencode-go/longcat-2.5-preview-free", apiId: "longcat-2.5-preview-free", provider: "opencode-go", name: "LongCat 2.5 Preview (Free)", maker: "meituan", cost: .init(input: 0, output: 0)),
        DexModel(id: "opencode-go/gemini-4-argon-contributor", apiId: "gemini-4-argon-contributor", provider: "opencode-go", name: "Gemini 4 Argon (Contributor)", maker: "google", input: ["text", "image"], cost: .init(input: 4, output: 20), trainsOnData: true),
        DexModel(id: "chatgpt/gpt-6.1-sol", apiId: "gpt-6.1-sol", provider: "chatgpt", name: "GPT-6.1 Sol", maker: "openai", input: ["text", "image"], contextWindow: 272_000,
                 maxTokens: 128_000, cost: .init(input: 2, output: 10), thinkingLevelMap: ["off": nil, "minimal": nil, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"]),
        DexModel(id: "chatgpt/gpt-6-luna", apiId: "gpt-6-luna", provider: "chatgpt", name: "GPT-6 Luna", maker: "openai", input: ["text", "image"], contextWindow: 272_000,
                 maxTokens: 128_000, cost: .init(input: 0.1, output: 0.5), thinkingLevelMap: ["off": "none", "minimal": nil, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"])
    ])

    static func assistant(_ blocks: [ContentBlock], at: Double, duration: Double = 4_000, stop: String = "stop") -> PiMessage {
        .assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", usage: Usage(input: 1200, output: 340, totalTokens: 1540), stopReason: stop, timestamp: at, durationMs: duration))
    }

    /// The sample transcript of a chat.
    public static func transcript(for session: SessionMeta) -> [EntryRecord] {
        let t = session.updatedAt - 10 * minute
        switch session.id {
        case welcomeId:
            return [
                EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Plan a relaxed weekend in Lisbon for two.", timestamp: t))]),
                EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                    .thinking("They want a relaxed pace. Two days, mix of food and views.", redacted: false),
                    .toolCall(.init(id: "call-1", name: "web_search", arguments: ["query": "Lisbon weekend itinerary 2026"]))
                ], at: t + 1_000, duration: 2_000, stop: "toolUse")]),
                EntryRecord(id: "3", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: "call-1", toolName: "web_search", content: [.text("1. Visit Lisbon — 48 hours in Lisbon\n2. Time Out — Best of Lisbon")], timestamp: t + 4_000, durationMs: 900))]),
                EntryRecord(id: "4", kind: "pi.assistant", model: [assistant([
                    .text("""
                    Here's an easy weekend, with time to wander.

                    ## Saturday
                    - **Morning:** coffee and *pastéis de nata* in Belém, then the Jerónimos Monastery.
                    - **Afternoon:** tram 28 up to Alfama; sunset at Miradouro da Senhora do Monte.

                    ## Sunday
                    | Time | Plan |
                    | --- | --- |
                    | 10:00 | LX Factory brunch |
                    | 14:00 | Gulbenkian gardens |
                    | 19:00 | Dinner in Príncipe Real |

                    ```bash
                    curl -s https://api.example.com/weather/lisbon
                    ```
                    """)
                ], at: t + 5_000, duration: 6_000)])
            ]
        case chartChatId:
            return [
                EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Chart this week's site visits.", timestamp: t))]),
                EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                    .text("Here's the week at a glance."),
                    .toolCall(.init(id: "ui-1", name: "render_ui", arguments: ["title": "Weekly visits", "code": .string(chartProgram)]))
                ], at: t + 1_000, stop: "toolUse")]),
                EntryRecord(id: "3", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: "ui-1", toolName: "render_ui", content: [.text("Rendered 5 statements.")], timestamp: t + 1_500))]),
                EntryRecord(id: "4", kind: "pi.assistant", model: [assistant([.text("Friday was the busiest day.")], at: t + 2_000, duration: 1_000)])
            ]
        case vmChatId:
            return [
                EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "The date test fails sometimes. Find out why and fix it.", timestamp: t))]),
                EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                    .toolCall(.init(id: "vm-1", name: "vm_exec", arguments: ["command": "cd ~/work/dex && npm test -- dates"]))
                ], at: t + 1_000, duration: 1_000, stop: "toolUse")]),
                EntryRecord(id: "3", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: "vm-1", toolName: "vm_exec", content: [.text("FAIL src/dates.test.ts\n  ✕ formats midnight (12 ms)\n\nTests: 1 failed, 41 passed")], isError: false, timestamp: t + 30_000, durationMs: 29_000))]),
                EntryRecord(id: "4", kind: "pi.assistant", model: [assistant([.text("The test depends on the machine's time zone. I pinned it to UTC and opened a pull request.")], at: t + 31_000, duration: 3_000)])
            ]
        default:
            return [
                EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: session.title, timestamp: t))]),
                EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([.text("Done. Anything else?")], at: t + 1_000, duration: 1_500)])
            ]
        }
    }
}
