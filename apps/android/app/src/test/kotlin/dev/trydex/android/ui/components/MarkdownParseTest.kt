package dev.trydex.android.ui.components

import com.google.common.truth.Truth.assertThat
import org.commonmark.ext.footnotes.FootnoteDefinition
import org.commonmark.ext.footnotes.FootnoteReference
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.LinkReferenceDefinition
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.ThematicBreak
import org.junit.Test
import org.commonmark.node.Text as TextNode

/** The syntax tree the renderer draws, for everything remark-gfm gives the web (the fixture is the reference). */
class MarkdownParseTest {
    private val fixture = javaClass.classLoader!!.getResource("markdown-fixture.md")!!.readText()
    private val document = parseMarkdown(fixture)

    private fun all(node: Node = document): List<Node> = buildList {
        var child = node.firstChild
        while (child != null) {
            add(child)
            addAll(all(child))
            child = child.next
        }
    }

    private inline fun <reified T : Node> nodes() = all().filterIsInstance<T>()

    private fun text(node: Node): String = when (node) {
        is TextNode -> node.literal
        is Code -> node.literal
        else -> all(node).filter { it.parent === node }.joinToString("") { text(it) }
    }

    @Test fun headingsOneToSix() {
        assertThat(nodes<Heading>().map { it.level to text(it) })
            .containsExactly(1 to "Heading 1", 2 to "Heading 2", 3 to "Heading 3", 4 to "Heading 4", 5 to "Heading 5", 6 to "Heading 6").inOrder()
    }

    @Test fun inlineStyles() {
        assertThat(nodes<StrongEmphasis>().map(::text)).containsAtLeast("bold", "init", "side")
        assertThat(nodes<Emphasis>().map(::text)).containsAtLeast("italic", "this")
        // ***x*** is both, nested.
        assertThat(nodes<Emphasis>().any { it.firstChild is StrongEmphasis && text(it) == "bold and italic" }).isTrue()
        assertThat(nodes<Strikethrough>().map(::text)).containsAtLeast("strikethrough", "single tilde", "a strike", "gone")
        assertThat(nodes<Code>().map { it.literal }).containsAtLeast("inline code", "code", "x = 1")
        assertThat(nodes<HardLineBreak>()).hasSize(2)
    }

    @Test fun escapesEntitiesAndWordsWithUnderscores() {
        val escapes = text(nodes<Paragraph>().first { text(it).startsWith("Escapes") })
        assertThat(escapes).contains("*not italic*, `not code`, # not a heading, and 2 * 3.")
        assertThat(escapes).contains("© & <tag> —  done.")
        assertThat(escapes).contains("snake_case_name and ")
        assertThat(escapes).contains("file_name.txt")
        assertThat(nodes<Emphasis>().map(::text)).containsNoneOf("case", "name")
    }

    @Test fun lists() {
        val bullets = nodes<BulletList>().first()
        assertThat(nodes<BulletList>().count { generateSequence(it.parent) { p -> p.parent }.any { p -> p is BulletList } }).isAtLeast(2)
        assertThat(bullets.isTight).isTrue()
        val ordered = nodes<OrderedList>()
        assertThat(ordered.map { it.markerStartNumber }).containsAtLeast(1, 5)
        // A bullet list inside an ordered one.
        assertThat(nodes<BulletList>().any { it.parent is ListItem && it.parent.parent is OrderedList }).isTrue()
        val loose = nodes<BulletList>().first { text(it).startsWith("A loose item") }
        assertThat(loose.isTight).isFalse()
        assertThat(loose.firstChild!!.firstChild!!.next).isInstanceOf(Paragraph::class.java)
        assertThat(nodes<FencedCodeBlock>().any { it.parent is ListItem && it.info == "sh" }).isTrue()
    }

    @Test fun taskLists() {
        assertThat(nodes<TaskListItemMarker>().map { it.isChecked }).containsExactly(false, true, false).inOrder()
    }

