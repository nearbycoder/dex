package dev.trydex.fake

import dev.trydex.core.model.AccessState
import dev.trydex.core.model.AccessToken
import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.AuditEntry
import dev.trydex.core.model.BoatStatus
import dev.trydex.core.model.BuiltInModels
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.DexModel
import dev.trydex.core.model.DexSettings
import dev.trydex.core.model.DexState
import dev.trydex.core.model.GitHubStatus
import dev.trydex.core.model.McpLocal
import dev.trydex.core.model.McpServerInfo
import dev.trydex.core.model.McpStatus
import dev.trydex.core.model.McpToolInfo
import dev.trydex.core.model.ModelCost
import dev.trydex.core.model.ModelListVersion
import dev.trydex.core.model.PendingAction
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.ProjectRepo
import dev.trydex.core.model.ProviderStatus
import dev.trydex.core.model.NativePush
import dev.trydex.core.model.PushDevice
import dev.trydex.core.model.PushStatus
import dev.trydex.core.model.SavedSecret
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.SkillInfo
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmSetup
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import dev.trydex.core.model.VmStatus

/**
 * A believable account: chats in every inbox state, characters with their conversations, agents, projects, servers,
 * VMs, and an access history.
 */
object FakeData {
    const val USER_ID = "user-octocat"
    const val LOGIN = "octocat"

    /** Atlas's scheduled check-in, unread in the demo. */
    const val ATLAS_CHECK_IN = "Morning! Thursday's here: the Android release notes are due today. Want me to draft them from this week's commits?"

    /**
     * What a Command Code plan covers, as the agent lists it once a key is connected (it has no built-ins). Ids are
     * `commandcode/<apiId>`, and Command Code's apiIds carry the maker: `deepseek/deepseek-v4.1-flash`.
     */
    val commandCodeModels: List<DexModel> = listOf(
        DexModel(
            "commandcode/deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash", "commandcode", "DeepSeek V4.1 Flash", "deepseek",
            listOf("text", "image"), 1_000_000, 384_000, ModelCost(0.15, 0.6, 0.003),
            JsonObject(mapOf("off" to JsonNull, "minimal" to JsonNull, "low" to JsonPrimitive("low"), "medium" to JsonNull, "high" to JsonPrimitive("high"), "xhigh" to JsonNull, "max" to JsonPrimitive("max"))),
        ),
        DexModel(
            "commandcode/anthropic/claude-haiku-5-5", "anthropic/claude-haiku-5-5", "commandcode", "Claude Haiku 5.5", "anthropic",
            listOf("text", "image"), 1_000_000, 128_000, ModelCost(0.1, 0.5, 0.01, 0.125),
            JsonObject(mapOf("xhigh" to JsonPrimitive("xhigh"), "max" to JsonPrimitive("max"))),
        ),
        // A maker Dex has no logo for: shown under Command Code's mark.
        DexModel("commandcode/mistralai/devstral-3", "mistralai/devstral-3", "commandcode", "Devstral 3", "commandcode", listOf("text"), 256_000, 64_000, ModelCost(0.2, 0.8)),
    )

    /** A stealth model on Cline, its maker unannounced: new this week. */
    val stealthModel = DexModel("cline-pass/crouton-alpha", "cline-pass/crouton-alpha", "clinepass", "Crouton Alpha", "other", listOf("text", "image"), 256_000, 32_000)

    /** How many days ago some models came out, so the menu's dates, New badges, and Newest sections have something to show; the rest have no date. */
    private val releasedDaysAgo = mapOf(
        "cline-pass/crouton-alpha" to 2,
        "opencode-go/hy4-preview" to 5,
        "chatgpt/gpt-6.1-sol" to 9,
        "chatgpt/gpt-6.1-terra" to 9,
        "cline-pass/qwen3.8-max" to 12,
        "opencode-go/qwen3.8-max" to 12,
        "opencode-go/qwen3.8-flash" to 12,
        "cline-pass/glm-5.3" to 24,
        "cline-pass/glm-5.3-flash" to 24,
        "opencode-go/glm-5.3" to 24,
        "opencode-go/glm-5.3-flash" to 24,
        "cline-pass/kimi-k3" to 41,
        "opencode-go/kimi-k3" to 41,
        "opencode-go/step-5-preview" to 3,
        "cline-pass/deepseek-v4.1-flash" to 63,
        "opencode-go/deepseek-v4.1-flash" to 63,
        "commandcode/deepseek/deepseek-v4.1-flash" to 63,
        "commandcode/anthropic/claude-haiku-5-5" to 80,
        "opencode-go/claude-haiku-5-5" to 80,
        "chatgpt/gpt-6-sol" to 120,
        "chatgpt/gpt-6-luna" to 120,
        "opencode-go/gpt-6-luna" to 120,
        "opencode-go/glm-5.2" to 210,
        "chatgpt/gpt-5.5" to 400,
    )

