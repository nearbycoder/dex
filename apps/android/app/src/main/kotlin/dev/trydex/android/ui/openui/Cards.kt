package dev.trydex.android.ui.openui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.trydex.openui.ActionPlan
import dev.trydex.openui.ActionStep
import dev.trydex.openui.ElementNode
import dev.trydex.openui.Js
import dev.trydex.openui.Undefined
import kotlin.math.ceil

// ── Layout ───────────────────────────────────────────────────────────────────

/** How many cards go in each row (getRowConfiguration). */
fun rowConfiguration(count: Int, max: Int): List<Int> {
    if (count <= 0) return emptyList()
    if (count == 1) return listOf(1)
    if (max <= 1) return List(count) { 1 }
    if (max == 2) return List(count / 2) { 2 } + if (count % 2 == 1) listOf(1) else emptyList()
    return when (count % 3) {
        0 -> List(count / 3) { 3 }
        2 -> MutableList(count / 3) { 3 }.apply { add(ceil(size / 2.0).toInt(), 2) }
        else -> List((count - 4) / 3) { 3 } + listOf(2, 2)
    }
}

/** A card's item context, sent with what it does: ToAssistant steps get "Selected item: {…}" in their context. */
fun withItemContext(action: Any?, context: Map<String, Any?>): Any? {
    val clean = context.filterValues { it !== Undefined }
    val suffix = "Selected item: ${Js.json(clean)}"
    return when (action) {
        is ActionPlan -> ActionPlan(action.steps.map { step ->
            if (step !is ActionStep.ToAssistant) step
            else if (Js.isNullish(step.context)) step.copy(context = suffix)
            else step.copy(context = "${(step.context as? String) ?: Js.json(step.context)}\n$suffix")
        })
        is Map<*, *> -> if (action["steps"] is List<*>) action else LinkedHashMap<String, Any?>().apply {
            action.forEach { (k, v) -> put(k.toString(), v) }
            put("params", LinkedHashMap<String, Any?>().apply {
                (action["params"] as? Map<*, *>)?.forEach { (k, v) -> put(k.toString(), v) }
                putAll(clean)
            })
        }
        else -> action
    }
}

/** Equal-height cards in a row, sharing its width. */
@Composable
private fun EqualRow(count: Int, gap: Dp, content: @Composable (Int) -> Unit) {
    SubcomposeLayout(Modifier.fillMaxWidth()) { constraints ->
        val gapPx = gap.roundToPx()
        val width = ((constraints.maxWidth - gapPx * (count - 1)) / count).coerceAtLeast(0)
        val measured = (0 until count).map { i -> subcompose("measure-$i") { content(i) }.map { it.measure(Constraints(minWidth = width, maxWidth = width)) } }
        val height = measured.maxOfOrNull { list -> list.maxOfOrNull { it.height } ?: 0 } ?: 0
        val placed = (0 until count).map { i -> subcompose("place-$i") { content(i) }.map { it.measure(Constraints.fixed(width, height)) } }
        layout(constraints.maxWidth, height) {
            placed.forEachIndexed { i, list -> list.forEach { it.place(i * (width + gapPx), 0) } }
        }
    }
}

/** A block's cards in rows of up to [max], or a sideways list; narrow blocks drop to two columns, then one. */
@Composable
private fun CardBlockLayout(
    count: Int,
    max: Int,
    layout: String?,
    responsive: Boolean,
    gapProp: Any?,
    carouselWidth: Pair<Dp, Dp>,
    card: @Composable (index: Int, modifier: Modifier) -> Unit,
) {
    if (count == 0) return
    val gap = ((gapProp as? Double)?.takeIf { it > 0 } ?: 12.0).dp
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (layout == "carousel") {
            val width = if (maxWidth <= 480.dp) carouselWidth.second else carouselWidth.first
            LazyRow(horizontalArrangement = Arrangement.spacedBy(gap), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                itemsIndexed(List(count) { it }) { _, i -> card(i, Modifier.width(width)) }
            }
            return@BoxWithConstraints
        }
        val rows = when {
            responsive && maxWidth <= 480.dp -> List(count) { 1 }
            responsive && maxWidth <= 768.dp -> rowConfiguration(count, 2)
            else -> rowConfiguration(count, max)
        }
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            var start = 0
            rows.forEach { size ->
                val first = start
                if (size == 1) card(first, Modifier.fillMaxWidth())
                else EqualRow(size, gap) { i -> card(first + i, Modifier.fillMaxSize()) }
                start += size
            }
        }
    }
}