    @Test fun codeBlocks() {
        assertThat(nodes<FencedCodeBlock>().map { it.info }).containsExactly("sh", "kotlin", "").inOrder()
        assertThat(nodes<IndentedCodeBlock>().single().literal).isEqualTo("An indented code block.\nSecond line.\n")
    }

    @Test fun tables() {
        val tables = nodes<TableBlock>()
        assertThat(tables).hasSize(2)
        val head = all(tables[0]).filterIsInstance<TableCell>().filter { it.isHeader }
        assertThat(head.map { it.alignment }).containsExactly(TableCell.Alignment.LEFT, TableCell.Alignment.CENTER, TableCell.Alignment.RIGHT, null).inOrder()
        assertThat(all(tables[0]).any { it is StrongEmphasis }).isTrue()
        assertThat(all(tables[0]).any { it is Code && it.literal == "x = 1" }).isTrue()
        assertThat(all(tables[1]).filterIsInstance<TableCell>().count { it.isHeader }).isEqualTo(13)
    }

    @Test fun linksOfEveryKind() {
        assertThat(nodes<Link>().map { it.destination }).containsAtLeast(
            "https://example.com",
            "https://example.com/ref",
            "https://example.com/collapsed",
            "https://autolink.example.com",
            "https://bare.example.com/path",
            "http://www.example.org",
            "mailto:mail@example.com",
        )
        assertThat(nodes<LinkReferenceDefinition>()).hasSize(2)
        assertThat(nodes<Image>().single().destination).isEqualTo("https://example.com/cat.png")
    }

    @Test fun rulesAndHtml() {
        assertThat(nodes<ThematicBreak>()).hasSize(2)
        assertThat(nodes<HtmlBlock>().single().literal.trim()).isEqualTo("<div>An HTML block</div>")
    }

    @Test fun footnotesNumberedByFirstReference() {
        assertThat(nodes<FootnoteReference>().map { it.label }).containsExactly("1", "note").inOrder()
        val footnotes = Footnotes.of(document)
        assertThat(footnotes.numbers).containsExactly("1", 1, "note", 2)
        assertThat(footnotes.definitions.map { text(it.firstChild) }).containsExactly("The first footnote.", "A named footnote with bold.").inOrder()
        assertThat(nodes<FootnoteDefinition>()).hasSize(2)
    }

    @Test fun footnotesUnreferencedDroppedAndRenumbered() {
        val doc = parseMarkdown("B[^b] then A[^a] and B again[^b].\n\n[^a]: A.\n[^b]: B.\n[^c]: Never used.")
        val footnotes = Footnotes.of(doc)
        assertThat(footnotes.numbers).containsExactly("b", 1, "a", 2).inOrder()
        assertThat(footnotes.definitions.map { it.label }).containsExactly("b", "a").inOrder()
    }

    @Test fun halfFinishedRepliesParse() {
        // Every prefix of a reply, as it streams: never throws, and an open fence is already a code block.
        for (end in 0..fixture.length) Footnotes.of(parseMarkdown(fixture.substring(0, end)))
        val open = parseMarkdown("Here:\n\n```kotlin\nfun main() {")
        assertThat((open.lastChild as FencedCodeBlock).literal).isEqualTo("fun main() {\n")
        // A table's header row alone stays a paragraph until its delimiter row arrives, as with remark-gfm.
        assertThat(parseMarkdown("| a | b |").firstChild).isInstanceOf(Paragraph::class.java)
        assertThat(parseMarkdown("| a | b |\n|---|---|").firstChild).isInstanceOf(TableBlock::class.java)
    }

    @Test fun commonMarkAloneForOpenUi() {
        val doc = parseMarkdown("~~no~~ | a |\n|---|\n\nhttps://x.example", gfm = false)
        assertThat(all(doc).none { it is Strikethrough || it is TableBlock || it is Link }).isTrue()
    }
}
