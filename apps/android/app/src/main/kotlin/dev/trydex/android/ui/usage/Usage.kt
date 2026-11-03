package dev.trydex.android.ui.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.Bone
import dev.trydex.android.ui.components.InfoTip
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.TableGrid
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.components.haptics
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.ChatUsageRow
import dev.trydex.core.model.Format
import dev.trydex.core.model.ModelUsageRow
import dev.trydex.core.model.OpenCodeWindow
import dev.trydex.core.model.TokenUsage
import dev.trydex.core.model.UsageFormat
import dev.trydex.core.model.UsageReport
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Reports by range, kept while the app runs so switching ranges shows the last one at once. */
private val reports = mutableStateMapOf<String, UsageReport>()

private enum class UsageTab(val label: String) { Overview("Overview"), Models("Models"), Machines("Machines"), Cloudflare("Cloudflare") }

/** A model subscription: which part of the report is theirs, and how their token costs are priced. */
private data class Subscription(val id: String, val key: String, val rates: String, val column: String, val fee: Double?, val plan: Plan? = null)

/** How a subscription without a monthly fee reads: in the Services list, and as the Plan stat and its detail. */
private data class Plan(val price: String, val value: String, val detail: String)

private val SUBSCRIPTIONS = listOf(
    Subscription("clinepass", "cline", "at API list prices", "List price", UsageFormat.CLINE_PASS_FEE),
    Subscription("opencode-go", "opencode", "at Go's rates", "Go rates", UsageFormat.OPENCODE_GO_FEE),
    Subscription("commandcode", "commandcode", "at the plan's rates", "Plan rates", UsageFormat.COMMAND_CODE_FEE),
    // Paid for with your ChatGPT plan, outside Dex's estimate.
    Subscription("chatgpt", "chatgpt", "at API list prices", "List price", null, Plan("ChatGPT plan", "ChatGPT", "your ChatGPT plan")),
    // Free models only.
    Subscription("openrouter", "openrouter", "free models", "Cost", null, Plan("Free", "Free", "free models only")),
)

/** Its monthly fee, or what pays for it. */
private fun Subscription.planOf(): Plan = plan ?: Plan("${Format.usd(fee ?: 0.0)}/mo", "${Format.usd(fee ?: 0.0)}/mo", "flat fee")

private fun UsageReport.tokens(subscription: Subscription): TokenUsage? = when (subscription.key) {
    "cline" -> cline
    "opencode" -> opencode
    "chatgpt" -> chatgpt
    "openrouter" -> openrouter
    else -> commandcode
}

private fun color(key: String) = Color(UsageFormat.series(key).color)

private val Tnum = "tnum"

private fun duration(hours: Double) = if (hours < 1) "${Format.jsRound(hours * 60)} min" else "${Format.fixed(hours, 1)} h"

private fun percent(share: Double) = if (share < 0.001) "<0.1%" else "${Format.fixed(share * 100, 1)}%"

