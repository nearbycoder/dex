package dev.trydex.core.model

import kotlinx.serialization.Serializable

/** Fixed lists the app shows: agent icons and colors, notification kinds, access levels, MCP templates. */
object Catalogs {
    val AGENT_ICONS = listOf(
        "bot", "git-pull-request", "shield-check", "search-code", "bug", "rocket", "pen-line", "book-open", "terminal",
        "database", "globe", "telescope", "chart", "brain", "wrench", "palette", "lightbulb", "mail", "calendar",
        "briefcase", "messages", "code", "file-text", "sparkles",
    )

    /** Avatar colors as background and foreground (ARGB), in the web's order. */
    val AGENT_COLORS: Map<String, Pair<Long, Long>> = linkedMapOf(
        "emerald" to (0xFF064E3B to 0xFF34D399),
        "sky" to (0xFF0C4A6E to 0xFF38BDF8),
        "violet" to (0xFF3B0764 to 0xFFC084FC),
        "amber" to (0xFF78350F to 0xFFFBBF24),
        "rose" to (0xFF881337 to 0xFFFB7185),
        "orange" to (0xFF7C2D12 to 0xFFFB923C),
        "teal" to (0xFF134E4A to 0xFF2DD4BF),
        "zinc" to (0xFF27272A to 0xFFD4D4D8),
    )

    fun agentColor(color: String): Pair<Long, Long> = AGENT_COLORS[color] ?: AGENT_COLORS.getValue("emerald")

    data class NotifyKind(val id: String, val label: String, val description: String)

    /** NOTIFY_KINDS in apps/web/src/shared/notifications.ts, in its order. */
    val NOTIFY_KINDS = listOf(
        NotifyKind("sidekick", "Sidekicks", "When a sidekick messages you (each sidekick's own setting decides which messages)."),
        NotifyKind("reply", "Replies", "When Dex finishes answering in a chat."),
        NotifyKind("error", "Problems", "When a reply fails."),
        NotifyKind("scheduled", "Scheduled tasks", "When a scheduled prompt has run."),
        NotifyKind("machine", "Machines", "When a project chat's VM is ready, or its setup fails."),
        NotifyKind("mcp", "MCP sign-in", "When an MCP server needs you to sign in again."),
        NotifyKind("snooze", "Snoozed chats", "When a chat you snoozed comes back."),
    )

    data class AccessRisk(val id: String, val label: String, val description: String)

    val ACCESS_RISKS = listOf(
        AccessRisk("read", "Read", "See chats, agents, projects, machines, usage, and settings."),
        AccessRisk("write", "Read & write", "Also start and message chats, create agents and projects, run commands on VMs."),
        AccessRisk("admin", "Full", "Also delete things and change settings, existing agents and projects, and MCP servers."),
    )

    fun riskLabel(id: String) = ACCESS_RISKS.firstOrNull { it.id == id }?.label ?: id

    /** Token lifetimes, in days (0: never). */
    val TOKEN_EXPIRY = listOf(30 to "30 days", 90 to "90 days", 365 to "1 year", 0 to "Never")

    data class McpTemplate(
        val id: String,
        val name: String,
        val url: String,
        val auth: String,
        val note: String,
        val headerName: String? = null,
        val headerPlaceholder: String? = null,
    )

    val MCP_TEMPLATES = listOf(
        McpTemplate("deepwiki", "DeepWiki", "https://mcp.deepwiki.com/mcp", "none", "Docs and Q&A for public GitHub repos."),
        McpTemplate("cloudflare-docs", "Cloudflare Docs", "https://docs.mcp.cloudflare.com/mcp", "none", "Search Cloudflare's documentation."),
        McpTemplate("github", "GitHub", "https://api.githubcopilot.com/mcp/", "headers", "Repos, issues, and pull requests.", "Authorization", "Bearer github_pat_…"),
        McpTemplate("linear", "Linear", "https://mcp.linear.app/mcp", "oauth", "Issues and projects."),
        McpTemplate("notion", "Notion", "https://mcp.notion.com/mcp", "oauth", "Pages and databases."),
        McpTemplate("sentry", "Sentry", "https://mcp.sentry.dev/mcp", "oauth", "Errors and performance."),
    )

