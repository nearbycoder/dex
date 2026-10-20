package dev.trydex.android.ui.openui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trydex.openui.ElementNode
import dev.trydex.openui.Js
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt

// ── Data ─────────────────────────────────────────────────────────────────────

/** OpenUI's chart palette (OCEAN_DEFAULT), the same in light and dark. */
val CHART_PALETTE = listOf(
    0xFF0D47A1, 0xFF1565C0, 0xFF1976D2, 0xFF1E88E5, 0xFF2196F3, 0xFF42A5F5, 0xFF64B5F6, 0xFF90CAF9, 0xFFBBDEFB, 0xFFE3F2FD, 0xFFEFF8FF,
).map { Color(it) }

/** Colours for `count` series, from the middle of the palette outwards (getDistributedColors). */
fun chartColors(count: Int): List<Color> {
    val n = CHART_PALETTE.size
    val mid = n / 2
    return when (count) {
        0 -> emptyList()
        1 -> listOf(CHART_PALETTE[mid])
        2 -> listOf(CHART_PALETTE[mid - 1], CHART_PALETTE[mid + 1])
        else -> {
            val offset = (count - 1) / 2
            List(count) { i -> CHART_PALETTE[((mid + i - offset) % n + n) % n] }
        }
    }
}

@Immutable
data class ChartSeries(val name: String, val values: List<Double>, val color: Color)

@Immutable
data class ChartData(val categories: List<String>, val series: List<ChartSeries>)

private fun num(value: Any?): Double = Js.toNumber(value).let { if (it.isNaN()) 0.0 else it }

/** labels + Series(…) → rows (buildChartData), or query rows `[cat, v1, v2…]` with column names as labels. */
fun buildChartData(labelsRaw: Any?, seriesRaw: Any?): ChartData? {
    val labels = (labelsRaw as? List<*>) ?: return null
    val series = (seriesRaw as? List<*>) ?: return null
    if (series.firstOrNull() is List<*>) {
        val names = labels.drop(1).map { cellText(it) }
        val rows = series.mapNotNull { it as? List<*> }
        if (rows.isEmpty()) return null
        val colors = chartColors(names.size)
        return ChartData(
            rows.map { cellText(it.firstOrNull()) },
            names.mapIndexed { i, name -> ChartSeries(name, rows.map { row -> num(row.getOrNull(i + 1)) }, colors[i]) },
        )
    }
    if (labels.isEmpty()) return null
    // Later series with the same name replace earlier ones; one with no first value is left out.
    val byName = LinkedHashMap<String, List<Any?>>()
    for (s in series) {
        val node = s as? ElementNode ?: continue
        val category = node.props["category"] as? String ?: continue
        val values = node.props["values"] as? List<*> ?: continue
        if (values.isEmpty()) continue
        byName[category] = values
    }
    val colors = chartColors(byName.size)
    return ChartData(
        labels.map { cellText(it) },
        byName.entries.mapIndexed { i, (name, values) -> ChartSeries(name, labels.indices.map { num(values.getOrNull(it)) }, colors[i]) },
    )
}

/** labels + values for one-dimensional charts, or legacy Slice(…) elements. */
fun buildSlices(labelsRaw: Any?, valuesRaw: Any?): List<Pair<String, Double>>? {
    val labels = labelsRaw as? List<*> ?: return null
    val values = valuesRaw as? List<*>
    if (labels.isNotEmpty() && !values.isNullOrEmpty()) return labels.mapIndexed { i, label -> cellText(label) to ((values.getOrNull(i) as? Double) ?: 0.0) }
    val slices = labels.filterIsInstance<ElementNode>().filter { it.typeName == "Slice" }
    if (slices.isNotEmpty()) return slices.map { cellText(it.props["category"]) to num(it.props["value"]) }
    return null
}

// ── Scales and formats ───────────────────────────────────────────────────────

private val E10 = sqrt(50.0)
private val E5 = sqrt(10.0)
private val E2 = sqrt(2.0)

/** d3's tick step for a domain and a tick count. */
private fun tickStep(start: Double, stop: Double, count: Int): Double {
    val step = (stop - start) / max(1, count)
    if (step <= 0 || !step.isFinite()) return 0.0
    val power = floor(ln(step) / ln(10.0))
    val error = step / 10.0.pow(power)
    val factor = when {
        error >= E10 -> 10.0
        error >= E5 -> 5.0
        error >= E2 -> 2.0
        else -> 1.0
    }
    return factor * 10.0.pow(power)
}

/** A linear scale's domain widened to round ticks (d3 `.nice()`), and its ticks. */
@Immutable
data class Scale(val min: Double, val max: Double, val ticks: List<Double>) {
    fun fraction(value: Double) = if (max == min) 0.5f else ((value - min) / (max - min)).toFloat()

    companion object {
        fun nice(low: Double, high: Double, count: Int): Scale {
            var start = low
            var stop = high
            if (start == stop) return Scale(start, stop, listOf(start))
            var previous = 0.0
            repeat(10) {
                val step = tickStep(start, stop, count)
                if (step == previous || step == 0.0) return@repeat
                start = floor(start / step) * step
                stop = ceil(stop / step) * step
                previous = step
            }
            val step = tickStep(start, stop, count)
            val ticks = if (step == 0.0) listOf(start) else {
                val first = ceil(start / step).toLong()
                val last = floor(stop / step).toLong()
                (first..last).map { BigDecimal(it).multiply(BigDecimal(step.toString())).toDouble() }
            }
            return Scale(start, stop, ticks)
        }
    }
}