/** What Dex costs: plans, model tokens at their rates, VM time, and Cloudflare, in four tabs. */
@Composable
fun UsageScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val haptics = haptics()
    val connected by repository.connected.collectAsStateWithLifecycle()
    val state by repository.state.collectAsStateWithLifecycle()
    var range by rememberSaveable { mutableStateOf("month") }
    var tab by rememberSaveable { mutableStateOf(UsageTab.Overview) }
    // On the Models tab: one subscription instead of all of them.
    var provider by rememberSaveable { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(range, connected, reload) {
        if (!connected) return@LaunchedEffect
        loading = true
        runCatching { repository.api.usageReport(range) }.onSuccess { reports[range] = it; error = null }.onFailure { error = it.message }
        loading = false
    }
    val report = reports[range]
    // A subscription appears once it's connected or was used in the period.
    val clineConnected = state?.cline?.connected ?: true
    val visible = report?.let { r ->
        SUBSCRIPTIONS.filter { s ->
            val usage = r.tokens(s) ?: return@filter false
            val linked = when (s.id) {
                "clinepass" -> clineConnected
                "opencode-go" -> r.opencode.connected
                "chatgpt" -> r.chatgpt.connected
                "openrouter" -> r.openrouter?.connected == true
                else -> r.commandcode?.connected == true
            }
            linked || usage.totalTokens > 0
        }
    }.orEmpty()
    fun open(next: UsageTab, subscription: String? = null) {
        haptics.tap()
        tab = next
        provider = subscription
    }

    PaneScaffold(title = "Usage", actions = {
        IconButton(onClick = { reload++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, contentDescription = "Refresh") }
    }, modifier = Modifier.testTag("usage")) { padding ->
        PageColumn(padding, maxWidth = 1024) {
            BoxWithConstraints {
                // Short on the narrowest phones, where the full labels don't fit.
                val short = maxWidth < 360.dp
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    UsageFormat.RANGES.forEachIndexed { index, (id, label) ->
                        SegmentedButton(
                            selected = range == id,
                            onClick = { haptics.tap(); range = id },
                            shape = SegmentedButtonDefaults.itemShape(index, UsageFormat.RANGES.size),
                            modifier = Modifier.testTag("range-$id"),
                        ) {
                            Text(if (short) mapOf("month" to "Month", "30d" to "30 days").getOrDefault(id, "All") else label, maxLines = 1)
                        }
                    }
                }
            }
            PrimaryScrollableTabRow(
                selectedTabIndex = tab.ordinal,
                edgePadding = 0.dp,
                containerColor = Color.Transparent,
                divider = { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                UsageTab.entries.forEach { item ->
                    Tab(
                        selected = tab == item,
                        onClick = { open(item) },
                        text = { Text(item.label, maxLines = 1) },
                        modifier = Modifier.testTag("usage-tab-${item.name.lowercase()}"),
                    )
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Banner(it, tone = Tone.Error) }
            if (report == null) {
                UsageSkeleton()
                return@PageColumn
            }
            when (tab) {
                UsageTab.Overview -> Overview(report, visible, clineConnected, onOpen = ::open)
                UsageTab.Models -> Models(report, visible, provider, onPick = { haptics.tap(); provider = it })
                UsageTab.Machines -> Machines(report)
                UsageTab.Cloudflare -> CloudflareTab(report)
            }
            Text(
                "Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates " +
                    "(ClinePass ${Format.usd(UsageFormat.CLINE_PASS_FEE)}/mo, OpenCode Go ${Format.usd(UsageFormat.OPENCODE_GO_FEE)}/mo, " +
                    "Command Code Goat ${Format.usd(UsageFormat.COMMAND_CODE_FEE)}/mo plus a processing fee, OpenRouter's free models \$0, Workers Paid ${Format.usd(UsageFormat.WORKERS_PAID_FEE)}/mo, " +
                    "boat.dev small \$0.018/h). Your invoices are the source of truth. VM time before usage tracking started is not included.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The Overview's shape while the first report loads: the bill, the services, and the chart. */
@Composable
private fun UsageSkeleton() {
    Column(Modifier.testTag("usage-skeleton"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Bone(width = 140.dp, height = 12.dp)
                Bone(width = 120.dp, height = 32.dp)
                Bone(height = 10.dp)
                Bone(fraction = 0.7f, height = 12.dp)
            }
        }
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Bone(width = 80.dp, height = 16.dp)
                repeat(4) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Bone(width = 10.dp, height = 10.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Bone(fraction = 0.4f, height = 14.dp)
                            Bone(fraction = 0.75f, height = 10.dp)
                        }
                        Bone(width = 56.dp, height = 14.dp)
                    }
                }
            }
        }
        Bone(height = 240.dp, modifier = Modifier.clip(MaterialTheme.shapes.extraLarge))
    }
}

@Composable
private fun Swatch(color: Color, size: Dp = 10.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(3.dp)).background(color))
}