/** A card: flat while streaming or without an action, raised and tappable with one. */
@Composable
private fun BlockCard(
    clickable: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    color: Color? = null,
    border: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    if (clickable) {
        Surface(
            onClick = onClick,
            shape = shape,
            color = color ?: colors.surfaceContainerHigh,
            shadowElevation = 1.dp,
            border = if (border) BorderStroke(1.dp, colors.outlineVariant) else null,
            modifier = modifier.testTag("openui-card"),
        ) { Column(content = content) }
    } else {
        Surface(
            shape = shape,
            color = color ?: colors.surfaceContainerLow,
            border = if (border) BorderStroke(1.dp, colors.outlineVariant) else null,
            modifier = modifier.testTag("openui-card"),
        ) { Column(content = content) }
    }
}

private fun ElementNode.with(vararg overrides: Pair<String, Any?>): ElementNode = copy(props = props + overrides)

private fun str(node: ElementNode?, key: String): String? = node?.props?.get(key) as? String

// ── Card blocks ──────────────────────────────────────────────────────────────

@Composable
fun SnippetCardBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items").filter { it.p.node("lhs") != null }
    val clickable = p.has("action") && !ui.streaming
    CardBlockLayout(items.size, 2, "grid", p.bool("responsive") != false, p["gap"], 280.dp to 240.dp) { i, modifier ->
        val item = items[i]
        val lhs = item.p.node("lhs")!!
        val rhs = item.p.node("rhs")
        val id = item.p.str("id")
        BlockCard(clickable, onClick = {
            ui.trigger(
                str(lhs, "title") ?: id ?: "Snippet card ${i + 1}", null,
                withItemContext(p["action"], mapOf("itemIndex" to i.toDouble(), "itemId" to (id ?: Undefined), "itemTitle" to (str(lhs, "title") ?: Undefined), "itemSubtitle" to (str(lhs, "subtitle") ?: Undefined), "itemValue" to (str(rhs, "value") ?: Undefined))),
            )
        }, modifier = modifier) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) { RenderNode(lhs.with("singleLine" to true)) }
                if (rhs != null) Box { RenderNode(rhs.with("size" to "xs", "align" to "end")) }
                else if (clickable) Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun OverviewCardBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items").filter { it.p.node("top") != null }
    val clickable = p.has("action") && !ui.streaming
    CardBlockLayout(items.size, 3, p.str("layout"), p.bool("responsive") != false, p["gap"], 240.dp to 200.dp) { i, modifier ->
        val item = items[i]
        val top = item.p.node("top")!!
        val bottom = item.p.node("bottom")
        val id = item.p.str("id")
        BlockCard(clickable, onClick = {
            ui.trigger(
                str(top, "title") ?: str(top, "value") ?: id ?: "Overview card ${i + 1}", null,
                withItemContext(p["action"], mapOf("itemIndex" to i.toDouble(), "itemId" to (id ?: Undefined), "itemTitle" to (str(top, "title") ?: str(top, "value") ?: Undefined), "itemSubtitle" to (str(top, "subtitle") ?: str(top, "subtext") ?: Undefined), "itemMetricValue" to (str(bottom, "value") ?: Undefined))),
            )
        }, modifier = modifier.widthIn(min = 158.dp)) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f).heightIn(min = 24.dp)) { RenderNode(top) }
                    if (clickable) Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
                if (bottom != null) MetricInline(bottom)
            }
        }
    }
}

