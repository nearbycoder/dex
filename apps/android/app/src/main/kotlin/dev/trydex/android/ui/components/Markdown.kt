package dev.trydex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckBox
import androidx.compose.material.icons.rounded.CheckBoxOutlineBlank
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.Media
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Document
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser
import java.net.URI
import org.commonmark.node.Text as TextNode

/** How a Markdown block renders its parts. */
@Immutable
data class MarkdownOptions(
    /** A single newline breaks the line (OpenUI's TextContent); in chat replies it's a space, as on the web. */
    val breaks: Boolean = false,
    /** GFM: tables, strikethrough, task lists, autolinks. */
    val gfm: Boolean = true,
    val textStyle: TextStyle? = null,
)

private val gfmParser: Parser = Parser.builder()
    .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create(), AutolinkExtension.create(), TaskListItemsExtension.create()))
    .build()
private val plainParser: Parser = Parser.builder().build()

/**
 * Markdown as native views (the web's react-markdown + remark-gfm). Links open in the browser; links and images that
 * are playable media render as players; images from elsewhere stay links (they could leak chat content).
 */
@Composable
fun Markdown(
    text: String,
    modifier: Modifier = Modifier,
    options: MarkdownOptions = MarkdownOptions(),
    onLink: (String) -> Unit = {},
    media: @Composable (Media.Source, String?) -> Unit = { _, _ -> },
) {
    val document = remember(text, options.gfm) { (if (options.gfm) gfmParser else plainParser).parse(text) as Document }
    val style = options.textStyle ?: MaterialTheme.typography.bodyLarge
    val context = MarkdownContext(options, style, onLink, media)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        var child = document.firstChild
        while (child != null) {
            Block(child, context)
            child = child.next
        }
    }
}

private class MarkdownContext(
    val options: MarkdownOptions,
    val style: TextStyle,
    val onLink: (String) -> Unit,
    val media: @Composable (Media.Source, String?) -> Unit,
)

@Composable
private fun Block(node: Node, context: MarkdownContext) {
    when (node) {
        is Paragraph -> Paragraph(node, context)
        is Heading -> {
            val style = when (node.level) {
                1 -> MaterialTheme.typography.headlineSmall
                2 -> MaterialTheme.typography.titleLarge
                3 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            }
            InlineText(node, context, style.copy(fontWeight = FontWeight.SemiBold))
        }
        is BulletList, is OrderedList -> ListBlock(node, context, depth = 0)
        is BlockQuote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
            Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                var child = node.firstChild
                while (child != null) {
                    Block(child, MarkdownContext(context.options, context.style.copy(fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant), context.onLink, context.media))
                    child = child.next
                }
            }
        }
        is FencedCodeBlock -> CodeBlock(node.literal.trimEnd('\n'), node.info)
        is IndentedCodeBlock -> CodeBlock(node.literal.trimEnd('\n'), null)
        is ThematicBreak -> HorizontalDivider(Modifier.padding(vertical = 8.dp))
        is TableBlock -> TableView(node, context)
        // Model output is never rendered as HTML.
        is HtmlBlock -> Text(node.literal, style = context.style, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> InlineText(node, context, context.style)
    }
}

/** A paragraph, with any playable links or images rendered as players after it (alone, if that's all it holds). */
@Composable
private fun Paragraph(node: Paragraph, context: MarkdownContext) {
    val players = mutableListOf<Pair<Media.Source, String?>>()
    val images = mutableListOf<Pair<String, String>>()
    var other = false
    var child = node.firstChild
    while (child != null) {
        when {
            child is Link && Media.source(child.destination) != null -> {
                val label = plainText(child)
                players += Media.source(child.destination)!! to label.takeIf { it != child.destination }
            }
            child is Image && Media.source(child.destination) != null -> players += Media.source(child.destination)!! to plainText(child)
            child is Image && Media.isInlineImage(child.destination) -> images += child.destination to plainText(child)
            child is TextNode && child.literal.isBlank() -> Unit
            child is SoftLineBreak || child is HardLineBreak -> Unit
            else -> other = true
        }
        child = child.next
    }
    if (other) InlineText(node, context, context.style, skipMedia = true)
    images.forEach { (src, alt) ->
        AsyncImage(model = src, contentDescription = alt, modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp).clip(RoundedCornerShape(12.dp)))
    }
    players.forEach { (source, title) -> context.media(source, title) }
}