/** A row of headline numbers: two across on phones, four on wider screens. */
@Composable
private fun Stats(items: List<Triple<String, String, String?>>) {
    BoxWithConstraints {
        val columns = if (maxWidth >= 600.dp) 4 else 2
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth().testTag("usage-stats")) {
            Column {
                items.chunked(columns).forEachIndexed { r, row ->
                    if (r > 0) HorizontalDivider(color = MaterialTheme.colorScheme.surface)
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { (label, value, detail) ->
                            Column(Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 12.dp)) {
                                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(value, style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = Tnum, fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                detail?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

/** A share-used meter: amber nearing the limit, red at it. */
@Composable
private fun MeterBar(percent: Double, color: Color, limited: Boolean = false, height: Dp = 8.dp, modifier: Modifier = Modifier) {
    val clamped = percent.coerceIn(0.0, 100.0)
    val tone = when {
        limited || clamped >= 100 -> MaterialTheme.colorScheme.error
        clamped >= 80 -> DexTheme.colors.warning
        else -> color
    }
    LinearProgressIndicator(
        progress = { (max(clamped, if (clamped > 0) 2.0 else 0.0) / 100).toFloat() },
        color = tone, trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
        gapSize = 0.dp, drawStopIndicator = {},
        modifier = modifier.fillMaxWidth().height(height),
    )
}

@Composable
private fun Meter(label: String, percent: Double, value: String, color: Color, limited: Boolean = false, valueColor: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label: ${Format.jsRound(percent.coerceIn(0.0, 100.0))}% used, $value" }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Text(value, style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = Tnum), color = valueColor, textAlign = TextAlign.End)
        }
        MeterBar(percent, color, limited)
    }
}

// ── Overview ────────────────────────────────────────────────────────────────

private data class Service(val key: String, val label: String, val price: String, val summary: String, val meter: Pair<Double, String>?, val running: Boolean, val open: () -> Unit)

@Composable
private fun Overview(report: UsageReport, visible: List<Subscription>, clineConnected: Boolean, onOpen: (UsageTab, String?) -> Unit) {
    val month = report.range == "month"
    // What this month's bill is made of: the flat plans Dex knows about, plus VM time.
    val parts = visible.mapNotNull { s ->
        val on = when (s.id) {
            "clinepass" -> clineConnected
            "opencode-go" -> report.opencode.connected
            "commandcode" -> report.commandcode?.connected == true
            else -> false
        }
        if (s.fee != null && on) s.key to s.fee else null
    } + listOf("cloudflare" to UsageFormat.WORKERS_PAID_FEE, "boat" to report.boat.cost)
    val plans = parts.filter { it.first != "boat" }.sumOf { it.second }
    val bill = plans + report.boat.cost

    // OpenRouter's free requests today, read live (the web shows it in the Overview's Status).
    val freeRequests = report.openrouter?.takeIf { it.connected }?.account?.freeRequests
    val services = visible.map { s ->
        val usage = report.tokens(s)!!
        val meter = when {
            s.id == "opencode-go" && report.opencode.limits != null -> report.opencode.limits!!.monthly.percent to "of this month's allowance"
            s.id == "commandcode" && report.commandcode?.spent != null -> report.commandcode!!.spent!!.month / UsageFormat.CommandCodeLimits.MONTH * 100 to "of 30 days' allowance"
            s.id == "openrouter" && freeRequests != null -> UsageFormat.share(freeRequests.used, freeRequests.limit) to "of today's free requests"
            else -> null
        }
        Service(
            s.key, UsageFormat.series(s.key).label,
            s.planOf().price,
            when {
                s.id == "openrouter" && freeRequests != null -> "${Format.compact(usage.totalTokens)} tokens · ${UsageFormat.freeRequests(freeRequests)} free today"
                s.id == "openrouter" -> "${Format.compact(usage.totalTokens)} tokens · free models"
                else -> "${Format.compact(usage.totalTokens)} tokens · ${Format.usd(usage.listCost)} ${s.rates}"
            },
            meter, false,
        ) { onOpen(UsageTab.Models, s.id) }
    } + listOf(
        Service("boat", "boat.dev", Format.usd(report.boat.cost), "${duration(report.boat.hours)} of VM time", null, report.boat.running) { onOpen(UsageTab.Machines, null) },
        Service(
            "cloudflare", "Cloudflare", "${Format.usd(UsageFormat.WORKERS_PAID_FEE)}/mo",
            when {
                !report.cloudflare.configured -> "Add an analytics token to see usage"
                report.cloudflare.error != null -> "Analytics unavailable right now"
                else -> "${Format.usd(report.cloudflare.meteredCost)} metered, inside the plan's allowance"
            },
            null, false,
        ) { onOpen(UsageTab.Cloudflare, null) },
    )

    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth().testTag("usage-bill")) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (month) "Estimated bill this month" else "VM time in this period", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                Format.usd(if (month) bill else report.boat.cost),
                style = MaterialTheme.typography.displaySmall.copy(fontFeatureSettings = Tnum, fontWeight = FontWeight.SemiBold),
            )
            Text(
                if (month) "${Format.usd(plans)} in plans + ${Format.usd(report.boat.cost)} of VM time" else "Plans add ${Format.usd(plans)} a month",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (month && bill > 0) {
                val shown = parts.filter { it.second > 0 }
                Row(
                    Modifier.padding(top = 12.dp).fillMaxWidth().height(10.dp).clip(CircleShape)
                        .semantics { contentDescription = "What the bill is made of: " + parts.joinToString { "${UsageFormat.series(it.first).label} ${Format.usd(it.second)}" } },
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    shown.forEach { (key, value) -> Box(Modifier.weight(value.toFloat()).fillMaxHeight().background(color(key))) }
                }
                FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    parts.forEach { (key, value) ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Swatch(color(key), 8.dp)
                            Text(UsageFormat.series(key).label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(Format.usd(value), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = Tnum))
                        }
                    }
                }
            }
        }
    }

    SectionCard(title = "Services", contentPadding = false) {
        BoxWithConstraints {
            val wide = maxWidth >= 600.dp
            Column {
                services.forEachIndexed { i, service ->
                    if (i > 0) HorizontalDivider(Modifier.padding(start = 42.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                    ServiceRow(service, wide)
                }
            }
        }
    }

    DailyUsage(report, UsageFormat.SERIES.filter { s -> s.key == "boat" || s.key == "cloudflare" || visible.any { it.key == s.key } })
}

@Composable
private fun ServiceRow(service: Service, wide: Boolean) {
    val tint = color(service.key)
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Show ${service.label}", onClick = service.open)
            .heightIn(min = 56.dp).padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 12.dp).testTag("service-${service.key}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Swatch(tint)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(service.label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (!wide) {
                    Text(service.price, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = Tnum), maxLines = 1)
                }
            }
            Text(
                service.summary + if (service.running) " · running now" else "",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            if (!wide) service.meter?.let { (share, label) ->
                Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MeterBar(share, tint, height = 6.dp, modifier = Modifier.weight(1f))
                    Text("${Format.jsRound(share)}% $label", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = Tnum), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
        if (wide) {
            Column(Modifier.width(176.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                service.meter?.let { (share, label) ->
                    MeterBar(share, tint, height = 6.dp)
                    Text("${Format.jsRound(share)}% $label", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = Tnum), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            Text(service.price, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = Tnum), textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(96.dp))
        }
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
    }
}

// ── Daily chart ─────────────────────────────────────────────────────────────

/** Daily spend, with a legend that doubles as a filter: tap a service to hide or show it. */
@Composable
private fun DailyUsage(report: UsageReport, available: List<UsageFormat.Series>) {
    val haptics = haptics()
    var table by rememberSaveable { mutableStateOf(false) }
    var hidden by rememberSaveable { mutableStateOf(listOf<String>()) }
    val shown = available.filter { it.key !in hidden }
    SectionCard(
        title = "Daily usage",
        info = "Model subscriptions are shown at what their tokens cost at each model's rates (API list prices, or the rates the plan counts against its allowance); you pay their flat plans. Cloudflare is metered usage at list rates, before the plan's included allowance.",
        aside = {
            TextButton(onClick = { table = !table }, modifier = Modifier.testTag("usage-toggle")) {
                Icon(if (table) Icons.Outlined.BarChart else Icons.Outlined.TableChart, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(if (table) "Chart" else "Table", modifier = Modifier.padding(start = 6.dp))
            }
        },
    ) {
        // Identity is never color alone: each chip has its name, and a hidden one is struck through.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            available.forEach { s ->
                val on = s.key !in hidden
                FilterChip(
                    selected = on,
                    onClick = {
                        haptics.toggle(!on)
                        hidden = if (on) hidden + s.key else hidden - s.key
                    },
                    label = { Text(s.label, textDecoration = if (on) null else TextDecoration.LineThrough) },
                    leadingIcon = { Swatch(if (on) Color(s.color) else MaterialTheme.colorScheme.outlineVariant, 8.dp) },
                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest),
                    modifier = Modifier.testTag("legend-${s.key}"),
                )
            }
        }
        if (table) DailyTable(report, shown) else DailyChart(report, shown)
    }
}