    val MCP_AUTH_LABEL = mapOf("none" to "No auth", "headers" to "API key", "oauth" to "OAuth")
    val MCP_AUTH_HINT = mapOf(
        "none" to "For public servers that need no credentials.",
        "headers" to "Sent with every request: an API key, a bearer token, or any custom header.",
        "oauth" to "After saving you sign in on the provider's page; Dex registers itself and keeps the token fresh.",
    )
    val MCP_TRANSPORTS = listOf("auto" to "Auto", "streamable-http" to "Streamable HTTP", "sse" to "SSE (legacy)")
}

/** Spending and usage, as the Usage page shows it (apps/web/src/shared/usage.ts). */
object UsageFormat {
    const val CLINE_PASS_FEE = 9.99
    const val OPENCODE_GO_FEE = 10.0
    /** Command Code's Goat plan (plus a processing fee). */
    const val COMMAND_CODE_FEE = 10.0
    const val WORKERS_PAID_FEE = 5.0

    /**
     * Command Code's Goat allowance, in dollars of usage at each model's API rates: any 5 hours may use $20, any 7 days
     * $50, and the month $100. Command Code has no API for the live meters.
     */
    object CommandCodeLimits {
        const val FIVE_HOURS = 20.0
        const val WEEK = 50.0
        const val MONTH = 100.0
    }

    data class Series(val key: String, val label: String, val note: String, val color: Long)

    val SERIES = listOf(
        Series("cline", "ClinePass", "at API list prices", 0xFF3987E5),
        Series("boat", "boat.dev", "VM time", 0xFFD95926),
        Series("cloudflare", "Cloudflare", "metered", 0xFF199E70),
        Series("opencode", "OpenCode Go", "at Go rates", 0xFFC98500),
        Series("chatgpt", "ChatGPT", "at API list prices", 0xFFD55181),
        Series("commandcode", "Command Code", "at the plan's rates", 0xFF8B6FE0),
        Series("openrouter", "OpenRouter", "free models", 0xFF1FA3B5),
    )

    fun series(key: String): Series = SERIES.first { it.key == key }

    /** A count as the web's `toLocaleString()` writes it in English: 1,000. */
    fun count(value: Double): String = String.format(java.util.Locale.US, "%,d", Format.jsRound(value))

    /** How much of a limit is used, in percent; 0 when there's no limit to measure against. */
    fun share(used: Double, limit: Double): Double = if (limit > 0) used / limit * 100 else 0.0

    /** OpenRouter's free-request allowance as the Usage page writes it: "12 of 50". */
    fun freeRequests(requests: OpenRouterAccount.FreeRequests): String = "${count(requests.used)} of ${count(requests.limit)}"

    val RANGES = listOf("month" to "This month", "30d" to "Last 30 days", "all" to "All time")

    fun resetsIn(iso: String, now: Long = System.currentTimeMillis()): String {
        val at = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return "resetting now"
        val ms = at - now
        if (ms <= 0) return "resetting now"
        val hours = ms / 3_600_000.0
        if (hours < 1) return "resets in ${maxOf(1, Format.jsRound(ms / 60_000.0))} min"
        if (hours < 48) return "resets in ${Format.jsRound(hours)} h"
        val date = java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault())
        return "resets ${date.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.US)} ${date.dayOfMonth}"
    }

    /** A chart's top gridline: the next round number above the tallest bar. */
    fun niceMax(max: Double): Double {
        val top = maxOf(max, 0.0001)
        val step = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10(top)))
        return kotlin.math.ceil(top / step) * step
    }
}