@Composable
private fun InlineText(node: Node, context: MarkdownContext, style: TextStyle, skipMedia: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    val linkColor = colors.primary
    val codeBackground = colors.surfaceContainerHighest
    val text = remember(node, style, skipMedia, linkColor) {
        buildAnnotatedString { appendInlines(node, context, linkColor, codeBackground, skipMedia) }
    }
    SelectionContainer {
        Text(text, style = style)
    }
}

private fun AnnotatedString.Builder.appendInlines(parent: Node, context: MarkdownContext, linkColor: Color, codeBackground: Color, skipMedia: Boolean) {
    var child = parent.firstChild
    while (child != null) {
        appendInline(child, context, linkColor, codeBackground, skipMedia)
        child = child.next
    }
}

private fun AnnotatedString.Builder.appendInline(node: Node, context: MarkdownContext, linkColor: Color, codeBackground: Color, skipMedia: Boolean) {
    when (node) {
        is TextNode -> append(node.literal)
        is SoftLineBreak -> append(if (context.options.breaks) "\n" else " ")
        is HardLineBreak -> append("\n")
        is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInlines(node, context, linkColor, codeBackground, skipMedia) }
        is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInlines(node, context, linkColor, codeBackground, skipMedia) }
        is Strikethrough -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInlines(node, context, linkColor, codeBackground, skipMedia) }
        is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground, fontSize = 0.9.em())) { append(" ${node.literal} ") }
        is HtmlInline -> append(node.literal)
        is Link -> {
            if (skipMedia && Media.source(node.destination) != null) {
                // The player below stands for it; keep its words.
                val label = plainText(node)
                if (label != node.destination) append(label)
                return
            }
            val url = node.destination
            withLink(LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))) { context.onLink(url) }) {
                appendInlines(node, context, linkColor, codeBackground, skipMedia)
            }
        }
        is Image -> {
            if (skipMedia && (Media.source(node.destination) != null || Media.isInlineImage(node.destination))) return
            // An image from elsewhere: a link to it, never loaded.
            val host = runCatching { URI(node.destination).host }.getOrNull() ?: "external site"
            val url = node.destination
            withLink(LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = linkColor))) { context.onLink(url) }) {
                append("🖼 ${plainText(node).ifEmpty { "Image" }} ($host)")
            }
        }
        else -> appendInlines(node, context, linkColor, codeBackground, skipMedia)
    }
}

/**
 * Markdown flattened to one run of text (OpenUI's inline markdown: bold, italic, code, links, strikethrough; blocks
 * join with spaces).
 */
@Composable
fun rememberInlineMarkdown(text: String, onLink: (String) -> Unit): AnnotatedString {
    val colors = MaterialTheme.colorScheme
    val linkColor = colors.primary
    val codeBackground = colors.surfaceContainerHighest
    val latest = androidx.compose.runtime.rememberUpdatedState(onLink)
    return remember(text, linkColor, codeBackground) {
        val context = MarkdownContext(MarkdownOptions(), TextStyle.Default, { latest.value(it) }, { _, _ -> })
        val document = gfmParser.parse(text)
        buildAnnotatedString {
            var block = document.firstChild
            while (block != null) {
                if (block !== document.firstChild) append(" ")
                appendInlines(block, context, linkColor, codeBackground, skipMedia = false)
                block = block.next
            }
        }
    }
}

private fun Double.em() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Em)

private fun plainText(node: Node): String {
    val out = StringBuilder()
    fun walk(n: Node) {
        when (n) {
            is TextNode -> out.append(n.literal)
            is Code -> out.append(n.literal)
            is SoftLineBreak, is HardLineBreak -> out.append(' ')
            else -> {
                var c = n.firstChild
                while (c != null) {
                    walk(c)
                    c = c.next
                }
            }
        }
    }
    walk(node)
    return out.toString()
}