@Composable
private fun DailyChart(report: UsageReport, series: List<UsageFormat.Series>) {
    val days = report.daily
    var selected by remember(days) { mutableStateOf<Int?>(null) }
    val measurer = rememberTextMeasurer()
    val label = TextStyle(fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val grid = MaterialTheme.colorScheme.outlineVariant
    val totals = remember(days, series) { days.map { day -> series.sumOf { day.value(it.key) } } }
    // With nothing to draw, a $0–$1 axis instead of ticks too small to tell apart.
    val niceMax = (totals.maxOrNull() ?: 0.0).let { if (it == 0.0) 1.0 else UsageFormat.niceMax(it) }
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().testTag("usage-chart")) {
        val widthPx = with(density) { maxWidth.toPx() }
        val left = with(density) { 44.dp.toPx() }
        val plotW = max(1f, widthPx - with(density) { 48.dp.toPx() })
        val slot = plotW / max(1, days.size)
        Canvas(
            Modifier.fillMaxWidth().height(200.dp)
                .semantics { contentDescription = "Daily usage cost by service, ${days.size} days" }
                .pointerInput(days.size, slot) {
                    detectTapGestures { tap ->
                        val i = floor((tap.x - left) / slot).toInt()
                        selected = if (i in days.indices && selected != i) i else null
                    }
                },
        ) {
            val top = 8.dp.toPx()
            val plotH = 170.dp.toPx()
            fun y(v: Double) = top + plotH - (v / niceMax * plotH).toFloat()
            listOf(0.0, niceMax / 2, niceMax).forEach { tick ->
                drawLine(grid, Offset(left, y(tick)), Offset(size.width, y(tick)), 1f)
                val layout = measurer.measure(Format.usd(tick), label)
                drawText(layout, topLeft = Offset(left - 6.dp.toPx() - layout.size.width, y(tick) - layout.size.height / 2))
            }
            val barW = max(2.dp.toPx(), min(22.dp.toPx(), slot * 0.6f))
            val every = ceil(days.size / max(1f, floor(plotW / 56.dp.toPx()))).toInt().coerceAtLeast(1)
            days.forEachIndexed { i, day ->
                val x = left + i * slot + (slot - barW) / 2
                val alpha = if (selected != null && selected != i) 0.45f else 1f
                var bottom = y(0.0)
                val parts = series.filter { day.value(it.key) > 0 }
                parts.forEachIndexed { index, s ->
                    val value = day.value(s.key)
                    val segmentTop = bottom - (value / niceMax * plotH).toFloat()
                    // A 2dp surface gap between stacked fills, and a rounded top.
                    val height = max(1f, bottom - segmentTop - if (index > 0) 2.dp.toPx() else 0f)
                    val radius = if (index == parts.lastIndex) min(4.dp.toPx(), barW / 2) else 0f
                    drawRoundRect(Color(s.color).copy(alpha = alpha), Offset(x, bottom - height - if (index > 0) 2.dp.toPx() else 0f), Size(barW, height), CornerRadius(radius))
                    bottom = segmentTop
                }
                if (i % every == 0) {
                    val layout = measurer.measure(Format.shortDate(day.date), label)
                    drawText(layout, topLeft = Offset((x + barW / 2 - layout.size.width / 2).coerceIn(0f, size.width - layout.size.width), size.height - 16.dp.toPx()))
                }
            }
        }
        selected?.let { i ->
            val day = days[i]
            val x = with(density) { min(max(0f, left + i * slot - 70.dp.toPx()), widthPx - 180.dp.toPx()).toDp() }
            Surface(
                shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.inverseSurface, contentColor = MaterialTheme.colorScheme.inverseOnSurface, shadowElevation = 3.dp,
                modifier = Modifier.offset { IntOffset(x.roundToPx(), 0) }.width(176.dp).testTag("usage-tooltip"),
            ) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(Format.shortDate(day.date), style = MaterialTheme.typography.labelLarge)
                    series.forEach { s ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Swatch(Color(s.color), 8.dp)
                            Text(s.label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                            Text(Format.usd(day.value(s.key)), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = Tnum))
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.2f))
                    Row {
                        Text("Total", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        Text(Format.usd(totals[i]), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = Tnum))
                    }
                }
            }
        }
    }
}