@Serializable
data class DailySpend(
    val date: String,
    val cline: Double = 0.0,
    val opencode: Double = 0.0,
    val chatgpt: Double = 0.0,
    val commandcode: Double = 0.0,
    /** OpenRouter's free models cost nothing, so this is 0 unless a paid one ran. Missing from an older agent's report. */
    val openrouter: Double = 0.0,
    val boat: Double = 0.0,
    val cloudflare: Double = 0.0,
) {
    fun value(key: String): Double = when (key) {
        "cline" -> cline
        "opencode" -> opencode
        "chatgpt" -> chatgpt
        "commandcode" -> commandcode
        "openrouter" -> openrouter
        "boat" -> boat
        else -> cloudflare
    }
}

@Serializable
data class ModelUsageRow(val model: String, val responses: Long = 0, val totalTokens: Long = 0, val listCost: Double = 0.0)

@Serializable
data class ChatUsageRow(val sessionId: String, val title: String = "", val totalTokens: Long = 0, val listCost: Double = 0.0)

@Serializable
data class OpenCodeWindow(val percent: Double = 0.0, val resetsAt: String = "", val limited: Boolean = false)

@Serializable
data class OpenCodeLimits(val rolling: OpenCodeWindow = OpenCodeWindow(), val weekly: OpenCodeWindow = OpenCodeWindow(), val monthly: OpenCodeWindow = OpenCodeWindow())

@Serializable
data class TokenUsage(
    val responses: Long = 0,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val totalTokens: Long = 0,
    val listCost: Double = 0.0,
    val byModel: List<ModelUsageRow> = emptyList(),
    val byChat: List<ChatUsageRow> = emptyList(),
    /** OpenCode Go, ChatGPT, Command Code, and OpenRouter only. */
    val connected: Boolean = false,
    val limits: OpenCodeLimits? = null,
    val limitsError: String? = null,
    /** Command Code only: what Dex used in the last 5 hours, 7 days, and 30 days, against its allowance. */
    val spent: CommandCodeSpent? = null,
    /** OpenRouter only: the key's live numbers from OpenRouter; null when it isn't connected or they couldn't be read. */
    val account: OpenRouterAccount? = null,
    /** OpenRouter only: why the account's numbers couldn't be read. */
    val accountError: String? = null,
)

@Serializable
data class CommandCodeSpent(val fiveHours: Double = 0.0, val week: Double = 0.0, val month: Double = 0.0)

/** OpenRouter's own numbers for the connected key, across every app that uses it (apps/web/src/shared/usage.ts). */
@Serializable
data class OpenRouterAccount(
    /** Free-model requests today (UTC) against the daily allowance: 50, or 1,000 once the account has bought $10 of credits. */
    val freeRequests: FreeRequests? = null,
    /** USD this key spent today, this week, and this month (UTC), and in all. */
    val spent: Spent = Spent(),
    /** The key's own spending cap and what's left of it; null when it has none. */
    val keyLimit: KeyLimit? = null,
    /** The account's credits, bought and used; null when the key can't read them. */
    val credits: Credits? = null,
) {
    @Serializable data class FreeRequests(val used: Double = 0.0, val limit: Double = 0.0)
    @Serializable data class Spent(val day: Double = 0.0, val week: Double = 0.0, val month: Double = 0.0, val total: Double = 0.0)
    @Serializable data class KeyLimit(val limit: Double = 0.0, val remaining: Double = 0.0)
    @Serializable data class Credits(val total: Double = 0.0, val used: Double = 0.0)
}

@Serializable
data class BoatSizeUsage(val size: String, val hours: Double = 0.0, val cost: Double = 0.0)

@Serializable
data class BoatRun(val startedAt: Long, val endedAt: Long? = null, val size: String = "", val hours: Double = 0.0, val cost: Double = 0.0)