@Composable
fun ContextCardBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items")
    val clickable = p.has("action") && !ui.streaming
    CardBlockLayout(items.size, 3, p.str("layout"), p.bool("responsive") != false, p["gap"], 280.dp to 240.dp) { i, modifier ->
        val item = items[i]
        val ip = item.p
        val titleNode = ip.node("title")
        val titleText = ip.str("title") ?: str(titleNode, "text") ?: ""
        val image = rememberImageModel(ip.str("bgImageSrc"))
        val gray = ip.str("bgColor") == "gray"
        val id = ip.str("id")
        BlockCard(
            clickable,
            onClick = {
                ui.trigger(
                    titleText.ifEmpty { id ?: "Context card ${i + 1}" }, null,
                    withItemContext(p["action"], mapOf("itemIndex" to i.toDouble(), "itemId" to (id ?: Undefined), "itemTitle" to titleText, "itemBody" to (ip.str("body") ?: Undefined), "itemBgColor" to (ip.str("bgColor") ?: Undefined), "itemBgImageSrc" to (ip.str("bgImageSrc") ?: Undefined), "itemBgImageAlt" to (ip.str("bgImageAlt") ?: Undefined))),
                )
            },
            modifier = modifier.widthIn(min = 196.dp),
            color = if (gray) MaterialTheme.colorScheme.surfaceContainerHighest else null,
            border = false,
        ) {
            Box(Modifier.fillMaxWidth()) {
                if (image != null) {
                    PolicyImage(ip.str("bgImageSrc"), ip.str("bgImageAlt"), Modifier.matchParentSize())
                    Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.55f)))
                }
                val onImage = image != null
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(Modifier.heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) {
                            if (titleNode != null && titleNode.typeName == "Tag") TagView(titleNode, forceSize = "sm", translucent = onImage)
                            else Text(titleText, style = MaterialTheme.typography.bodyMedium, color = if (onImage) Color.White.copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (clickable) Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = if (onImage) Color.White else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    }
                    ip.str("body")?.takeIf { it.isNotEmpty() }?.let {
                        InlineMarkdown(it, MaterialTheme.typography.titleMedium, color = if (onImage) Color.White else Color.Unspecified)
                    }
                }
            }
        }
    }
}

@Composable
fun CompositeCardBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items")
    val clickable = p.has("action") && !ui.streaming
    CardBlockLayout(items.size, 2, p.str("layout"), p.bool("responsive") != false, p["gap"], 320.dp to 280.dp) { i, modifier ->
        val ip = items[i].p
        val header = ip.node("header")
        val body = ip.nodes("body")
        val footer = ip.map("footer")
        val price = footer?.get("price") as? ElementNode
        val button = footer?.get("button") as? ElementNode
        val id = ip.str("id")
        BlockCard(clickable, onClick = {
            ui.trigger(
                str(header, "title") ?: str(header, "value") ?: str(header, "alt") ?: id ?: "Composite card ${i + 1}", null,
                withItemContext(p["action"], mapOf(
                    "itemIndex" to i.toDouble(), "itemId" to (id ?: Undefined),
                    "itemHeaderTitle" to (str(header, "title") ?: str(header, "value") ?: Undefined),
                    "itemHeaderSubtitle" to (str(header, "subtitle") ?: str(header, "subtext") ?: Undefined),
                    "itemHeaderAlt" to (str(header, "alt") ?: Undefined),
                    "itemBodyCount" to body.size.toDouble(),
                    "itemFooterPrice" to (str(price, "value") ?: Undefined),
                    "itemFooterButtonLabel" to (str(button, "label") ?: Undefined),
                )),
            )
        }, modifier = modifier.widthIn(min = 240.dp), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (header != null) RenderNode(header)
                if (body.isNotEmpty()) {
                    Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        body.forEach { child ->
                            when (child.typeName) {
                                "Text", "BoldText" -> RenderNode(child.with("size" to "xs"))
                                "AreaChart", "BarChart", "LineChart" -> RenderNode(child.with("height" to 180.0))
                                "ListBlock" -> ListBlockView(child, sizeOverride = "small")
                                "EntityList" -> EntityList(child, sizeOverride = "small", plain = true)
                                "TagBlock" -> RenderNode(child.with("size" to "sm"))
                                else -> RenderNode(child)
                            }
                        }
                    }
                }
                if (price != null || button != null) {
                    Spacer(Modifier.weight(1f, fill = false))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        price?.let { RenderNode(it) }
                        button?.let { if (it.typeName == "Button") ButtonView(it, sizeOverride = "small", fill = true) else RenderNode(it) }
                    }
                }
            }
        }
    }
}