/** Axis labels: 1.5K, 2.0K, 10K, 3M; small integers as they are, other values to two places. */
fun tickLabel(value: Double): String {
    val a = abs(value)
    for ((unit, suffix) in listOf(1e12 to "T", 1e9 to "B", 1e6 to "M", 1e3 to "K")) {
        if (a >= unit) {
            val scaled = value / unit
            return (if (abs(scaled) < 10) fixed(scaled, 1) else fixed(scaled, 0)) + suffix
        }
    }
    return if (value == floor(value)) Js.numberToString(value) else fixed(value, 2)
}

private fun fixed(value: Double, places: Int) = BigDecimal(value.toString()).setScale(places, RoundingMode.HALF_UP).toPlainString()

/** Tooltip values: grouped digits under 100,000, then 123.4K, 1.9M (floored). */
fun tooltipValue(value: Double): String {
    val a = abs(value)
    if (a < 100_000) return NumberFormat.getNumberInstance().apply { maximumFractionDigits = 3 }.format(value)
    var scaled = a
    var index = -1
    val suffixes = listOf("K", "M", "B", "T")
    while (scaled >= 1000 && index < suffixes.lastIndex) {
        scaled /= 1000
        index++
    }
    val text = BigDecimal.valueOf(floor(scaled * 10) / 10).setScale(1, RoundingMode.DOWN).toPlainString() + suffixes[index]
    return if (value < 0) "-$text" else text
}

private fun percent(value: Double, total: Double) = if (total <= 0) "0.0%" else fixed(value / total * 100, 1) + "%"

// ── Shared pieces ────────────────────────────────────────────────────────────

@Immutable
private data class TipLine(val name: String, val value: String, val color: Color)

