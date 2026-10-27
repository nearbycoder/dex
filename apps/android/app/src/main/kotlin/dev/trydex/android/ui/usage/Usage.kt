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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.LocalOpenInBrowser
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.BoneRows
import dev.trydex.android.ui.components.ModelLogo
import dev.trydex.android.ui.components.PageColumn
import dev.trydex.android.ui.components.PaneScaffold
import dev.trydex.android.ui.components.SectionCard
import dev.trydex.android.ui.components.TableGrid
import dev.trydex.android.ui.components.Tone
import dev.trydex.android.ui.nav.Chat
import dev.trydex.core.model.Format
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

/** What Dex costs: plans, model tokens at list prices, VM time, and Cloudflare. */
@Composable
fun UsageScreen() {
    val app = LocalApp.current
    val repository = app.graph.repository
    val connected by repository.connected.collectAsStateWithLifecycle()
    val state by repository.state.collectAsStateWithLifecycle()
    var range by rememberSaveable { mutableStateOf("month") }
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
    PaneScaffold(title = "Usage", actions = {
        IconButton(onClick = { reload++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, contentDescription = "Refresh") }
    }, modifier = Modifier.testTag("usage")) { padding ->
        PageColumn(padding, maxWidth = 1024) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                UsageFormat.RANGES.forEachIndexed { index, (id, label) ->
                    SegmentedButton(selected = range == id, onClick = { range = id }, shape = SegmentedButtonDefaults.itemShape(index, UsageFormat.RANGES.size), modifier = Modifier.testTag("range-$id")) {
                        Text(label, maxLines = 1)
                    }
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Banner(it, tone = Tone.Error) }
            if (report == null) {
                BoneRows(10)
                return@PageColumn
            }
            val clineConnected = state?.cline?.connected ?: true
            val showCline = clineConnected || report.cline.totalTokens > 0
            val showOpenCode = report.opencode.connected || report.opencode.totalTokens > 0
            val showChatGPT = report.chatgpt.connected || report.chatgpt.totalTokens > 0
            val series = UsageFormat.SERIES.filter {
                (it.key != "cline" || showCline) && (it.key != "opencode" || showOpenCode) && (it.key != "chatgpt" || showChatGPT)
            }
            Tiles(report, range == "month", clineConnected, showCline, showOpenCode, showChatGPT)
            DailyUsage(report, series)
            BoxWithConstraints {
                val two = maxWidth >= 840.dp
                val blocks = buildList<@Composable () -> Unit> {
                    if (showOpenCode) add { Allowance(report.opencode) }
                    if (showOpenCode) add { ModelUsage("OpenCode Go by model", Color(0xFFC98500), "At Go rates", report.opencode) }
                    if (showCline) add { ModelUsage("ClinePass by model", Color(0xFF3987E5), "List price", report.cline) }
                    if (showChatGPT) add { ModelUsage("ChatGPT by model", Color(0xFFD55181), "List price", report.chatgpt) }
                    add { Vms(report) }
                }
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (two) blocks.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { pair.forEach { Box(Modifier.weight(1f)) { it() } }; if (pair.size == 1) Box(Modifier.weight(1f)) }
                    } else blocks.forEach { it() }
                }
            }
            Cloudflare(report)
            Text(
                "Estimates from Dex's own records (model responses, VM run times) and Cloudflare's analytics, priced at public list rates (ClinePass \$9.99/mo, OpenCode Go \$10.00/mo, Workers Paid \$5.00/mo, boat.dev small \$0.018/h). Your invoices are the source of truth. VM time before usage tracking started is not included.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Swatch(color: Color) {
    Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(color))
}

