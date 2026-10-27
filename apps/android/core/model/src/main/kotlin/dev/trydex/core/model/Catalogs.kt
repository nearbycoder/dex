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

    val NOTIFY_KINDS = listOf(
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
    const val WORKERS_PAID_FEE = 5.0

    data class Series(val key: String, val label: String, val note: String, val color: Long)

    val SERIES = listOf(
        Series("cline", "ClinePass", "at API list prices", 0xFF3987E5),
        Series("boat", "boat.dev", "VM time", 0xFFD95926),
        Series("cloudflare", "Cloudflare", "metered", 0xFF199E70),
        Series("opencode", "OpenCode Go", "at Go rates", 0xFFC98500),
        Series("chatgpt", "ChatGPT", "at API list prices", 0xFFD55181),
    )

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
data class DailySpend(val date: String, val cline: Double = 0.0, val opencode: Double = 0.0, val chatgpt: Double = 0.0, val boat: Double = 0.0, val cloudflare: Double = 0.0) {
    fun value(key: String): Double = when (key) {
        "cline" -> cline
        "opencode" -> opencode
        "chatgpt" -> chatgpt
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
    /** OpenCode Go and ChatGPT only. */
    val connected: Boolean = false,
    val limits: OpenCodeLimits? = null,
    val limitsError: String? = null,
)

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
    val boat: BoatUsage = BoatUsage(),
    val cloudflare: CloudflareUsage = CloudflareUsage(),
    val daily: List<DailySpend> = emptyList(),
)
