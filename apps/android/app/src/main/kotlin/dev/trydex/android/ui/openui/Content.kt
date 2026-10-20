package dev.trydex.android.ui.openui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import coil3.compose.SubcomposeAsyncImage
import dev.trydex.android.ui.components.CodeBlock
import dev.trydex.android.ui.components.Markdown
import dev.trydex.android.ui.components.MarkdownOptions
import dev.trydex.android.ui.components.rememberInlineMarkdown
import dev.trydex.openui.ElementNode
import kotlinx.coroutines.delay

private val CITATIONS = Regex("(\\[\\d+\\]\\s*)+")
private const val CITE_SCHEME = "dex-cite:"

/** `[1][2]` runs as one link to the cited sources, or nothing when none of them exist. */
private fun withCitations(text: String, sources: List<Source>): String = CITATIONS.replace(text) { match ->
    val indexes = Regex("\\d+").findAll(match.value).map { it.value.toInt() }.filter { it in 1..sources.size }.toList()
    if (indexes.isEmpty()) "" else "[\\[${indexes.joinToString(",")}\\]]($CITE_SCHEME${indexes.joinToString(",")}) "
}

/** Opens links: citations show their sources, web links open in the browser. */
@Composable
private fun rememberLinkHandler(): Pair<(String) -> Unit, @Composable () -> Unit> {
    val ui = LocalOpenUI.current
    var cited by remember { mutableStateOf<List<Source>?>(null) }
    val handler: (String) -> Unit = { url ->
        if (url.startsWith(CITE_SCHEME)) {
            cited = url.removePrefix(CITE_SCHEME).split(',').mapNotNull { it.toIntOrNull() }.mapNotNull { ui.sources.getOrNull(it - 1) }
        } else {
            ui.onLink(url)
        }
    }
    val sheet: @Composable () -> Unit = {
        cited?.let { list ->
            ModalBottomSheet(onDismissRequest = { cited = null }) {
                Column(Modifier.padding(bottom = 24.dp)) {
                    Text("Sources", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                    list.forEach { SourceRow(it) { cited = null } }
                }
            }
        }
    }
    return handler to sheet
}

@Composable
private fun SourceRow(source: Source, onOpened: () -> Unit) {
    val ui = LocalOpenUI.current
    val link = safeLink(source.url)
    Row(
        Modifier.fillMaxWidth().then(if (link != null) Modifier.clickable { onOpened(); ui.onLink(link) } else Modifier).padding(horizontal = 24.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.Public, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text(source.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(source.sourceName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The response's root: its children in a column, then its sources. */
@Composable
fun CardRoot(node: ElementNode) {
    val ui = LocalOpenUI.current
    val sources = node.p.list("sources").mapNotNull { raw ->
        val map = raw as? Map<*, *> ?: return@mapNotNull null
        val title = map["title"] as? String ?: return@mapNotNull null
        val name = map["sourceName"] as? String ?: return@mapNotNull null
        Source(map["url"] as? String, title, name)
    }
    CompositionLocalProvider(LocalOpenUI provides ui.withSources(sources)) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            node.p.list("children").forEach { RenderValue(it) }
            if (sources.isNotEmpty()) SourcesStrip(sources)
        }
    }
}

@Composable
private fun SourcesStrip(sources: List<Source>) {
    val ui = LocalOpenUI.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Sources", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(sources) { _, source ->
                val link = safeLink(source.url)
                Surface(
                    onClick = { link?.let(ui.onLink) },
                    enabled = link != null,
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier.width(180.dp).height(IntrinsicSize.Min),
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(Icons.Outlined.Public, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(source.sourceName, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text(source.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
fun CardHeader(node: ElementNode) {
    val p = node.p
    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        p.str("title")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() }) }
        p.str("subtitle")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun TextContent(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val base = MaterialTheme.typography.bodyLarge
    val style = when (p.str("size")) {
        "small" -> MaterialTheme.typography.bodyMedium
        "large" -> base.copy(fontSize = 18.sp, lineHeight = 26.sp)
        "small-heavy" -> MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
        "large-heavy" -> base.copy(fontSize = 18.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium)
        else -> base
    }
    val (onLink, sheet) = rememberLinkHandler()
    Markdown(
        withCitations(p.text("text"), ui.sources),
        options = MarkdownOptions(breaks = true, textStyle = style),
        onLink = onLink,
    )
    sheet()
}

@Composable
fun MarkDownRenderer(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val content: @Composable () -> Unit = {
        Markdown(p.text("textMarkdown"), options = MarkdownOptions(gfm = false), onLink = ui.onLink)
    }
    when (p.str("variant")) {
        "card" -> Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Box(Modifier.padding(16.dp)) { content() }
        }
        "sunk" -> Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLowest, modifier = Modifier.fillMaxWidth()) {
            Box(Modifier.padding(16.dp)) { content() }
        }
        else -> content()
    }
}

/** A coloured bar, a title in its colour, and a description. */
@Composable
private fun CalloutBody(accent: Color?, titleColor: Color, title: String?, description: @Composable (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        if (accent != null) Box(Modifier.width(3.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(accent))
        Column(Modifier.padding(start = 14.dp, end = 4.dp)) {
            if (!title.isNullOrEmpty()) Text(title, style = MaterialTheme.typography.titleSmall, color = titleColor)
            description?.invoke()
        }
    }
}

@Composable
fun Callout(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val variant = p.str("variant").let { if (it == "error") "warning" else it }
    val tone = tone(variant) ?: tone("info")!!
    val field = ui.runtime.stateField("visible", p["visible"], formName = null)
    // A bound banner shows while its variable is true, and hides itself after 3 seconds.
    val visible = if (field.isReactive) field.value == true || field.value == "true" else true
    var shown by remember { mutableStateOf(true) }
    LaunchedEffect(visible, field.isReactive) {
        shown = visible
        if (field.isReactive && visible) {
            delay(3_000)
            shown = false
            delay(400)
            field.setValue(false)
        }
    }
    AnimatedVisibility(visible = visible && shown, exit = fadeOut() + shrinkVertically()) {
        CalloutBody(
            accent = tone.accent,
            titleColor = if (variant == "neutral") MaterialTheme.colorScheme.onSurface else tone.accent,
            title = p.str("title"),
            description = p.str("description")?.takeIf { it.isNotEmpty() }?.let { text ->
                { Markdown(text, options = MarkdownOptions(gfm = false), onLink = ui.onLink) }
            },
        )
    }
}

@Composable
fun TextCallout(node: ElementNode) {
    val p = node.p
    val variant = p.str("variant") ?: "neutral"
    val tone = tone(variant)
    CalloutBody(
        accent = tone?.accent,
        titleColor = if (variant == "neutral" || tone == null) MaterialTheme.colorScheme.onSurface else tone.accent,
        title = p.str("title"),
        description = p.str("description")?.takeIf { it.isNotEmpty() }?.let { text -> { Text(text, style = MaterialTheme.typography.bodyLarge) } },
    )
}

/** An image the policy allows, or an empty frame with a broken-image mark. */
@Composable
fun PolicyImage(src: String?, alt: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    val ui = LocalOpenUI.current
    // A URL still streaming in would fail; wait for the whole of it.
    val model = if (ui.streaming) null else rememberImageModel(src)
    if (model == null) {
        Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest).semantics { alt?.let { contentDescription = it } }, contentAlignment = Alignment.Center) {
            if (!ui.streaming && !src.isNullOrBlank()) Icon(Icons.Outlined.BrokenImage, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
        }
    } else {
        AsyncImage(model = model, contentDescription = alt, contentScale = contentScale, modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest))
    }
}

@Composable
fun ImageView(node: ElementNode) {
    val p = node.p
    val shape = RoundedCornerShape(12.dp)
    PolicyImage(
        p.str("src"), p.str("alt"),
        Modifier.fillMaxWidth().aspectRatio(1.5f).clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape),
    )
}

@Composable
fun ImageBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val src = p.str("src")?.takeIf { it.isNotBlank() } ?: return
    val model = if (ui.streaming) null else rememberImageModel(src)
    val shape = RoundedCornerShape(16.dp)
    Box(Modifier.fillMaxWidth().height(240.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
        if (model != null) {
            AsyncImage(model, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().blur(12.dp), alpha = 0.25f)
            SubcomposeAsyncImage(
                model = model,
                contentDescription = p.str("alt"),
                contentScale = ContentScale.Fit,
                loading = { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp) },
                error = { Icon(Icons.Outlined.BrokenImage, contentDescription = null, tint = MaterialTheme.colorScheme.outline) },
                modifier = Modifier.padding(vertical = 16.dp, horizontal = 20.dp).clip(RoundedCornerShape(10.dp)),
            )
        } else if (!ui.streaming) {
            Icon(Icons.Outlined.BrokenImage, contentDescription = p.str("alt"), tint = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
fun ImageGallery(node: ElementNode) {
    val images = node.p.list("images").mapIndexedNotNull { i, raw ->
        val map = raw as? Map<*, *> ?: return@mapIndexedNotNull null
        val src = map["src"] as? String ?: return@mapIndexedNotNull null
        src to ((map["alt"] as? String) ?: "Gallery image ${i + 1}")
    }
    if (images.isEmpty()) return
    var open by remember { mutableStateOf<Int?>(null) }
    val shown = images.take(5)
    val gap = 8.dp
    val shape = RoundedCornerShape(12.dp)
    BoxWithConstraints(Modifier.fillMaxWidth().clip(shape)) {
        val narrow = maxWidth <= 480.dp
        @Composable
        fun Tile(index: Int, modifier: Modifier) {
            Box(modifier.clickable { open = index }) {
                PolicyImage(shown[index].first, shown[index].second, Modifier.fillMaxSize())
            }
        }
        val height = if (shown.size == 1) 260.dp else if (narrow) 240.dp else 320.dp
        when (shown.size) {
            1 -> Tile(0, Modifier.fillMaxWidth().height(height))
            2 -> Row(Modifier.height(height), horizontalArrangement = Arrangement.spacedBy(gap)) {
                Tile(0, Modifier.weight(1f).fillMaxHeight()); Tile(1, Modifier.weight(1f).fillMaxHeight())
            }
            else -> Row(Modifier.height(height), horizontalArrangement = Arrangement.spacedBy(gap)) {
                Tile(0, Modifier.weight(if (shown.size >= 5) 2f else 1f).fillMaxHeight())
                val rest = (1 until shown.size).toList()
                if (shown.size >= 5) {
                    Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(gap)) {
                        rest.chunked(2).forEach { pair ->
                            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(gap)) { pair.forEach { Tile(it, Modifier.weight(1f).fillMaxHeight()) } }
                        }
                    }
                } else {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(gap)) {
                        if (shown.size == 3) rest.forEach { Tile(it, Modifier.weight(1f).fillMaxWidth()) }
                        else {
                            Tile(1, Modifier.weight(1f).fillMaxWidth())
                            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(gap)) { Tile(2, Modifier.weight(1f).fillMaxHeight()); Tile(3, Modifier.weight(1f).fillMaxHeight()) }
                        }
                    }
                }
            }
        }
        if (images.size > 5) {
            Surface(onClick = { open = 0 }, shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primary, modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
                Text("Show all ${images.size}", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            }
        }
    }
    open?.let { start ->
        Dialog(onDismissRequest = { open = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            val pager = rememberPagerState(initialPage = start) { images.size }
            Surface(color = Color.Black, contentColor = Color.White, modifier = Modifier.fillMaxSize()) {
                Box {
                    HorizontalPager(pager, modifier = Modifier.fillMaxSize()) { page ->
                        PolicyImage(images[page].first, images[page].second, Modifier.fillMaxSize(), ContentScale.Fit)
                    }
                    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${pager.currentPage + 1} / ${images.size}", modifier = Modifier.padding(start = 12.dp).weight(1f))
                        IconButton(onClick = { open = null }) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
                    }
                }
            }
        }
    }
}

@Composable
fun OpenUICode(node: ElementNode) {
    val p = node.p
    CodeBlock(p.text("codeString"), p.str("language"), showLanguage = false)
}

@Composable
fun SeparatorView(node: ElementNode) {
    if (node.p.str("orientation") == "vertical") VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    else HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/** Inline markdown in one Text; links open through the card. */
@Composable
fun InlineMarkdown(text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified, maxLines: Int = Int.MAX_VALUE) {
    val ui = LocalOpenUI.current
    val (onLink, sheet) = rememberLinkHandler()
    val annotated = rememberInlineMarkdown(withCitations(text, ui.sources), onLink)
    Text(annotated, style = style, color = color, modifier = modifier, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
    sheet()
}

@Composable
fun InlineHeader(node: ElementNode) {
    val p = node.p
    val heading = p.text("heading")
    val description = p.text("description")
    if (heading.isEmpty() && description.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (heading.isNotEmpty()) InlineMarkdown(heading, MaterialTheme.typography.titleMedium, Modifier.semantics { heading() })
        if (description.isNotEmpty()) InlineMarkdown(description, MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun IconView(node: ElementNode, size: Int = 16, tint: Color = LocalContentColor.current) {
    val icon = OpenUIIcons.resolve(node.p.str("name"), node.p.str("category")) ?: return
    Icon(icon, contentDescription = null, modifier = Modifier.size(size.dp), tint = tint)
}

@Composable
fun TagView(node: ElementNode, forceSize: String? = null, translucent: Boolean = false) {
    val p = node.p
    TagPill(p.text("text"), p.node("icon"), forceSize ?: p.str("size") ?: "md", p.str("variant") ?: "neutral", translucent)
}

@Composable
fun TagPill(text: String, icon: ElementNode?, size: String, variant: String, translucent: Boolean = false) {
    val tone = tone(variant) ?: tone("neutral")!!
    val (height, horizontal, radius) = when (size) {
        "sm" -> Triple(24, 6, 6)
        "lg" -> Triple(36, 12, 8)
        else -> Triple(32, 8, 8)
    }
    val background = if (translucent) Color.Black.copy(alpha = 0.4f) else if (variant == "neutral") MaterialTheme.colorScheme.surfaceContainerHighest else tone.container
    val content = if (translucent) Color.White else if (variant == "neutral") MaterialTheme.colorScheme.onSurface else tone.content
    Row(
        Modifier.height(height.dp).clip(RoundedCornerShape(radius.dp)).background(background).padding(horizontal = horizontal.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (size == "sm") 4.dp else 6.dp),
    ) {
        if (icon != null && !icon.p.str("name").isNullOrEmpty()) IconView(icon, 14, content)
        Text(text, style = MaterialTheme.typography.labelLarge, color = content, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun TagBlock(node: ElementNode) {
    val p = node.p
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        p.list("tags").forEach { tag -> TagPill(cellText(tag), null, p.str("size") ?: "md", "neutral") }
    }
}

@Composable
fun EntityList(node: ElementNode, sizeOverride: String? = null, plain: Boolean = false) {
    val p = node.p
    val small = (sizeOverride ?: p.str("size")) == "small"
    val rows = p.list("rows").mapNotNull { it as? Map<*, *> }
    val header = if (small || plain) null else p.map("header")
    val footer = if (small || plain) null else p.map("footer")
    val all = listOfNotNull(header?.let { it to "header" }) + rows.map { it to "row" } + listOfNotNull(footer?.let { it to "footer" })
    Column(Modifier.fillMaxWidth()) {
        all.forEachIndexed { index, (row, kind) ->
            val leftStyle = if (small) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge
            val rightStyle = when {
                kind == "footer" -> MaterialTheme.typography.titleMedium
                small -> MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
                else -> MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium)
            }
            val color = if (kind == "header") MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
            Row(Modifier.fillMaxWidth().padding(vertical = if (small) 8.dp else 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                InlineMarkdown(cellText(row["left"]), leftStyle, Modifier.weight(1f), color)
                InlineMarkdown(
                    cellText(row["right"]),
                    rightStyle.copy(textAlign = androidx.compose.ui.text.style.TextAlign.End, fontFeatureSettings = if (row["rightVariant"] == "number") "tnum" else null),
                    Modifier.weight(1f), color,
                )
            }
            if (index < all.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
fun StepsView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val items = node.p.nodes("items")
    Column(Modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            val last = index == items.lastIndex
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
                        Text("${index + 1}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                    if (!last) Box(Modifier.padding(vertical = 4.dp).width(2.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
                }
                Column(Modifier.weight(1f).padding(top = 3.dp, bottom = if (last) 0.dp else 18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(item.p.text("title"), style = MaterialTheme.typography.titleSmall)
                    item.p.str("details")?.takeIf { it.isNotEmpty() }?.let {
                        Markdown(it, options = MarkdownOptions(gfm = false, textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)), onLink = ui.onLink)
                    }
                }
            }
        }
    }
}

@Composable
fun ListBlockView(node: ElementNode, sizeOverride: String? = null) {
    val ui = LocalOpenUI.current
    val p = node.p
    val items = p.nodes("items")
    val small = (sizeOverride ?: p.str("size")) == "small"
    val image = p.str("variant") == "image"
    val anySubtitle = items.any { !it.p.str("subtitle").isNullOrEmpty() }
    val indicator = when {
        small && anySubtitle -> 36
        small -> 20
        anySubtitle -> 40
        else -> 24
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (small) 10.dp else 14.dp)) {
        items.forEachIndexed { index, item ->
            val ip = item.p
            val action = ip["action"]
            val clickable = ip.has("action")
            val subtitle = ip.str("subtitle")?.takeIf { it.isNotEmpty() }
            Column {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                        .then(if (clickable) Modifier.clickable { ui.trigger(ip.text("title"), null, action) } else Modifier)
                        .padding(vertical = if (clickable) 4.dp else 0.dp),
                    verticalAlignment = if (subtitle == null) Alignment.CenterVertically else Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier.size(indicator.dp).clip(RoundedCornerShape(if (indicator > 24) 10.dp else 6.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (image) {
                            val img = ip.map("image")
                            if (img != null) PolicyImage(img["src"] as? String, img["alt"] as? String, Modifier.fillMaxSize())
                        } else {
                            Text("${index + 1}", style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(ip.text("title"), style = if (small) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge)
                        if (subtitle != null) Text(subtitle, style = if (small) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (clickable) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.align(Alignment.CenterVertically)) {
                            ip.str("actionLabel")?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
                            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (clickable && index < items.lastIndex) HorizontalDivider(Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
fun FollowUpBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val items = node.p.nodes("items")
    if (items.isEmpty()) return
    Column(Modifier.fillMaxWidth().testTag("openui-followups")) {
        Text("Related", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
        items.forEachIndexed { index, item ->
            val text = item.p.text("text")
            TextButton(
                onClick = { ui.trigger(text, null, null) },
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 10.dp),
            ) {
                Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (index < items.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