    /** The model list the agent sends: the built-in one with a stealth model, plus Command Code's while a key is connected. */
    fun models(state: DexState, now: Long = System.currentTimeMillis()): List<DexModel> =
        (BuiltInModels.list + stealthModel + if (state.commandcode.connected) commandCodeModels else emptyList()).map { model ->
            val days = releasedDaysAgo[model.id] ?: return@map model
            model.copy(releasedAt = java.time.Instant.ofEpochMilli(now - days * 86_400_000L).toString().take(10))
        }

    /** The list's version, which changes when Command Code's models join or leave it (apps fetch the list again then). */
    fun modelsVersion(state: DexState): String = if (state.commandcode.connected) "builtin+commandcode" else "builtin"

    fun state(now: Long): DexState {
        val minute = 60_000L
        val hour = 60 * minute
        val day = 24 * hour
        return DexState(
            cline = ProviderStatus(connected = true, source = "user", keyHint = "sk-c…9f2a", verifiedAt = now - 3 * day),
            opencode = ProviderStatus(connected = true, source = "user", keyHint = "oc_…41b7", verifiedAt = now - day),
            boat = BoatStatus(connected = true, source = "user", keyHint = "boat…77ad"),
            settings = DexSettings(defaultModel = "cline-pass/glm-5.3", defaultThinking = ThinkingLevel.Low, instructions = "Be concise. Prefer tables for comparisons.", vmSize = "small", vmMinutes = 5),
            sessions = listOf(
                SessionMeta("chat-dashboard", "Weekly metrics dashboard", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 2 * hour, now - 4 * minute, agentId = "data-analyst", mcpServers = listOf("github")),
                SessionMeta("chat-tests", "Fix the flaky login test", "opencode-go/kimi-k3", ThinkingLevel.High, now - 5 * hour, now - 20 * minute, busy = false, agentId = "pr-author", projectId = "dex-web"),
                // Finished while you were away: unread.
                SessionMeta(
                    "chat-research", "Compare vector databases", "cline-pass/qwen3.8-max", ThinkingLevel.Medium, now - day, now - 3 * hour, agentId = "researcher",
                    unread = true, lastReply = "For 2M documents: pgvector if you're already on Postgres, Qdrant if you want a dedicated store.", repliedAt = now - 3 * hour,
                ),
                SessionMeta("chat-trip", "Plan a weekend in Lisbon", "cline-pass/deepseek-v4.1-flash", ThinkingLevel.Off, now - 2 * day, now - day, muted = true),
                SessionMeta("chat-snoozed", "Renew the TLS certificates", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 3 * day, now - 2 * day, snoozedUntil = now + 20 * hour),
                SessionMeta("chat-settled", "Release notes for v2.4", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 6 * day, now - 5 * day, agentId = "changelog", settledAt = now - 4 * day),
                // Characters' conversations: Muse's current one and one from before she started over, and Atlas's.
                SessionMeta(
                    "chat-muse", "Muse", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 3 * day, now - 35 * minute, characterId = "muse",
                    lastReply = "Space cats. Obviously. Three directions: Laser Pointer Galaxy, Purrlanet, Hairball Rocket. Which one makes you grin?", repliedAt = now - 35 * minute,
                ),
                SessionMeta("chat-muse-earlier", "Muse", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 20 * day, now - 4 * day, characterId = "muse"),
                // Atlas reached out on his own (a scheduled check-in) and you haven't seen it.
                SessionMeta(
                    "chat-atlas", "Atlas", "cline-pass/glm-5.3", ThinkingLevel.Low, now - 10 * day, now - 25 * minute, characterId = "atlas",
                    unread = true, lastReply = ATLAS_CHECK_IN, repliedAt = now - 25 * minute,
                ),
            ),
            characters = listOf("muse" to "chat-muse", "atlas" to "chat-atlas").map { (key, session) ->
                val template = Characters.TEMPLATES.first { it.key == key }
                // Atlas only notifies when he reaches out; Muse on every message.
                template.applyTo(CharacterProfile(key, thinking = ThinkingLevel.Low, notify = if (key == "atlas") "reachouts" else "all"))
                    .copy(sessionId = session, createdAt = now - 20 * day, updatedAt = now - 3 * day)
            },
            vms = listOf(
                VmInfo("chat-tests", id = "sb_1f2e", status = VmStatus.Running, size = "small", lastActiveAt = now - minute, busy = false, setup = VmSetup("done", null, null)),
                VmInfo("chat-dashboard", id = "sb_8c1a", status = VmStatus.Stopped, size = "small", lastActiveAt = now - 2 * hour),
                VmInfo("mcp-host", id = "sb_mcp1", status = VmStatus.Stopped, size = "small", lastActiveAt = now - day),
            ),
            vmConfigured = true,
            projects = listOf(
                ProjectProfile(
                    "dex-web", "Dex", "Agent harness on Cloudflare", "rocket", "emerald",
                    repos = listOf(ProjectRepo("https://github.com/octocat/dex.git", "main", ""), ProjectRepo("https://github.com/octocat/dex-docs.git", "", "docs")),
                    setupScript = "npm ci", instructions = "TypeScript monorepo. Run `npm test` before committing.", starter = "In dex, ", vmSize = null,
                    createdAt = now - 30 * day, updatedAt = now - 2 * day,
                ),
                ProjectProfile("blog", "Personal blog", "Astro site", "pen-line", "violet", repos = listOf(ProjectRepo("https://github.com/octocat/blog.git")), createdAt = now - 60 * day, updatedAt = now - 10 * day),
            ),
            github = GitHubStatus(connected = true, login = LOGIN, via = "oauth", oauthAvailable = true),
            push = PushStatus(
                configured = true, publicKey = "BEl…",
                devices = listOf(PushDevice("d1", "web", "Mac · Chrome", listOf("sidekick", "reply", "error", "scheduled", "machine", "mcp", "snooze"), true, now - 20 * day, now - hour)),
                native = NativePush(ios = true, android = true),
            ),
            agents = listOf(
                AgentProfile("pr-author", "PR Author", "Implements a change on the VM and opens a pull request.", "git-pull-request", "violet", "You turn a request into a pull request.", "In github.com/OWNER/REPO, ", "cline-pass/glm-5.3", ThinkingLevel.High, listOf("github"), now - 40 * day, now - 40 * day),
                AgentProfile("pr-reviewer", "PR Reviewer", "Reviews a pull request for bugs, risk, and missing tests.", "shield-check", "sky", "You review pull requests like a careful senior engineer.", "Review https://github.com/OWNER/REPO/pull/", "cline-pass/deepseek-v4-pro", ThinkingLevel.High, emptyList(), now - 40 * day, now - 40 * day),
                AgentProfile("researcher", "Researcher", "Digs into a topic on the web and reports back with sources.", "telescope", "amber", "You research questions thoroughly.", "Research ", "cline-pass/qwen3.8-max", ThinkingLevel.Medium, emptyList(), now - 40 * day, now - 40 * day),
                AgentProfile("data-analyst", "Data Analyst", "Crunches data on the VM and answers with charts.", "chart", "teal", "You analyze data and explain it visually.", "Analyze ", "cline-pass/kimi-k3", ThinkingLevel.High, emptyList(), now - 40 * day, now - 40 * day),
                AgentProfile("changelog", "Changelog Writer", "", "file-text", "orange", "You write changelogs.", "", "cline-pass/glm-5.3", ThinkingLevel.Low, emptyList(), now - 40 * day, now - 40 * day),
            ),
            mcp = listOf(
                McpServerInfo("github", "GitHub", "https://api.githubcopilot.com/mcp/", auth = "headers", headerNames = listOf("Authorization"), defaultOn = true, prefix = "github", status = McpStatus.Ready, tools = listOf(McpToolInfo("create_issue", "Create an issue in a repository."), McpToolInfo("search_code", "Search code across GitHub."), McpToolInfo("get_pull_request", "Read a pull request."))),
                McpServerInfo("linear", "Linear", "https://mcp.linear.app/mcp", auth = "oauth", prefix = "linear", status = McpStatus.Authenticating),
                McpServerInfo("everything", "Everything", "", local = McpLocal("npx -y @modelcontextprotocol/server-everything", listOf("API_KEY")), prefix = "everything", status = McpStatus.Disconnected),
                McpServerInfo("broken", "Docs search", "https://docs.example.com/mcp", prefix = "docs", status = McpStatus.Failed, error = "The server answered 502 Bad Gateway."),
            ),
            access = AccessState(
                tokens = listOf(
                    AccessToken("t1", "Claude Code on my laptop", "write", now - 12 * day, now - 2 * hour, now + 78 * day),
                    AccessToken("t2", "CI bot", "read", now - 100 * day, null, now - day),
                ),
                audit = listOf(
                    AuditEntry(4, now - 10 * minute, "ui", "Weekly metrics dashboard", "app_list_sessions", "List chats", true),
                    AuditEntry(3, now - hour, "chat", "Fix the flaky login test", "app_vm_run", "Run `npm test` on the VM", true),
                    AuditEntry(2, now - 2 * hour, "mcp", "Claude Code on my laptop", "app_create_session", "Start a chat “Triage issues”", true),
                    AuditEntry(1, now - 3 * hour, "user", "Fix the flaky login test", "app_delete_sessions", "Declined: Delete 2 chats", false, "Declined"),
                ),
                pending = listOf(PendingAction("p1", "chat-tests", "app_update_settings", "Change the default model to Kimi K3", now - 5 * minute, "pending")),
            ),
            secrets = listOf(SavedSecret("OPENAI_API_KEY", "For the eval scripts", now - 9 * day), SavedSecret("STRIPE_TEST_KEY", "", now - 2 * day)),
            skills = listOf(
                SkillInfo("frontend-design", "Builds distinctive, production-grade frontends.", "anthropics/skills", "frontend-design", true, 2, 18_400, now - 20 * day, now - 20 * day),
                SkillInfo("release-notes", "Writes release notes from merged pull requests.", null, null, false, 0, 2_100, now - 5 * day, now - day),
            ),
            build = "2026-10-19T22:00:00.000Z",
            models = ModelListVersion("builtin", now - hour),
        )
    }
}