@Composable
private fun ListBlock(node: Node, context: MarkdownContext, depth: Int) {
    val ordered = node is OrderedList
    var number = (node as? OrderedList)?.markerStartNumber ?: 1
    Column(Modifier.padding(start = if (depth > 0) 16.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        var item = node.firstChild
        while (item != null) {
            if (item is ListItem) {
                val task = item.firstChild?.firstChild as? TaskListItemMarker ?: item.firstChild as? TaskListItemMarker
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (task != null) {
                        Icon(
                            if (task.isChecked) Icons.Rounded.CheckBox else Icons.Rounded.CheckBoxOutlineBlank,
                            contentDescription = if (task.isChecked) "Done" else "Not done",
                            modifier = Modifier.size(20.dp).padding(top = 2.dp),
                            tint = if (task.isChecked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                        )
                    } else {
                        Text(if (ordered) "${number}." else "•", style = context.style, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.widthIn(min = 16.dp))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        var child = item.firstChild
                        while (child != null) {
                            when (child) {
                                // The checkbox is drawn beside the item already.
                                is TaskListItemMarker -> Unit
                                is BulletList, is OrderedList -> ListBlock(child, context, depth + 1)
                                is Paragraph -> InlineText(child, context, context.style)
                                else -> Block(child, context)
                            }
                            child = child.next
                        }
                    }
                }
                number++
            }
            item = item.next
        }
    }
}

@Composable
private fun TableView(node: TableBlock, context: MarkdownContext) {
    val rows = mutableListOf<Pair<Boolean, List<TableCell>>>()
    var section = node.firstChild
    while (section != null) {
        var row = section.firstChild
        while (row != null) {
            if (row is TableRow) {
                val cells = mutableListOf<TableCell>()
                var cell = row.firstChild
                while (cell != null) {
                    if (cell is TableCell) cells += cell
                    cell = cell.next
                }
                rows += (section is TableHead) to cells
            }
            row = row.next
        }
        section = section.next
    }
    if (rows.isEmpty()) return
    val columns = rows.maxOf { it.second.size }
    val shape = RoundedCornerShape(16.dp)
    val line = MaterialTheme.colorScheme.outlineVariant
    val head = MaterialTheme.colorScheme.surfaceContainerHigh
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().clip(shape).border(1.dp, line, shape)) {
        val width = maxWidth
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            TableGrid(
                rows = rows.size,
                columns = columns,
                modifier = Modifier.widthIn(min = width),
                rowBackground = { r ->
                    Box(
                        Modifier.background(if (rows[r].first) head else Color.Transparent).drawBehind {
                            if (r < rows.lastIndex) drawLine(line, androidx.compose.ui.geometry.Offset(0f, size.height - 0.5f), androidx.compose.ui.geometry.Offset(size.width, size.height - 0.5f), 1f)
                        },
                    )
                },
            ) { r, c ->
                val (isHead, cells) = rows[r]
                val cell = cells.getOrNull(c)
                Box(Modifier.widthIn(min = 56.dp, max = 320.dp).padding(horizontal = 12.dp, vertical = 8.dp)) {
                    if (cell != null) {
                        val style = if (isHead) MaterialTheme.typography.labelLarge.copy(color = MaterialTheme.colorScheme.onSurfaceVariant) else MaterialTheme.typography.bodyMedium
                        InlineText(cell, context, style.copy(textAlign = when (cell.alignment) {
                            TableCell.Alignment.CENTER -> androidx.compose.ui.text.style.TextAlign.Center
                            TableCell.Alignment.RIGHT -> androidx.compose.ui.text.style.TextAlign.End
                            else -> androidx.compose.ui.text.style.TextAlign.Start
                        }))
                    }
                }
            }
        }
    }
}

/** Code in a dark, horizontally scrolling block with a copy button. */
@Composable
fun CodeBlock(code: String, language: String? = null, modifier: Modifier = Modifier, showLanguage: Boolean = true) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    val colors = DexTheme.colors
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = colors.codeBackground, contentColor = colors.codeText) {
        Box {
            Column {
                if (showLanguage && !language.isNullOrBlank()) {
                    Text(language, style = MaterialTheme.typography.labelSmall, color = colors.codeText.copy(alpha = 0.6f), modifier = Modifier.padding(start = 14.dp, top = 10.dp))
                }
                SelectionContainer {
                    Text(
                        Highlighter.highlight(code, language),
                        style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 19.sp),
                        softWrap = false,
                        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 14.dp, end = 48.dp, top = if (!showLanguage || language.isNullOrBlank()) 12.dp else 4.dp, bottom = 12.dp),
                    )
                }
            }
            IconButton(
                onClick = {
                    scope.launch {
                        clipboard.setClipEntry(androidx.compose.ui.platform.ClipEntry(android.content.ClipData.newPlainText("code", code)))
                        copied = true
                        delay(1_500)
                        copied = false
                    }
                },
                modifier = Modifier.align(Alignment.TopEnd).size(40.dp),
            ) {
                Icon(if (copied) Icons.Rounded.Check else Icons.Outlined.ContentCopy, contentDescription = if (copied) "Copied" else "Copy code", modifier = Modifier.size(18.dp), tint = if (copied) colors.success else LocalContentColor.current.copy(alpha = 0.7f))
            }
        }
    }
}