@Composable
fun VisualCardBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items").filter { it.p.node("body") != null }
    val clickable = p.has("action") && !ui.streaming
    CardBlockLayout(items.size, 3, p.str("layout"), p.bool("responsive") != false, p["gap"], 320.dp to 280.dp) { i, modifier ->
        val ip = items[i].p
        val body = ip.node("body")!!
        val tag = ip.node("tag")
        val id = ip.str("id")
        BlockCard(clickable, onClick = {
            ui.trigger(
                str(body, "value")?.takeIf { it.isNotEmpty() } ?: str(tag, "text")?.takeIf { it.isNotEmpty() } ?: id ?: "Visual card ${i + 1}", null,
                withItemContext(p["action"], mapOf(
                    "itemIndex" to i.toDouble(), "itemId" to (id ?: Undefined), "itemTag" to (str(tag, "text") ?: Undefined),
                    "itemBody" to (str(body, "value") ?: Undefined), "itemBodySubtext" to (str(body, "subtext") ?: Undefined),
                    "itemBgImageSrc" to (ip.str("bgImageSrc") ?: Undefined), "itemBgImageAlt" to (ip.str("bgImageAlt") ?: Undefined),
                )),
            )
        }, modifier = modifier.heightIn(min = 280.dp), shape = RoundedCornerShape(20.dp)) {
            Box(Modifier.fillMaxWidth().heightIn(min = 280.dp).semantics { ip.str("bgImageAlt")?.let { contentDescription = it } }) {
                PolicyImage(ip.str("bgImageSrc"), ip.str("bgImageAlt"), Modifier.matchParentSize())
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.12f), Color.Black.copy(alpha = 0.56f)))))
                Row(Modifier.fillMaxWidth().padding(12.dp).heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { if (tag != null) TagView(tag, forceSize = "sm", translucent = true) }
                    if (clickable) {
                        Box(Modifier.clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.4f)).padding(4.dp)) {
                            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(12.dp),
                ) {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) { RenderNode(body.with("size" to (str(body, "size") ?: "sm"))) }
                }
            }
        }
    }
}

// ── Inline building blocks ───────────────────────────────────────────────────