@Composable
private fun DailyTable(report: UsageReport, series: List<UsageFormat.Series>) {
    val rows = report.daily.reversed()
    val headers = listOf("Date") + series.map { it.label } + "Total"
    Box(Modifier.fillMaxWidth().heightIn(max = 288.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).testTag("usage-table")) {
        TableGrid(
            rows = rows.size + 1,
            columns = headers.size,
            rowBackground = { r -> Box(Modifier.background(if (r == 0) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent)) },
        ) { r, c ->
            Box(Modifier.padding(horizontal = 12.dp, vertical = 8.dp).widthIn(min = if (c == 0) 64.dp else 56.dp)) {
                if (r == 0) Text(headers[c], style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                else {
                    val day = rows[r - 1]
                    val text = when (c) {
                        0 -> Format.shortDate(day.date)
                        headers.lastIndex -> Format.usd(series.sumOf { day.value(it.key) })
                        else -> Format.usd(day.value(series[c - 1].key))
                    }
                    Text(text, style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = Tnum), textAlign = if (c > 0) TextAlign.End else TextAlign.Start, maxLines = 1)
                }
            }
        }
    }
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** A list that fits the screen: a name column that takes the room left, and numbers right-aligned after it. */
@Composable
private fun NumberList(headers: List<String>, widths: List<Dp>, rows: Int, name: @Composable (Int) -> Unit, cells: (Int) -> List<String>) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(headers.first(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            headers.drop(1).forEachIndexed { i, header ->
                Text(header, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(widths[i]))
            }
        }
        repeat(rows) { r ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { name(r) }
                cells(r).forEachIndexed { i, value ->
                    Text(value, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = Tnum), textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(widths[i]))
                }
            }
        }
    }
}

private data class ModelRow(val row: ModelUsageRow, val color: Color?)

@Composable
private fun ModelTable(rows: List<ModelRow>, column: String) {
    val app = LocalApp.current
    if (rows.isEmpty()) {
        Text("No model usage in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        return
    }
    BoxWithConstraints {
        val responses = maxWidth >= 480.dp
        NumberList(
            headers = listOfNotNull("Model", "Responses".takeIf { responses }, "Tokens", column),
            widths = listOfNotNull(88.dp.takeIf { responses }, 64.dp, 76.dp),
            rows = rows.size,
            name = { i ->
                val row = rows[i]
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ModelLogo(row.row.model, app.graph.models, size = 16.dp)
                    // A model this app's list doesn't have (yet): its id without the subscription and maker prefixes.
                    Text(
                        app.graph.models.find(row.row.model)?.name ?: row.row.model.substringAfterLast('/'),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    )
                    row.color?.let { Swatch(it, 8.dp) }
                }
            },
            cells = { i -> listOfNotNull("${rows[i].row.responses}".takeIf { responses }, Format.compact(rows[i].row.totalTokens), Format.usd(rows[i].row.listCost)) },
        )
    }
}