@Serializable
data class BoatUsage(
    val hours: Double = 0.0,
    val cost: Double = 0.0,
    val running: Boolean = false,
    val bySize: List<BoatSizeUsage> = emptyList(),
    val runs: List<BoatRun> = emptyList(),
)

@Serializable
data class CloudflareLine(
    val label: String,
    val quantity: Double = 0.0,
    val unit: String = "",
    val cost: Double = 0.0,
    val allowanceUsed: Double? = null,
    val accountWide: Boolean = false,
)

@Serializable
data class CloudflareUsage(
    val configured: Boolean = false,
    val error: String? = null,
    val since: Long = 0,
    val lines: List<CloudflareLine> = emptyList(),
    val meteredCost: Double = 0.0,
)

@Serializable
data class UsageReport(
    val range: String = "month",
    val since: Long = 0,
    val until: Long = 0,
    val cline: TokenUsage = TokenUsage(),
    val opencode: TokenUsage = TokenUsage(),
    /** At API list prices; missing from an older agent's report. */
    val chatgpt: TokenUsage = TokenUsage(),
    /** At the plan's rates; missing from an older agent's report. */
    val commandcode: TokenUsage? = null,
    /** Its free models' tokens (at $0) and the key's live numbers; missing from an older agent's report. */
    val openrouter: TokenUsage? = null,
    val boat: BoatUsage = BoatUsage(),
    val cloudflare: CloudflareUsage = CloudflareUsage(),
    val daily: List<DailySpend> = emptyList(),
)

/** One allowance window at a glance, e.g. OpenCode Go's 5 hours at 42% (apps/web/src/shared/usage.ts). */
@Serializable
data class UsageMeter(
    /** The subscription it belongs to: "opencode-go", "commandcode", "openrouter", or one added since. */
    val provider: String = "",
    /** "OpenCode Go" */
    val service: String = "",
    /** "5 hours", "Week", "Free requests today" */
    val window: String = "",
    /** Share used, 0–100; an estimate can pass 100. */
    val percent: Double = 0.0,
    /** Requests are blocked until it resets. */
    val limited: Boolean = false,
    /** When it resets (ISO 8601), when the service says. */
    val resetsAt: String? = null,
    /** "$4.20 of $20", "12 of 1,000"; null when the percentage is all there is. */
    val detail: String? = null,
    /** Worked out from Dex's own chats rather than read from the service. */
    val estimated: Boolean = false,
) {
    /** Blocked, or used up by the estimate. */
    val full: Boolean get() = limited || percent >= 100

    /** How much is used, as the web's sidebar meter writes it: "42%", "<1%", or "Limit". */
    val label: String get() = when {
        limited -> "Limit"
        percent > 0 && percent < 1 -> "<1%"
        else -> "${Format.jsRound(percent.coerceIn(0.0, 100.0))}%"
    }
}

/** What the apps' usage buttons show: the allowances, most used first, and today's tokens. Cheap to ask for. */
@Serializable
data class UsageGlance(val meters: List<UsageMeter> = emptyList(), val today: Today = Today()) {
    /** Model tokens and responses today (UTC), across every subscription. */
    @Serializable
    data class Today(val tokens: Double = 0.0, val responses: Double = 0.0)

    /** The most used allowance; null when no plan has one. */
    val top: UsageMeter? get() = meters.firstOrNull()

    /** One line: "OpenCode Go · 5 hours · 42%", or "1.2M tokens today" when no plan has an allowance. */
    val summary: String get() = top?.let { "${it.service} · ${it.window} · ${if (it.limited) "limit reached" else it.label}" }
        ?: "${Format.compact(today.tokens)} tokens today"

    /** For screen readers: "OpenCode Go 5 hours 42% used". */
    val spoken: String get() = top?.let { "${it.service} ${it.window} ${if (it.limited) "limit reached" else "${it.label} used"}" }
        ?: "${Format.compact(today.tokens)} tokens today"
}