@Composable
private fun ChartTooltip(title: String, lines: List<TipLine>, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
        shadowElevation = 3.dp,
        modifier = modifier.widthIn(min = 128.dp, max = 240.dp),
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            lines.take(if (lines.size > 10) 5 else lines.size).forEach { line ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(line.color))
                    Text(line.name, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(line.value, style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"))
                }
            }
            if (lines.size > 10) Text("and ${lines.size - 5} more", style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** The series legend: tap one to hide or show it (the last one stays). */
@Composable
private fun Legend(items: List<Pair<String, Color>>, hidden: Set<Int>, onToggle: ((Int) -> Unit)?, extra: (Int) -> String? = { null }) {
    var expanded by remember { mutableStateOf(false) }
    val limit = 8
    val shown = if (expanded || items.size <= limit) items else items.take(limit)
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        shown.forEachIndexed { index, (name, color) ->
            Row(
                Modifier.clip(RoundedCornerShape(6.dp))
                    .then(if (onToggle != null) Modifier.clickable { onToggle(index) } else Modifier)
                    .alpha(if (index in hidden) 0.3f else 1f)
                    .padding(horizontal = 2.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(color))
                Text(name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
                extra(index)?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        if (items.size > limit) {
            TextButton(onClick = { expanded = !expanded }, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp)) {
                Text(if (expanded) "Show less" else "${items.size - limit} more", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

private fun toggle(hidden: Set<Int>, index: Int, count: Int): Set<Int> = when {
    index in hidden -> hidden - index
    hidden.size + 1 >= count -> hidden
    else -> hidden + index
}

@Composable
private fun chartTextStyle() = TextStyle(fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

private fun DrawScope.label(measurer: TextMeasurer, text: String, style: TextStyle, x: Float, y: Float, maxWidth: Int, anchor: Float = 0.5f) {
    if (maxWidth <= 0) return
    val layout = measurer.measure(text, style, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = Constraints(maxWidth = maxWidth))
    drawText(layout, topLeft = Offset((x - layout.size.width * anchor).coerceIn(0f, max(0f, size.width - layout.size.width)), y))
}

/**
 * Where a finger points at a chart: a tap picks a spot, and with [sideways] a horizontal drag scrubs (vertical drags
 * keep scrolling the chat). The spot stays picked after the finger lifts, so its tooltip can be read.
 */
private fun Modifier.track(sideways: Boolean = false, onMove: (Offset?) -> Unit): Modifier = this
    .pointerInput(Unit) { detectTapGestures(onTap = { onMove(it) }) }
    .then(
        if (sideways) Modifier.pointerInput(Unit) {
            detectHorizontalDragGestures(onDragStart = { onMove(it) }) { change, _ -> onMove(change.position) }
        } else Modifier,
    )

// ── Curves ───────────────────────────────────────────────────────────────────

/** A line through points: straight, monotone (OpenUI's "natural"), or stepped at the midpoints. */
private fun curve(points: List<Offset>, variant: String?, path: Path = Path(), moveFirst: Boolean = true): Path {
    if (points.isEmpty()) return path
    if (moveFirst) path.moveTo(points[0].x, points[0].y) else path.lineTo(points[0].x, points[0].y)
    when (variant) {
        "linear" -> points.drop(1).forEach { path.lineTo(it.x, it.y) }
        "step" -> for (i in 1 until points.size) {
            val mid = (points[i - 1].x + points[i].x) / 2
            path.lineTo(mid, points[i - 1].y)
            path.lineTo(mid, points[i].y)
            path.lineTo(points[i].x, points[i].y)
        }
        else -> monotone(points, path)
    }
    return path
}

/** d3's curveMonotoneX: a cubic through each point that never overshoots. */
private fun monotone(points: List<Offset>, path: Path) {
    val n = points.size
    if (n < 3) {
        points.drop(1).forEach { path.lineTo(it.x, it.y) }
        return
    }
    val tangents = DoubleArray(n)
    fun slope3(i: Int): Double {
        val (x0, y0) = points[i - 1].let { it.x.toDouble() to it.y.toDouble() }
        val (x1, y1) = points[i].let { it.x.toDouble() to it.y.toDouble() }
        val (x2, y2) = points[i + 1].let { it.x.toDouble() to it.y.toDouble() }
        val h0 = x1 - x0
        val h1 = x2 - x1
        if (h0 == 0.0 || h1 == 0.0) return 0.0
        val s0 = (y1 - y0) / h0
        val s1 = (y2 - y1) / h1
        val p = (s0 * h1 + s1 * h0) / (h0 + h1)
        return ((sign(s0) + sign(s1)) * min(min(abs(s0), abs(s1)), 0.5 * abs(p))).let { if (it.isNaN()) 0.0 else it }
    }
    for (i in 1 until n - 1) tangents[i] = slope3(i)
    fun slope2(i0: Int, i1: Int, t: Double): Double {
        val h = (points[i1].x - points[i0].x).toDouble()
        return if (h != 0.0) (3 * (points[i1].y - points[i0].y) / h - t) / 2 else t
    }
    tangents[0] = slope2(0, 1, tangents[1])
    tangents[n - 1] = slope2(n - 2, n - 1, tangents[n - 2])
    for (i in 1 until n) {
        val p0 = points[i - 1]
        val p1 = points[i]
        val dx = (p1.x - p0.x) / 3
        path.cubicTo(p0.x + dx, (p0.y + dx * tangents[i - 1]).toFloat(), p1.x - dx, (p1.y - dx * tangents[i]).toFloat(), p1.x, p1.y)
    }
}

private fun DrawScope.bar(color: Color, left: Float, top: Float, width: Float, height: Float, roundTop: Boolean, roundBottom: Boolean, radius: Float, line: Color?) {
    if (height <= 0 || width <= 0) return
    val r = if (height < 7f || width < 2f) 0f else min(radius, min(width / 2, height / 2))
    val path = Path().apply {
        addRoundRect(
            RoundRect(
                Rect(left, top, left + width, top + height),
                topLeft = CornerRadius(if (roundTop) r else 0f), topRight = CornerRadius(if (roundTop) r else 0f),
                bottomLeft = CornerRadius(if (roundBottom) r else 0f), bottomRight = CornerRadius(if (roundBottom) r else 0f),
            ),
        )
    }
    drawPath(path, color)
    if (line != null && height >= 8f * density && width >= 3f * density) {
        val x = left + width / 2
        drawLine(line, Offset(x, top + 6 * density), Offset(x, top + height - 6 * density), strokeWidth = density, cap = StrokeCap.Round)
    }
}

// ── Bar, line and area ───────────────────────────────────────────────────────

private enum class Cartesian { Bar, Line, Area }

@Composable
fun BarChart(node: ElementNode) {
    val p = node.p
    val data = buildChartData(p["labels"], p["series"]) ?: return
    CartesianChart(Cartesian.Bar, data, p.str("variant") ?: "grouped", p.str("xLabel"), p.str("yLabel"), p.num("height"))
}

@Composable
fun LineChart(node: ElementNode, area: Boolean) {
    val p = node.p
    val data = buildChartData(p["labels"], p["series"]) ?: return
    CartesianChart(if (area) Cartesian.Area else Cartesian.Line, data, p.str("variant") ?: "natural", p.str("xLabel"), p.str("yLabel"), p.num("height"))
}

@Composable
private fun CartesianChart(kind: Cartesian, data: ChartData, variant: String, xLabel: String?, yLabel: String?, height: Double?) {
    if (data.categories.isEmpty() || data.series.isEmpty()) return
    var hidden by remember(data.series.size) { mutableStateOf(emptySet<Int>()) }
    var touch by remember { mutableStateOf<Offset?>(null) }
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outlineVariant
    val highlight = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f)
    val surface = MaterialTheme.colorScheme.surface
    val stacked = kind == Cartesian.Area || (kind == Cartesian.Bar && variant == "stacked")
    val visible = data.series.withIndex().filter { it.index !in hidden }
    val n = data.categories.size

    // The value range: zero-anchored; stacks use their running totals.
    val (low, high) = run {
        var lo = 0.0
        var hi = 0.0
        for (i in 0 until n) {
            if (stacked && kind == Cartesian.Area) {
                var total = 0.0
                for (s in visible) { total += s.value.values[i]; lo = min(lo, total); hi = max(hi, total) }
            } else if (stacked) {
                var pos = 0.0
                var neg = 0.0
                for (s in visible) { val v = s.value.values[i]; if (v >= 0) pos += v else neg += v }
                lo = min(lo, neg); hi = max(hi, pos)
            } else {
                for (s in visible) { lo = min(lo, s.value.values[i]); hi = max(hi, s.value.values[i]) }
            }
        }
        lo to hi
    }
    val total = (height ?: 296.0).dp
    val density = LocalDensity.current
    val innerH = total - 40.dp
    val scale = remember(low, high, innerH) { Scale.nice(low, high, max(2, (innerH.value / 40).toInt())) }
    val tickLabels = scale.ticks.map { tickLabel(it) }
    val yAxis = with(density) {
        val widest = tickLabels.maxOfOrNull { measurer.measure(it, style).size.width } ?: 0
        (widest + 10.dp.roundToPx()).coerceIn(20.dp.roundToPx(), 200.dp.roundToPx()).toFloat()
    }

    Column(Modifier.fillMaxWidth().testTag("openui-chart").semantics { contentDescription = "Chart: " + data.series.joinToString { it.name } }) {
        if (!yLabel.isNullOrEmpty()) Text(yLabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val widthPx = with(density) { maxWidth.toPx() }
            val plotW = widthPx - yAxis
            val slot = plotW / n
            val selected = touch?.let { t -> ((t.x - yAxis) / slot).toInt().coerceIn(0, n - 1) }
            Canvas(Modifier.fillMaxWidth().height(total).track(sideways = true) { touch = it }) {
                val top = 10.dp.toPx()
                val plotH = innerH.toPx()
                fun y(v: Double) = top + plotH * (1 - scale.fraction(v))
                // Grid and y ticks
                scale.ticks.forEachIndexed { i, tick ->
                    val ty = y(tick)
                    val solid = tick == 0.0 && scale.min < 0
                    drawLine(grid, Offset(yAxis, ty), Offset(size.width, ty), strokeWidth = 1f, pathEffect = if (solid) null else PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())))
                    val layout = measurer.measure(tickLabels[i], style)
                    drawText(layout, topLeft = Offset(yAxis - 8.dp.toPx() - layout.size.width, ty - layout.size.height / 2))
                }
                // X labels, thinned so they don't collide
                val widest = data.categories.maxOf { measurer.measure(it, style).size.width.toFloat() }
                val interval = max(1, ceil((min(widest, 40.dp.toPx()) + 8.dp.toPx()) / slot).toInt())
                for (i in 0 until n step interval) {
                    label(measurer, data.categories[i], style, yAxis + slot * (i + 0.5f), top + plotH + 4.dp.toPx(), (slot * interval - 8.dp.toPx()).toInt())
                }
                if (selected != null) {
                    drawRoundRect(highlight, Offset(yAxis + slot * selected, top - 6.dp.toPx()), Size(slot, plotH + 6.dp.toPx()), CornerRadius(4.dp.toPx()))
                }
                when (kind) {
                    Cartesian.Bar -> {
                        val bw = 0.8f * slot
                        val zero = y(0.0)
                        val maxBar = 16.dp.toPx()
                        for (i in 0 until n) {
                            val bandX = yAxis + 0.1f * slot + i * slot
                            if (stacked) {
                                val w = min(bw, maxBar)
                                val x = bandX + (bw - w) / 2
                                var pos = 0.0
                                var neg = 0.0
                                val lastPos = visible.lastOrNull { it.value.values[i] > 0 }?.index
                                val lastNeg = visible.lastOrNull { it.value.values[i] < 0 }?.index
                                for (s in visible) {
                                    val v = s.value.values[i]
                                    if (v == 0.0) continue
                                    if (v > 0) {
                                        val y0 = y(pos); val y1 = y(pos + v)
                                        bar(s.value.color, x, y1, w, y0 - y1, roundTop = s.index == lastPos, roundBottom = false, radius = 4.dp.toPx(), line = Color.White.copy(alpha = 0.3f))
                                        pos += v
                                    } else {
                                        val y0 = y(neg); val y1 = y(neg + v)
                                        bar(s.value.color, x, y0, w, y1 - y0, roundTop = false, roundBottom = s.index == lastNeg, radius = 4.dp.toPx(), line = Color.White.copy(alpha = 0.3f))
                                        neg += v
                                    }
                                }
                            } else {
                                val m = visible.size
                                val innerStep = bw / (m + 0.05f)
                                val innerBw = 0.95f * innerStep
                                val w = min(innerBw, maxBar)
                                visible.forEachIndexed { j, s ->
                                    val v = s.value.values[i]
                                    val x = bandX + 0.05f * innerStep + j * innerStep + (innerBw - w) / 2
                                    val yv = y(v)
                                    if (v >= 0) bar(s.value.color, x, yv, w, zero - yv, roundTop = true, roundBottom = false, radius = 4.dp.toPx(), line = Color.White.copy(alpha = 0.3f))
                                    else bar(s.value.color, x, zero, w, yv - zero, roundTop = false, roundBottom = true, radius = 4.dp.toPx(), line = Color.White.copy(alpha = 0.3f))
                                }
                            }
                        }
                    }
                    Cartesian.Line, Cartesian.Area -> {
                        val xs = List(n) { yAxis + slot * (it + 0.5f) }
                        var below = List(n) { 0.0 }
                        for (s in visible) {
                            val values = if (kind == Cartesian.Area) s.value.values.mapIndexed { i, v -> below[i] + v } else s.value.values
                            val points = xs.mapIndexed { i, x -> Offset(x, y(values[i])) }
                            if (kind == Cartesian.Area) {
                                val floor = xs.mapIndexed { i, x -> Offset(x, y(below[i])) }.reversed()
                                val fill = curve(points, variant)
                                curve(floor, variant, fill, moveFirst = false)
                                fill.close()
                                val bounds = fill.getBounds()
                                drawPath(fill, Brush.verticalGradient(listOf(s.value.color.copy(alpha = 0.6f), s.value.color.copy(alpha = 0f)), startY = bounds.top, endY = bounds.bottom))
                            }
                            drawPath(curve(points, variant), s.value.color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
                            if (selected != null) {
                                drawCircle(surface, 4.dp.toPx(), points[selected])
                                drawCircle(grid, 4.dp.toPx(), points[selected], style = Stroke(1f))
                                drawCircle(s.value.color, 2.dp.toPx(), points[selected])
                            }
                            below = values
                        }
                    }
                }
            }
            if (selected != null) {
                val x = with(density) { (yAxis + slot * (selected + 0.5f)).toDp() }
                ChartTooltip(
                    data.categories[selected],
                    visible.map { TipLine(it.value.name, tooltipValue(it.value.values[selected]), it.value.color) },
                    Modifier.offset { IntOffset(((x + 20.dp).roundToPx()).coerceAtMost((maxWidth - 140.dp).roundToPx()).coerceAtLeast(0), 0) },
                )
            }
        }
        if (!xLabel.isNullOrEmpty()) Text(xLabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterHorizontally))
        Legend(data.series.map { it.name to it.color }, hidden, { hidden = toggle(hidden, it, data.series.size) })
    }
}

// ── Horizontal bars ──────────────────────────────────────────────────────────

@Composable
fun HorizontalBarChart(node: ElementNode) {
    val p = node.p
    val data = buildChartData(p["labels"], p["series"]) ?: return
    if (data.categories.isEmpty() || data.series.isEmpty()) return
    val stacked = p.str("variant") == "stacked"
    var hidden by remember(data.series.size) { mutableStateOf(emptySet<Int>()) }
    var touch by remember { mutableStateOf<Offset?>(null) }
    val visible = data.series.withIndex().filter { it.index !in hidden }
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outlineVariant
    val highlight = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f)
    val n = data.categories.size
    var lo = 0.0
    var hi = 0.0
    for (i in 0 until n) {
        if (stacked) {
            var pos = 0.0; var neg = 0.0
            visible.forEach { val v = it.value.values[i].takeIf { v -> v.isFinite() } ?: 0.0; if (v >= 0) pos += v else neg += v }
            lo = min(lo, neg); hi = max(hi, pos)
        } else visible.forEach { val v = it.value.values[i].takeIf { v -> v.isFinite() } ?: 0.0; lo = min(lo, v); hi = max(hi, v) }
    }
    val m = visible.size
    val groupH = (if (stacked) 16 else m * 26 - 10) + 24 + 16
    val contentH = (groupH * n + 20).dp
    Column(Modifier.fillMaxWidth().testTag("openui-chart")) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val density = LocalDensity.current
            val widthPx = with(density) { maxWidth.toPx() }
            val scale = remember(lo, hi, widthPx) { Scale.nice(lo, hi, max(2, (widthPx / with(density) { 60.dp.toPx() }).toInt())) }
            val selected = touch?.let { t -> with(density) { ((t.y - 10.dp.toPx()) / groupH.dp.toPx()).toInt() }.coerceIn(0, n - 1) }
            Column {
                Box(Modifier.fillMaxWidth().heightIn(max = 256.dp).verticalScroll(rememberScrollState())) {
                    Canvas(Modifier.fillMaxWidth().height(contentH).track { touch = it }) {
                        val left = 2.dp.toPx()
                        val w = size.width - 4.dp.toPx()
                        fun x(v: Double) = left + w * scale.fraction(v)
                        scale.ticks.forEach { t -> drawLine(grid, Offset(x(t), 0f), Offset(x(t), size.height), 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))) }
                        for (i in 0 until n) {
                            val top = 10.dp.toPx() + i * groupH.dp.toPx()
                            if (selected == i) drawRoundRect(highlight, Offset(0f, top), Size(size.width, groupH.dp.toPx()), CornerRadius(4.dp.toPx()))
                            label(measurer, data.categories[i], style, 12.dp.toPx(), top + 4.dp.toPx(), (size.width - 12.dp.toPx()).toInt(), anchor = 0f)
                            val barsTop = top + 24.dp.toPx()
                            val dim = selected != null && selected != i
                            if (stacked) {
                                var pos = 0.0; var neg = 0.0
                                for (s in visible) {
                                    val v = s.value.values[i].takeIf { it.isFinite() } ?: 0.0
                                    if (v == 0.0) continue
                                    val from = if (v > 0) pos else neg
                                    val to = from + v
                                    val a = x(min(from, to)); val b = x(max(from, to))
                                    drawRoundRect(s.value.color.copy(alpha = if (dim) 0.4f else 1f), Offset(a, barsTop), Size(b - a, 16.dp.toPx()), CornerRadius(4.dp.toPx()))
                                    if (v > 0) pos = to else neg = to
                                }
                            } else {
                                visible.forEachIndexed { j, s ->
                                    val v = s.value.values[i].takeIf { it.isFinite() } ?: 0.0
                                    val a = x(min(0.0, v)); val b = x(max(0.0, v))
                                    drawRoundRect(s.value.color.copy(alpha = if (dim) 0.4f else 1f), Offset(a, barsTop + j * 26.dp.toPx()), Size(b - a, 16.dp.toPx()), CornerRadius(4.dp.toPx()))
                                }
                            }
                        }
                    }
                }
                HorizontalDivider(color = grid)
                Canvas(Modifier.fillMaxWidth().height(24.dp)) {
                    val left = 2.dp.toPx()
                    val w = size.width - 4.dp.toPx()
                    scale.ticks.forEachIndexed { i, t ->
                        val anchor = when (i) { 0 -> 0f; scale.ticks.lastIndex -> 1f; else -> 0.5f }
                        label(measurer, tickLabel(t), style, left + w * scale.fraction(t), 4.dp.toPx(), 80.dp.toPx().toInt(), anchor)
                    }
                }
            }
            if (selected != null) {
                ChartTooltip(data.categories[selected], visible.map { TipLine(it.value.name, tooltipValue(it.value.values[selected]), it.value.color) }, Modifier.align(Alignment.TopEnd))
            }
        }
        listOfNotNull(p.str("xLabel")?.let { "X-Axis" to it }, p.str("yLabel")?.let { "Y-Axis" to it }).forEach { (k, v) ->
            Row(Modifier.padding(top = 8.dp)) {
                Text("$k: ", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(v, style = MaterialTheme.typography.labelMedium)
            }
        }
        Legend(data.series.map { it.name to it.color }, hidden, { hidden = toggle(hidden, it, data.series.size) })
    }
}

// ── Radar ────────────────────────────────────────────────────────────────────

@Composable
fun RadarChart(node: ElementNode) {
    val p = node.p
    val data = buildChartData(p["labels"], p["series"]) ?: return
    if (data.categories.isEmpty() || data.series.isEmpty()) return
    var hidden by remember(data.series.size) { mutableStateOf(emptySet<Int>()) }
    var touch by remember { mutableStateOf<Offset?>(null) }
    val visible = data.series.withIndex().filter { it.index !in hidden }
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    val surface = MaterialTheme.colorScheme.surface
    val n = data.categories.size
    val maxValue = visible.maxOf { it.value.values.maxOrNull() ?: 0.0 }.takeIf { it > 0 } ?: 1.0
    Column(Modifier.fillMaxWidth().testTag("openui-chart"), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            val chart = maxWidth.coerceAtMost(300.dp).coerceAtLeast(150.dp)
            var selected by remember { mutableStateOf<Int?>(null) }
            Canvas(Modifier.size(chart).track { touch = it }) {
                val c = Offset(size.width / 2, size.height / 2)
                val r = 0.35f * size.width
                fun angle(i: Int) = 2 * PI * i / n - PI / 2
                fun point(i: Int, value: Double) = Offset(c.x + (r * value / maxValue * cos(angle(i))).toFloat(), c.y + (r * value / maxValue * sin(angle(i))).toFloat())
                for (k in 1..5) {
                    val path = Path()
                    for (i in 0 until n) point(i, maxValue * k / 5).let { if (i == 0) path.moveTo(it.x, it.y) else path.lineTo(it.x, it.y) }
                    path.close()
                    drawPath(path, grid, style = Stroke(1f))
                }
                for (i in 0 until n) drawLine(grid, c, point(i, maxValue), 1f)
                val pad = (0.15f * size.width - 15.dp.toPx()).coerceIn(6.dp.toPx(), 16.dp.toPx())
                for (i in 0 until n) {
                    val a = angle(i)
                    val lx = c.x + ((r + pad) * cos(a)).toFloat()
                    val ly = c.y + ((r + pad) * sin(a)).toFloat()
                    val layout = measurer.measure(data.categories[i], style, maxLines = 2, overflow = TextOverflow.Ellipsis, constraints = Constraints(maxWidth = (size.width / 3).toInt()))
                    val ax = when { abs(cos(a)) < 0.1 -> 0.5f; cos(a) > 0 -> 0f; else -> 1f }
                    val ay = when { sin(a) < -0.3 -> 1f; sin(a) > 0.3 -> 0f; else -> 0.5f }
                    drawText(layout, topLeft = Offset(lx - layout.size.width * ax, ly - layout.size.height * ay))
                }
                selected = touch?.let { t -> ((((atan2((t.y - c.y).toDouble(), (t.x - c.x).toDouble()) + PI / 2) % (2 * PI) + 2 * PI) % (2 * PI)) / (2 * PI / n)).roundToInt() % n }
                for (s in visible) {
                    val path = Path()
                    for (i in 0 until n) point(i, s.value.values[i]).let { if (i == 0) path.moveTo(it.x, it.y) else path.lineTo(it.x, it.y) }
                    path.close()
                    drawPath(path, s.value.color, style = Stroke(2.dp.toPx()))
                    selected?.let { i ->
                        drawCircle(surface, 4.dp.toPx(), point(i, s.value.values[i]))
                        drawCircle(s.value.color, 2.dp.toPx(), point(i, s.value.values[i]))
                    }
                }
            }
            selected?.let { i ->
                ChartTooltip(data.categories[i], visible.map { TipLine(it.value.name, tooltipValue(it.value.values[i]), it.value.color) }, Modifier.align(Alignment.TopEnd))
            }
        }
        Legend(data.series.map { it.name to it.color }, hidden, { hidden = toggle(hidden, it, data.series.size) })
    }
}

// ── Pie and radial ───────────────────────────────────────────────────────────

@Composable
fun PieChart(node: ElementNode) {
    val p = node.p
    val ui = LocalOpenUI.current
    val slices = buildSlices(p["labels"], p["values"])
    if (slices == null) {
        if (ui.queryLoading) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(Modifier.size(200.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceContainerHighest))
            }
        }
        return
    }
    OneDimensional(slices, radial = false, donut = p.str("variant") == "donut", semi = p.str("appearance") == "semiCircular")
}