@Composable
private fun Tiles(report: UsageReport, month: Boolean, clineConnected: Boolean, showCline: Boolean, showOpenCode: Boolean, showChatGPT: Boolean) {
    val plans = UsageFormat.WORKERS_PAID_FEE + (if (clineConnected) UsageFormat.CLINE_PASS_FEE else 0.0) + (if (report.opencode.connected) UsageFormat.OPENCODE_GO_FEE else 0.0)
    val tiles = buildList<Triple<Color?, Pair<String, String>, List<String>>> {
        add(Triple(null, (if (month) "Estimated bill this month" else "Variable spend") to Format.usd(if (month) plans + report.boat.cost else report.boat.cost),
            listOf(if (month) "Plans ${Format.usd(plans)} + boat.dev ${Format.usd(report.boat.cost)}" else "boat.dev VM time. Plans add ${Format.usd(plans)}/month.")))
        if (showCline) add(Triple(Color(0xFF3987E5), "ClinePass" to "\$9.99/mo", listOf("${Format.compact(report.cline.totalTokens)} tokens · ${Format.usd(report.cline.listCost)} at list prices")))
        if (showOpenCode) add(Triple(Color(0xFFC98500), "OpenCode Go" to "\$10.00/mo", listOfNotNull(
            "${Format.compact(report.opencode.totalTokens)} tokens · ${Format.usd(report.opencode.listCost)} at Go rates",
            report.opencode.limits?.let { "${Format.jsRound(it.monthly.percent)}% of this month's allowance" },
        )))
        if (showChatGPT) add(Triple(Color(0xFFD55181), "ChatGPT" to "${Format.compact(report.chatgpt.totalTokens)} tokens", listOf(
            "${Format.usd(report.chatgpt.listCost)} at list prices · on your ChatGPT plan, not in the estimate",
        )))
        add(Triple(Color(0xFFD95926), "boat.dev" to Format.usd(report.boat.cost), listOf("${Format.fixed(report.boat.hours, 1)} h of VM time" + if (report.boat.running) " · running now" else "")))
        add(Triple(Color(0xFF199E70), "Cloudflare" to "\$5.00/mo", listOf(when {
            !report.cloudflare.configured -> "Add an analytics token to see usage"
            report.cloudflare.error != null -> "Analytics unavailable right now"
            else -> "${Format.usd(report.cloudflare.meteredCost)} of metered usage, inside the plan's included allowance"
        })))
    }
    BoxWithConstraints {
        val columns = when {
            maxWidth >= 1000.dp -> tiles.size
            maxWidth >= 560.dp -> 2
            else -> 1
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            tiles.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { (color, head, detail) ->
                        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.weight(1f).testTag("tile-${head.first}")) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (color != null) Swatch(color) else Icon(Icons.Outlined.BarChart, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Text(head.first, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                                    if (columns == 1) Text(head.second, style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"))
                                }
                                if (columns > 1) Text(head.second, style = MaterialTheme.typography.headlineSmall.copy(fontFeatureSettings = "tnum", fontWeight = FontWeight.SemiBold))
                                detail.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                    repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun DailyUsage(report: UsageReport, series: List<UsageFormat.Series>) {
    var table by rememberSaveable { mutableStateOf(false) }
    SectionCard(
        title = "Daily usage",
        info = "ClinePass and ChatGPT are shown at what their tokens would cost at API list prices and OpenCode Go at Go's rates; you pay their flat plans. Cloudflare is metered usage at list rates, before the plan's included allowance.",
        aside = {
            TextButton(onClick = { table = !table }, modifier = Modifier.testTag("usage-toggle")) {
                Icon(if (table) Icons.Outlined.BarChart else Icons.Outlined.TableChart, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(if (table) "Chart" else "Table", modifier = Modifier.padding(start = 6.dp))
            }
        },
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            series.forEach { s ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Swatch(Color(s.color))
                    Text(s.label, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        if (table) DailyTable(report, series) else DailyChart(report, series)
    }
}

@Composable
private fun DailyChart(report: UsageReport, series: List<UsageFormat.Series>) {
    val days = report.daily
    var selected by remember(days) { mutableStateOf<Int?>(null) }
    val measurer = rememberTextMeasurer()
    val label = TextStyle(fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val grid = MaterialTheme.colorScheme.outlineVariant
    val totals = days.map { day -> series.sumOf { day.value(it.key) } }
    val niceMax = UsageFormat.niceMax(totals.maxOrNull() ?: 0.0)
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().testTag("usage-chart")) {
        val widthPx = with(density) { maxWidth.toPx() }
        val left = with(density) { 44.dp.toPx() }
        val plotW = max(1f, widthPx - with(density) { 48.dp.toPx() })
        val slot = plotW / max(1, days.size)
        Canvas(
            Modifier.fillMaxWidth().height(200.dp)
                .semantics { contentDescription = "Daily spend, ${days.size} days" }
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
                            Swatch(Color(s.color))
                            Text(s.label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                            Text(Format.usd(day.value(s.key)), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"))
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.2f))
                    Row {
                        Text("Total", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        Text(Format.usd(totals[i]), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"))
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
        SimpleTable(headers, rows.map { day -> listOf(Format.shortDate(day.date)) + series.map { Format.usd(day.value(it.key)) } + Format.usd(series.sumOf { day.value(it.key) }) })
    }
}

/** A plain table: a header row and text cells, numbers right-aligned. */
@Composable
private fun SimpleTable(headers: List<String>, rows: List<List<String>>, first: (@Composable (Int) -> Unit)? = null) {
    TableGrid(
        rows = rows.size + 1,
        columns = headers.size,
        rowBackground = { r ->
            Box(Modifier.background(if (r == 0) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent))
        },
    ) { r, c ->
        Box(Modifier.padding(horizontal = 12.dp, vertical = 8.dp).widthIn(min = if (c == 0) 72.dp else 64.dp)) {
            when {
                r == 0 -> Text(headers[c], style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                c == 0 && first != null -> first(r - 1)
                else -> Text(rows[r - 1][c], style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), textAlign = if (c > 0) TextAlign.End else TextAlign.Start, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Allowance(usage: TokenUsage) {
    val openInBrowser = LocalOpenInBrowser.current
    SectionCard(title = "OpenCode Go allowance", info = "Go's included usage is a dollar amount per month, counted at each model's rates. Any 5 hours may use up to 20% of it and any week 50%. Read live from OpenCode.", aside = {
        TextButton(onClick = { openInBrowser("https://opencode.ai/auth") }) { Text("Console") }
    }) {
        val limits = usage.limits
        if (limits != null) {
            AllowanceBar("5-hour window", limits.rolling)
            AllowanceBar("This week", limits.weekly)
            AllowanceBar("This month", limits.monthly)
        } else {
            Text(usage.limitsError?.let { "Couldn't read it from OpenCode: $it" } ?: "Connect OpenCode Go in Settings to see it.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AllowanceBar(label: String, window: OpenCodeWindow) {
    val percent = window.percent.coerceIn(0.0, 100.0)
    val tone = when {
        window.limited || percent >= 100 -> MaterialTheme.colorScheme.error
        percent >= 80 -> dev.trydex.android.ui.theme.DexTheme.colors.warning
        else -> Color(0xFFC98500)
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics { contentDescription = "$label: ${Format.jsRound(percent)}% used" }) {
        Row {
            Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Text(
                (if (window.limited) "Limit reached" else "${Format.jsRound(percent)}% used") + " · " + UsageFormat.resetsIn(window.resetsAt),
                style = MaterialTheme.typography.labelMedium,
                color = if (window.limited) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LinearProgressIndicator(
            progress = { (max(percent, if (percent > 0) 2.0 else 0.0) / 100).toFloat() },
            color = tone, trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
            modifier = Modifier.fillMaxWidth().height(8.dp),
        )
    }
}

@Composable
private fun ModelUsage(title: String, color: Color, costLabel: String, usage: TokenUsage) {
    val app = LocalApp.current
    SectionCard(title = title, aside = {
        Swatch(color)
        Text(" ${Format.compact(usage.totalTokens)} tokens", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp)) }) {
        if (usage.byModel.isEmpty()) Text("No model usage in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else Box(Modifier.horizontalScroll(rememberScrollState())) {
            SimpleTable(
                listOf("Model", "Responses", "Tokens", costLabel),
                usage.byModel.map { listOf(it.model, "${it.responses}", Format.compact(it.totalTokens), Format.usd(it.listCost)) },
                first = { i ->
                    val row = usage.byModel[i]
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        ModelLogo(row.model, app.graph.models, size = 16.dp)
                        Text(app.graph.models.find(row.model)?.name ?: row.model, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                },
            )
        }
        if (usage.byChat.isNotEmpty()) {
            Text("Top chats", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            usage.byChat.forEach { chat ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val deleted = chat.title == "Deleted chat"
                    Text(
                        chat.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (deleted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f).then(if (deleted) Modifier else Modifier.clickable { app.navigator.open(Chat(chat.sessionId)) }),
                    )
                    Text("${Format.compact(chat.totalTokens)} · ${Format.usd(chat.listCost)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun Vms(report: UsageReport) {
    val boat = report.boat
    SectionCard(title = "boat.dev VM time", aside = { Text("billed per second", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp)) }) {
        if (boat.runs.isEmpty()) {
            Text("The VM did not run in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@SectionCard
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            boat.bySize.forEach { FilterChip(selected = false, onClick = {}, label = { Text("${it.size} · ${Format.fixed(it.hours, 1)} h · ${Format.usd(it.cost)}") }) }
        }
        val format = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.getDefault())
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            SimpleTable(listOf("Started", "Duration", "Cost"), boat.runs.map { run ->
                listOf(
                    Instant.ofEpochMilli(run.startedAt).atZone(ZoneId.systemDefault()).format(format) + if (run.endedAt == null) " running" else "",
                    if (run.hours < 1) "${Format.jsRound(run.hours * 60)} min" else "${Format.fixed(run.hours, 1)} h",
                    Format.usd(run.cost),
                )
            })
        }
    }
}

@Composable
private fun Cloudflare(report: UsageReport) {
    val cf = report.cloudflare
    SectionCard(title = "Cloudflare", aside = {
        if (cf.configured) Text("since ${Format.shortDate(Instant.ofEpochMilli(cf.since).toString().take(10))}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp))
    }) {
        when {
            !cf.configured -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Cloudflare usage comes from its Analytics API, which needs a read-only token:")
                Text("1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token with Account · Account Analytics · Read", style = MaterialTheme.typography.bodySmall)
                Text("2. Run npx wrangler secret put CLOUDFLARE_API_TOKEN and paste it", style = MaterialTheme.typography.bodySmall)
            }
            cf.error != null -> Text(cf.error!!, color = dev.trydex.android.ui.theme.DexTheme.colors.warning)
            else -> Box(Modifier.horizontalScroll(rememberScrollState())) {
                SimpleTable(listOf("Meter", "Used", "Of monthly allowance", "At list rate"), cf.lines.map { line ->
                    listOf(
                        line.label + if (line.accountWide) " (whole account)" else "",
                        "${Format.compact(line.quantity)} ${line.unit}",
                        line.allowanceUsed?.let { if (it < 0.001) "<0.1%" else "${Format.fixed(it * 100, 1)}%" } ?: "",
                        Format.usd(line.cost),
                    )
                })
            }
        }
    }
}