@Composable
private fun TopChats(chats: List<ChatUsageRow>, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    SectionCard(title = "Top chats", contentPadding = false, modifier = modifier.testTag("top-chats")) {
        if (chats.isEmpty()) {
            Text("No chats used models in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            return@SectionCard
        }
        Column {
            chats.forEachIndexed { i, chat ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                val deleted = chat.title == "Deleted chat"
                Row(
                    Modifier.fillMaxWidth().then(if (deleted) Modifier else Modifier.clickable { app.navigator.open(Chat(chat.sessionId)) })
                        .heightIn(min = 44.dp).padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        chat.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                        color = if (deleted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    Text("${Format.compact(chat.totalTokens)} · ${Format.usd(chat.listCost)}", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = Tnum), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** Two cards side by side on wide screens (3:2), stacked on phones. */
@Composable
private fun SideBySide(first: @Composable (Modifier) -> Unit, second: @Composable (Modifier) -> Unit) {
    BoxWithConstraints {
        if (maxWidth >= 840.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                first(Modifier.weight(3f))
                second(Modifier.weight(2f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                first(Modifier)
                second(Modifier)
            }
        }
    }
}

// ── Models ──────────────────────────────────────────────────────────────────

@Composable
private fun Models(report: UsageReport, visible: List<Subscription>, provider: String?, onPick: (String?) -> Unit) {
    val chosen = visible.firstOrNull { it.id == provider }
    val all = visible.mapNotNull { s -> report.tokens(s)?.let { s to it } }
    fun sum(pick: (TokenUsage) -> Long) = all.sumOf { pick(it.second) }

    // Filter: one subscription, or all of them together; the chosen one scrolls into view.
    val choices = listOf<Subscription?>(null) + visible
    val chips = rememberLazyListState()
    LaunchedEffect(chosen?.id) { chips.animateScrollToItem(maxOf(0, choices.indexOf(chosen))) }
    LazyRow(state = chips, modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices, key = { it?.id ?: "all" }) { s ->
            val tokens = if (s == null) sum { it.totalTokens } else report.tokens(s)?.totalTokens ?: 0
            FilterChip(
                selected = s?.id == chosen?.id,
                onClick = { onPick(s?.id) },
                label = {
                    Text(if (s == null) "All" else UsageFormat.series(s.key).label)
                    Text(" ${Format.compact(tokens)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                },
                leadingIcon = s?.let { { Swatch(color(it.key), 8.dp) } },
                modifier = Modifier.testTag("provider-${s?.id ?: "all"}"),
            )
        }
    }

    if (chosen != null) {
        SubscriptionDetail(report, chosen)
        return
    }
    Stats(listOf(
        Triple("Responses", Format.compact(sum { it.responses }), null),
        Triple("Tokens", Format.compact(sum { it.totalTokens }), "${Format.compact(sum { it.outputTokens })} output"),
        Triple("Cached input", Format.compact(sum { it.cacheReadTokens }), null),
        Triple("Worth at model rates", Format.usd(all.sumOf { it.second.listCost }), "covered by your plans"),
    ))
    val models = all.flatMap { (s, usage) -> usage.byModel.map { ModelRow(it, color(s.key)) } }.sortedByDescending { it.row.listCost }
    // A chat that used more than one subscription is one row, its totals added up.
    val chats = all.flatMap { it.second.byChat }.groupBy { it.sessionId }
        .map { (_, rows) -> rows.reduce { a, b -> a.copy(totalTokens = a.totalTokens + b.totalTokens, listCost = a.listCost + b.listCost) } }
        .sortedByDescending { it.listCost }.take(10)
    SideBySide(
        { modifier ->
            SectionCard(
                title = "By model", contentPadding = false, modifier = modifier,
                aside = { InfoTip("Each subscription's tokens at its rates: API list prices for ClinePass and ChatGPT, the plans' own rates for OpenCode Go and Command Code.", label = "About value") },
            ) { ModelTable(models, "Value") }
        },
        { modifier -> TopChats(chats, modifier) },
    )
}

@Composable
private fun SubscriptionDetail(report: UsageReport, subscription: Subscription) {
    val usage = report.tokens(subscription)
    if (usage == null) {
        Text("Dex needs an update to report this subscription.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    Stats(listOf(
        Triple("Plan", subscription.planOf().value, subscription.planOf().detail),
        Triple("Responses", Format.compact(usage.responses), null),
        Triple("Tokens", Format.compact(usage.totalTokens), "${Format.compact(usage.inputTokens + usage.cacheReadTokens)} in · ${Format.compact(usage.outputTokens)} out"),
        Triple("Worth", Format.usd(usage.listCost), subscription.rates),
    ))
    when (subscription.id) {
        "opencode-go" -> OpenCodeAllowance(report.opencode)
        "commandcode" -> report.commandcode?.let { CommandCodeAllowance(it) }
        "openrouter" -> report.openrouter?.let { OpenRouterAccountCard(it) }
    }
    SideBySide(
        { modifier -> SectionCard(title = "By model", contentPadding = false, modifier = modifier) { ModelTable(usage.byModel.map { ModelRow(it, null) }, subscription.column) } },
        { modifier -> TopChats(usage.byChat, modifier) },
    )
}

/** OpenCode Go's allowance, read live from OpenCode. */
@Composable
private fun OpenCodeAllowance(usage: TokenUsage) {
    val openInBrowser = LocalOpenInBrowser.current
    SectionCard(
        title = "Allowance",
        info = "Go's included usage is a dollar amount per month, counted at each model's rates. Any 5 hours may use up to 20% of it and any week 50%. Read live from OpenCode.",
        aside = { TextButton(onClick = { openInBrowser("https://opencode.ai/auth") }) { Text("Console") } },
        modifier = Modifier.testTag("allowance-opencode"),
    ) {
        val limits = usage.limits
        if (limits != null) {
            WindowMeter("5-hour window", limits.rolling)
            WindowMeter("This week", limits.weekly)
            WindowMeter("This month", limits.monthly)
        } else {
            Text(usage.limitsError?.let { "Couldn't read it from OpenCode: $it" } ?: "Connect OpenCode Go in Settings to see it.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun WindowMeter(label: String, window: OpenCodeWindow) {
    Meter(
        label, window.percent,
        (if (window.limited) "Limit reached" else "${Format.jsRound(window.percent)}% used") + " · " + UsageFormat.resetsIn(window.resetsAt),
        color("opencode"), limited = window.limited,
        valueColor = if (window.limited) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Command Code's Goat allowance against what Dex used; Command Code has no API for its own meters. */
@Composable
private fun CommandCodeAllowance(usage: TokenUsage) {
    val openInBrowser = LocalOpenInBrowser.current
    val spent = usage.spent ?: return
    val limits = UsageFormat.CommandCodeLimits
    SectionCard(
        title = "Allowance",
        info = "The Goat plan includes up to ${Format.usd(limits.MONTH)} of usage a month at each model's API rates, with up to ${Format.usd(limits.FIVE_HOURS)} in any 5 hours and ${Format.usd(limits.WEEK)} in any week. These are Dex's own chats; Command Code's CLI and other clients count too, and its windows start at your first request. Studio shows the exact meters.",
        aside = { TextButton(onClick = { openInBrowser("https://commandcode.ai/usage") }) { Text("Studio") } },
        modifier = Modifier.testTag("allowance-commandcode"),
    ) {
        listOf(Triple("Last 5 hours", spent.fiveHours, limits.FIVE_HOURS), Triple("Last 7 days", spent.week, limits.WEEK), Triple("Last 30 days", spent.month, limits.MONTH)).forEach { (label, used, cap) ->
            Meter(label, used / cap * 100, "${Format.usd(used)} of ${Format.usd(cap)}", color("commandcode"))
        }
        Text("Estimated from Dex's chats only.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** OpenRouter's live numbers for the connected key: free requests today, the account's credits, and spending. */
@Composable
private fun OpenRouterAccountCard(usage: TokenUsage) {
    val openInBrowser = LocalOpenInBrowser.current
    val tint = color("openrouter")
    SectionCard(
        title = "Account",
        info = "Read live from OpenRouter for the connected key, so it counts every app that uses the key, not only Dex. Free requests reset at midnight UTC; the daily allowance is 50 until the account has bought \$10 of credits, then 1,000.",
        aside = { TextButton(onClick = { openInBrowser("https://openrouter.ai/activity") }) { Text("Activity") } },
        modifier = Modifier.testTag("account-openrouter"),
    ) {
        val account = usage.account
        if (account == null) {
            Text(usage.accountError ?: "Connect an OpenRouter key in Settings to see its numbers here.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@SectionCard
        }
        account.freeRequests?.let { Meter("Free requests today", UsageFormat.share(it.used, it.limit), UsageFormat.freeRequests(it), tint) }
        account.credits?.takeIf { it.total > 0 }?.let { Meter("Credits used", UsageFormat.share(it.used, it.total), "${Format.usd(it.used)} of ${Format.usd(it.total)}", tint) }
        account.keyLimit?.let {
            val used = it.limit - it.remaining
            Meter("This key's limit", UsageFormat.share(used, it.limit), "${Format.usd(used)} of ${Format.usd(it.limit)}", tint)
        }
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().testTag("openrouter-spent")) {
            Row(Modifier.height(IntrinsicSize.Min)) {
                listOf("Today" to account.spent.day, "This week" to account.spent.week, "This month" to account.spent.month).forEachIndexed { i, (label, value) ->
                    if (i > 0) VerticalDivider(color = MaterialTheme.colorScheme.surfaceContainerLow)
                    Column(
                        Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 10.dp).semantics(mergeDescendants = true) {},
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(Format.usd(value), style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = Tnum, fontWeight = FontWeight.SemiBold), maxLines = 1)
                        // Two lines in a narrow pane, where "This month" doesn't fit on one.
                        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 2)
                    }
                }
            }
        }
        Text("The key's spending. Free models cost nothing, so this is paid models it ran elsewhere.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Machines and Cloudflare ─────────────────────────────────────────────────

@Composable
private fun Machines(report: UsageReport) {
    val boat = report.boat
    Stats(listOf(
        Triple("VM time cost", Format.usd(boat.cost), "billed per second"),
        Triple("Hours", Format.fixed(boat.hours, 1), null),
        Triple("Runs", "${boat.runs.size}", if (boat.runs.size >= 20) "latest 20 below" else null),
        Triple("Now", if (boat.running) "Running" else "Stopped", null),
    ))
    SectionCard(
        title = "boat.dev VM runs", contentPadding = false,
        aside = {
            Text(
                boat.bySize.joinToString(" · ") { "${it.size} ${duration(it.hours)}" },
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 8.dp, end = 8.dp),
            )
        },
        modifier = Modifier.testTag("vm-runs"),
    ) {
        if (boat.runs.isEmpty()) {
            Text("The VM did not run in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            return@SectionCard
        }
        val format = remember { DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.getDefault()) }
        BoxWithConstraints {
            val size = maxWidth >= 420.dp
            NumberList(
                headers = listOfNotNull("Started", "Size".takeIf { size }, "Duration", "Cost"),
                widths = listOfNotNull(72.dp.takeIf { size }, 72.dp, 64.dp),
                rows = boat.runs.size,
                name = { i ->
                    val run = boat.runs[i]
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(Instant.ofEpochMilli(run.startedAt).atZone(ZoneId.systemDefault()).format(format), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (run.endedAt == null) Text("running", style = MaterialTheme.typography.labelSmall, color = DexTheme.colors.success)
                    }
                },
                cells = { i -> boat.runs[i].let { run -> listOfNotNull(run.size.takeIf { size }, duration(run.hours), Format.usd(run.cost)) } },
            )
        }
    }
}

@Composable
private fun CloudflareTab(report: UsageReport) {
    val cf = report.cloudflare
    val readable = cf.configured && cf.error == null
    Stats(listOf(
        Triple("Plan", "${Format.usd(UsageFormat.WORKERS_PAID_FEE)}/mo", "Workers Paid"),
        Triple("Metered", if (readable) Format.usd(cf.meteredCost) else "—", "at list rates"),
        Triple("Most used allowance", if (readable && report.range != "all") percent(cf.lines.maxOfOrNull { it.allowanceUsed ?: 0.0 }?.coerceAtLeast(0.0) ?: 0.0) else "—", null),
        Triple("Since", Format.shortDate(Instant.ofEpochMilli(cf.since).toString().take(10)), "Cloudflare keeps ~30 days"),
    ))
    SectionCard(title = "Meters", contentPadding = !readable, modifier = Modifier.testTag("cloudflare-meters")) {
        when {
            !cf.configured -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Cloudflare usage comes from its Analytics API, which needs a read-only token:", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token with Account · Account Analytics · Read", style = MaterialTheme.typography.bodySmall)
                Text("2. Run npx wrangler secret put CLOUDFLARE_API_TOKEN and paste it", style = MaterialTheme.typography.bodySmall)
            }
            cf.error != null -> Text(cf.error!!, color = DexTheme.colors.warning)
            else -> Column {
                cf.lines.forEachIndexed { i, line ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(line.label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    "${Format.compact(line.quantity)} ${line.unit}" + if (line.accountWide) " · whole account" else "",
                                    style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = Tnum), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(Format.usd(line.cost), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = Tnum))
                        }
                        line.allowanceUsed?.let { share ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                MeterBar(max(share * 100, 1.0), color("cloudflare"), height = 4.dp, modifier = Modifier.weight(1f))
                                Text("${percent(share)} of monthly allowance", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = Tnum), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