@Composable
private fun metricColor(subtext: String, variant: String?): Color = when {
    variant != "metric" -> MaterialTheme.colorScheme.onSurfaceVariant
    subtext.startsWith("+") -> dev.trydex.android.ui.theme.DexTheme.colors.success
    subtext.startsWith("-") -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
fun TextLine(node: ElementNode, bold: Boolean) {
    val p = node.p
    val size = p.str("size") ?: "sm"
    val subtext = p.str("subtext")?.takeIf { it.isNotEmpty() }
    val valueSize = when (size) { "xs" -> 14; "lg" -> 18; else -> 16 }
    val subSize = when (size) { "md", "lg" -> 16; else -> 14 }
    val single = p.bool("singleLine") == true
    val end = p.str("align") == "end"
    val numeric = p.str("variant") == "number"
    Column(horizontalAlignment = if (end) Alignment.End else Alignment.Start) {
        InlineMarkdown(
            p.text("value"),
            TextStyle(fontSize = valueSize.sp, lineHeight = (valueSize * 1.4).sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, fontFeatureSettings = if (numeric) "tnum" else null),
            maxLines = if (single) 1 else Int.MAX_VALUE,
        )
        if (subtext != null) {
            InlineMarkdown(subtext, TextStyle(fontSize = subSize.sp, lineHeight = (subSize * 1.4).sp), color = metricColor(subtext, p.str("subtextVariant")), maxLines = if (single) 1 else Int.MAX_VALUE)
        }
    }
}

@Composable
fun IconText(node: ElementNode) {
    val p = node.p
    val icon = p.node("icon")
    val variant = p.str("iconVariant") ?: "neutral"
    val vertical = p.str("layout") == "vertical"
    val bold = p.bool("bold") == true
    val single = p.bool("singleLine") == true
    val badge: @Composable () -> Unit = {
        if (icon != null && !icon.p.str("name").isNullOrEmpty()) {
            val t = tone(variant)
            val (bg, fg) = when (variant) {
                "info", "success", "warning", "danger" -> t!!.container to t.content
                "inverted" -> MaterialTheme.colorScheme.inverseSurface to MaterialTheme.colorScheme.inverseOnSurface
                else -> MaterialTheme.colorScheme.surfaceContainerHighest to MaterialTheme.colorScheme.onSurface
            }
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(bg), contentAlignment = Alignment.Center) { IconView(icon, 18, fg) }
        }
    }
    val text: @Composable () -> Unit = {
        Column {
            Text(p.text("title"), style = (if (vertical) MaterialTheme.typography.bodyLarge else MaterialTheme.typography.bodyMedium).copy(fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal), maxLines = if (single) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            p.str("subtitle")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (single) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis) }
        }
    }
    if (vertical) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { badge(); text() }
    else Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) { badge(); text() }
}

@Composable
fun ImageText(node: ElementNode) {
    val p = node.p
    val size = (p.num("imageSize") ?: 40.0).dp
    val vertical = p.str("layout") == "vertical"
    val bold = p.bool("bold") == true
    val single = p.bool("singleLine") == true
    val image: @Composable () -> Unit = { PolicyImage(p.str("src"), p.str("alt") ?: p.str("title"), Modifier.size(size).clip(RoundedCornerShape(10.dp))) }
    val text: @Composable () -> Unit = {
        Column {
            Text(p.text("title"), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal), maxLines = if (single) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            p.str("subtitle")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (single) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis) }
        }
    }
    if (vertical) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { image(); text() }
    else Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) { image(); text() }
}

@Composable
fun ImageTextLarge(node: ElementNode) {
    val p = node.p
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PolicyImage(p.str("src"), p.str("alt") ?: p.str("title"), Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(12.dp)))
        Column {
            Text(p.text("title"), style = MaterialTheme.typography.titleSmall)
            p.str("subtitle")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun Trend(trend: Map<String, Any?>?) {
    val direction = trend?.get("direction") as? String ?: return
    val value = trend["value"] as? Double ?: return
    val up = direction == "up"
    Text(
        (if (up) "+" else "-") + Js.numberToString(value) + "%",
        style = MaterialTheme.typography.bodyMedium,
        color = if (up) dev.trydex.android.ui.theme.DexTheme.colors.success else MaterialTheme.colorScheme.error,
    )
}

@Composable
fun MetricInline(node: ElementNode) {
    val p = node.p
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        Text(p.text("value"), style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"))
        Trend(p.map("trend"))
        p.str("subtext")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun MetricStrikethrough(node: ElementNode) {
    val p = node.p
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
            Text(p.text("value"), style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"))
            p.str("previousValue")?.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium.copy(textDecoration = TextDecoration.LineThrough), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Trend(p.map("trend"))
        }
        p.str("subtext")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