@Composable
fun RadialChart(node: ElementNode) {
    val p = node.p
    val slices = buildSlices(p["labels"], p["values"]) ?: return
    OneDimensional(slices, radial = true, donut = false, semi = false)
}

@Composable
private fun OneDimensional(raw: List<Pair<String, Double>>, radial: Boolean, donut: Boolean, semi: Boolean) {
    val sorted = remember(raw) { raw.sortedByDescending { it.second } }
    val colors = chartColors(sorted.size)
    var hidden by remember(sorted.size) { mutableStateOf(emptySet<Int>()) }
    var active by remember { mutableStateOf<Int?>(null) }
    val visible = sorted.indices.filter { it !in hidden }
    val total = visible.sumOf { max(0.0, sorted[it].second) }
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val chart: @Composable (Modifier) -> Unit = { modifier ->
        BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
            val side = maxWidth.coerceAtMost(if (semi) 400.dp else 260.dp).coerceAtLeast(150.dp)
            Canvas(
                Modifier.size(side, if (semi) side / 2 + 10.dp else side).pointerInput(sorted, hidden) {
                    detectTapGestures { tap ->
                        val c = Offset(size.width / 2f, if (semi) size.height - 10.dp.toPx() else size.height / 2f)
                        val d = hypot(tap.x - c.x, tap.y - c.y)
                        val outer = 0.45f * size.width
                        if (radial) {
                            val minR = 0.25f * outer
                            val t = (outer - minR) / max(1, visible.size)
                            val ring = ((d - minR) / t).toInt()
                            active = visible.getOrNull(ring).takeIf { d >= minR && d <= outer }
                        } else {
                            if (d > outer) { active = null; return@detectTapGestures }
                            var a = Math.toDegrees(atan2((tap.y - c.y).toDouble(), (tap.x - c.x).toDouble())) + 90
                            if (a < 0) a += 360
                            val span = if (semi) 180.0 else 360.0
                            val start = if (semi) 270.0 else 0.0
                            val rel = ((a - start) % 360 + 360) % 360
                            var acc = 0.0
                            active = null
                            for (i in visible) {
                                val sweep = if (total > 0) max(0.0, sorted[i].second) / total * span else 0.0
                                if (rel >= acc && rel < acc + sweep) { active = i; break }
                                acc += sweep
                            }
                        }
                    }
                },
            ) {
                val outer = 0.45f * size.width
                val c = Offset(size.width / 2f, if (semi) size.height - 10.dp.toPx() else size.height / 2f)
                if (radial) {
                    val minR = 0.25f * outer
                    val t = (outer - minR) / max(1, visible.size)
                    val maxV = visible.maxOfOrNull { sorted[it].second }?.takeIf { it > 0 } ?: 1.0
                    visible.forEachIndexed { ring, i ->
                        val inner = minR + ring * t + 2.dp.toPx()
                        val width = t - 2.dp.toPx()
                        val radius = inner + width / 2
                        val sweep = (sorted[i].second / maxV * 360).toFloat().coerceIn(0f, 360f)
                        drawArc(
                            colors[i].copy(alpha = if (active != null && active != i) 0.4f else 1f), -90f, sweep, false,
                            topLeft = Offset(c.x - radius, c.y - radius), size = Size(radius * 2, radius * 2),
                            style = Stroke(width, cap = StrokeCap.Round),
                        )
                    }
                } else {
                    val span = if (semi) 180f else 360f
                    var start = if (semi) 180f else -90f
                    for (i in visible) {
                        val sweep = if (total > 0) (max(0.0, sorted[i].second) / total * span).toFloat() else 0f
                        val pop = if (active == i) 8.dp.toPx() else 0f
                        val mid = Math.toRadians((start + sweep / 2).toDouble())
                        val shift = Offset((cos(mid) * pop).toFloat(), (sin(mid) * pop).toFloat())
                        val color = colors[i].copy(alpha = if (active != null && active != i) 0.4f else 1f)
                        val pad = if (donut && sweep > 1f) 0.5f else 0f
                        if (donut) {
                            val band = outer * 0.1f
                            val r = outer - band / 2
                            val inner = 0.9f * outer
                            drawArc(track, start + pad / 2, sweep - pad, false, topLeft = c + shift - Offset(inner * 0.64f, inner * 0.64f), size = Size(inner * 1.28f, inner * 1.28f), style = Stroke(inner * 0.72f))
                            drawArc(color, start + pad / 2, sweep - pad, false, topLeft = c + shift - Offset(r, r), size = Size(r * 2, r * 2), style = Stroke(band))
                        } else {
                            drawArc(color, start, sweep, true, topLeft = c + shift - Offset(outer, outer), size = Size(outer * 2, outer * 2))
                        }
                        start += sweep
                    }
                }
            }
        }
    }
    Column(Modifier.fillMaxWidth().testTag("openui-chart")) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val wide = maxWidth >= 400.dp
            val legend: @Composable (Modifier) -> Unit = { modifier ->
                StackedLegend(sorted, colors, hidden, active, total, modifier, onToggle = { hidden = toggle(hidden, it, sorted.size) }, onActive = { active = it })
            }
            if (wide) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                chart(Modifier.weight(1f))
                legend(Modifier.weight(1f))
            } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                chart(Modifier.fillMaxWidth())
                legend(Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun StackedLegend(
    items: List<Pair<String, Double>>,
    colors: List<Color>,
    hidden: Set<Int>,
    active: Int?,
    total: Double,
    modifier: Modifier,
    onToggle: (Int) -> Unit,
    onActive: (Int?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val shown = if (expanded || items.size <= 6) items.indices.toList() else (0 until 6).toList()
    Column(modifier) {
        shown.forEach { i ->
            Row(
                Modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(10.dp))
                    .background(if (active == i) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent)
                    .clickable { onToggle(i); onActive(null) }
                    .alpha(if (i in hidden) 0.3f else 1f)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(colors[i]))
                Text(items[i].first, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(if (i in hidden) "" else percent(max(0.0, items[i].second), total), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (items.size > 6) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Show less" else "Show more") }
    }
}

// ── One stacked bar ──────────────────────────────────────────────────────────

@Composable
fun SingleStackedBarChart(node: ElementNode) {
    val p = node.p
    val slices = buildSlices(p["labels"], p["values"]) ?: return
    val values = slices.map { max(0.0, it.second.takeIf { v -> v.isFinite() } ?: 0.0) }
    val sum = values.sum()
    val colors = slices.indices.map { CHART_PALETTE[it % CHART_PALETTE.size] }
    var active by remember { mutableStateOf<Int?>(null) }
    Column(Modifier.fillMaxWidth().testTag("openui-chart"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth().height(28.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            values.forEachIndexed { i, v ->
                if (v > 0 || sum <= 0) {
                    Box(
                        Modifier.weight(if (sum > 0) (v / sum).toFloat().coerceAtLeast(0.005f) else 1f).height(20.dp)
                            .clip(RoundedCornerShape(topStart = if (i == 0) 4.dp else 0.dp, bottomStart = if (i == 0) 4.dp else 0.dp, topEnd = if (i == values.lastIndex) 4.dp else 0.dp, bottomEnd = if (i == values.lastIndex) 4.dp else 0.dp))
                            .background(colors[i].copy(alpha = if (active != null && active != i) 0.5f else 1f))
                            .clickable { active = if (active == i) null else i },
                    )
                }
            }
        }
        active?.let { i -> ChartTooltip(slices[i].first, listOf(TipLine("Value", tickLabel(values[i]), colors[i]), TipLine("Percentage", percent(values[i], sum), colors[i]))) }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Legend(slices.map { it.first to Color.Unspecified }.mapIndexed { i, (name, _) -> name to colors[i] }, emptySet(), null) { i -> percent(values[i], sum) }
    }
}

// ── Scatter ──────────────────────────────────────────────────────────────────

@Composable
fun ScatterChart(node: ElementNode) {
    val datasets = node.p.list("datasets").filterIsInstance<ElementNode>().map { ds ->
        val points = (ds.props["points"] as? List<*>).orEmpty().filterIsInstance<ElementNode>().map { pt -> Js.toNumber(pt.props["x"]) to Js.toNumber(pt.props["y"]) }
            .filter { !it.first.isNaN() && !it.second.isNaN() }
        cellText(ds.props["name"]) to points
    }
    if (node.p["datasets"] == null) return
    val colors = chartColors(datasets.size)
    var hidden by remember(datasets.size) { mutableStateOf(emptySet<Int>()) }
    var touch by remember { mutableStateOf<Offset?>(null) }
    val measurer = rememberTextMeasurer()
    val style = chartTextStyle()
    val grid = MaterialTheme.colorScheme.outlineVariant
    val surface = MaterialTheme.colorScheme.surface
    val all = datasets.filterIndexed { i, _ -> i !in hidden }.flatMap { it.second }
    val xs = all.map { it.first }
    val ys = all.map { it.second }
    val density = LocalDensity.current
    Column(Modifier.fillMaxWidth().testTag("openui-chart")) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val widthPx = with(density) { maxWidth.toPx() }
            val xScale = if (xs.isEmpty()) Scale.nice(0.0, 100.0, 5) else Scale.nice(xs.min(), xs.max(), max(2, (widthPx / with(density) { 60.dp.toPx() }).toInt()))
            val yScale = if (ys.isEmpty()) Scale.nice(0.0, 100.0, 6) else Scale.nice(ys.min(), ys.max(), 6)
            val yLabels = yScale.ticks.map { tickLabel(it) }
            val yAxis = with(density) { ((yLabels.maxOfOrNull { measurer.measure(it, style).size.width } ?: 0) + 10.dp.roundToPx()).toFloat() }
            var nearest by remember { mutableStateOf<Triple<Int, Double, Double>?>(null) }
            Canvas(Modifier.fillMaxWidth().height(296.dp).track { touch = it }) {
                val top = 10.dp.toPx()
                val plotH = size.height - top - 28.dp.toPx()
                val plotW = size.width - yAxis
                fun px(x: Double) = yAxis + plotW * xScale.fraction(x)
                fun py(y: Double) = top + plotH * (1 - yScale.fraction(y))
                val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))
                yScale.ticks.forEachIndexed { i, t ->
                    drawLine(grid, Offset(yAxis, py(t)), Offset(size.width, py(t)), 1f, pathEffect = dash)
                    val layout = measurer.measure(yLabels[i], style)
                    drawText(layout, topLeft = Offset(yAxis - 8.dp.toPx() - layout.size.width, py(t) - layout.size.height / 2))
                }
                xScale.ticks.forEach { t ->
                    drawLine(grid, Offset(px(t), top), Offset(px(t), top + plotH), 1f, pathEffect = dash)
                    label(measurer, tickLabel(t), style, px(t), top + plotH + 14.dp.toPx() - 10.dp.toPx(), 60.dp.toPx().toInt())
                }
                var best: Triple<Int, Double, Double>? = null
                var bestD = 30.dp.toPx()
                touch?.let { t ->
                    datasets.forEachIndexed { i, (_, points) ->
                        if (i in hidden) return@forEachIndexed
                        points.forEach { (x, y) -> val d = hypot(px(x) - t.x, py(y) - t.y); if (d < bestD) { bestD = d; best = Triple(i, x, y) } }
                    }
                }
                nearest = best
                datasets.forEachIndexed { i, (_, points) ->
                    if (i in hidden) return@forEachIndexed
                    val dim = best != null && best!!.first != i
                    points.forEach { (x, y) ->
                        val hot = best?.let { it.first == i && it.second == x && it.third == y } == true
                        val c = Offset(px(x), py(y))
                        drawCircle(colors[i].copy(alpha = if (dim) 0.3f else 1f), (if (hot) 6 else 4).dp.toPx(), c)
                        drawCircle(surface, (if (hot) 6 else 4).dp.toPx(), c, style = Stroke(1.5f.dp.toPx()))
                    }
                }
            }
            nearest?.let { (i, x, y) ->
                ChartTooltip(datasets[i].first, listOf(TipLine("X", tooltipValue(x), colors[i]), TipLine("Y", tooltipValue(y), colors[i])), Modifier.align(Alignment.TopEnd))
            }
        }
        Legend(datasets.mapIndexed { i, d -> d.first to colors[i] }, hidden, { hidden = toggle(hidden, it, datasets.size) })
    }
}
