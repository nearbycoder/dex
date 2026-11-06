import Markdown
import SwiftUI

/// Renders Markdown as the web does (react-markdown with remark-gfm), natively: headings, paragraphs, lists (task lists
/// too), quotes, code blocks with copy, tables (aligned, scrolling sideways in their own frame), thematic breaks,
/// footnotes, inline styles, links, and bare URLs as links. Raw HTML is shown as text, as on the web.
struct MarkdownView: View {
    let text: String
    var font: Font = .body
    /// Links are opened here (the chat routes Dex links in-app).
    var onLink: ((URL) -> Void)? = nil
    /// Still being written (a streaming reply): parsed each time, not kept.
    var live = false

    var body: some View {
        let document = live ? MarkdownDocument(parsing: text) : MarkdownCache.document(text)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlock(block: block, font: font)
            }
            if !document.footnotes.isEmpty {
                FootnotesView(footnotes: document.footnotes, font: font)
            }
        }
        .environment(\.markdownFootnotes, document.numbers)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            if let onLink { onLink(url); return .handled }
            return .systemAction
        })
        .textSelection(.enabled)
    }
}

/// A parsed reply: its blocks, and its footnotes (remark-gfm's `[^label]` references and `[^label]: …` definitions,
/// which CommonMark alone shows as text or, when the note is one word, hides as a link definition).
struct MarkdownDocument {
    struct Footnote {
        let number: Int
        let text: AttributedString
    }

    /// The blocks to draw, without the footnote definitions.
    let blocks: [any BlockMarkup]
    /// The referenced footnotes, numbered in the order they're first referenced.
    let footnotes: [Footnote]
    /// Each referenced footnote's number by its label.
    let numbers: [String: Int]

    /// GFM as remark parses it: no smart punctuation (`--force` and "quotes" stay as written), and none of DocC's
    /// extensions (`@Directive` blocks, ``symbol`` links).
    static func parse(_ text: String) -> Markdown.Document { Markdown.Document(parsing: text, options: [.disableSmartOpts]) }

    init(parsing text: String) {
        let document = Self.parse(text)
        var blocks: [any BlockMarkup] = []
        var definitions: [String: AttributedString] = [:]
        for block in document.blockChildren {
            if let paragraph = block as? Paragraph, let notes = Self.definitions(paragraph) {
                for (label, note) in notes where definitions[label] == nil { definitions[label] = note }
            } else {
                blocks.append(block)
            }
        }
        // Numbered by first reference, as remark does; definitions nothing refers to aren't shown.
        var numbers: [String: Int] = [:]
        var footnotes: [Footnote] = []
        if text.contains("[^") {
            for block in blocks { Self.references(in: block) { label, oneWord in
                guard numbers[label] == nil, let note = definitions[label] ?? oneWord else { return }
                numbers[label] = footnotes.count + 1
                footnotes.append(Footnote(number: footnotes.count + 1, text: Inline.decorate(note)))
            } }
        }
        self.blocks = blocks
        self.footnotes = footnotes
        self.numbers = numbers
    }

    private static let definition = /^\[\^([^\]\s]+)\]:[ \t]*/

    /// A paragraph of footnote definitions (each line that starts `[^label]:` begins one), or nil if it isn't one.
    static func definitions(_ paragraph: Paragraph) -> [(String, AttributedString)]? {
        guard paragraph.plainText.hasPrefix("[^") else { return nil }
        let text = Inline.build(paragraph.inlineChildren, softBreak: "\n")
        guard String(text.characters).prefixMatch(of: definition) != nil else { return nil }
        var notes: [(String, AttributedString)] = []
        var lineStart = text.startIndex
        while lineStart < text.endIndex {
            let lineEnd = text.characters[lineStart...].firstIndex(of: "\n") ?? text.endIndex
            let line = text[lineStart..<lineEnd]
            if let match = String(line.characters).prefixMatch(of: definition) {
                let start = line.characters.index(line.startIndex, offsetBy: match.0.count)
                notes.append((String(match.1), AttributedString(text[start..<lineEnd])))
            } else if !notes.isEmpty {
                notes[notes.count - 1].1 += AttributedString(" ") + AttributedString(line)
            }
            lineStart = lineEnd < text.endIndex ? text.characters.index(after: lineEnd) : lineEnd
        }
        return notes
    }

    /// Footnote references in document order: `[^label]` in text, and links CommonMark made of a one-word note
    /// (`[^label]: https://…` is a link definition to it), with that note.
    static func references(in markup: Markup, _ found: (String, AttributedString?) -> Void) {
        if let text = markup as? Markdown.Text {
            for match in text.string.matches(of: Inline.footnoteReference) { found(String(match.1), nil) }
            return
        }
        if markup is InlineCode || markup is CodeBlock { return }
        if let link = markup as? Markdown.Link, let label = Inline.footnoteLabel(link) {
            var note = AttributedString(link.destination ?? "")
            if let destination = link.destination, let url = URL(string: destination), url.scheme != nil { note.link = url }
            found(label, note)
            return
        }
        for child in markup.children { references(in: child, found) }
    }
}

/// Parsed documents by their text, so a reply drawn again (scrolled back into view, its chat opened again) isn't parsed
/// again.
@MainActor
enum MarkdownCache {
    private final class Box {
        let document: MarkdownDocument
        init(_ document: MarkdownDocument) { self.document = document }
    }

    private static let documents: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 400
        return cache
    }()

    static func document(_ text: String) -> MarkdownDocument {
        let key = text as NSString
        if let box = documents.object(forKey: key) { return box.document }
        let document = MarkdownDocument(parsing: text)
        documents.setObject(Box(document), forKey: key)
        return document
    }
}

extension EnvironmentValues {
    /// The footnote numbers of the document being drawn, by label.
    @Entry var markdownFootnotes: [String: Int] = [:]
}

/// The notes at the end, under a rule (remark-gfm's footnotes section).
private struct FootnotesView: View {
    let footnotes: [MarkdownDocument.Footnote]
    let font: Font

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider().padding(.vertical, 4)
            ForEach(footnotes, id: \.number) { note in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    SwiftUI.Text("\(note.number).").monospacedDigit().foregroundStyle(.secondary)
                    SwiftUI.Text(note.text).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .font(font == .body ? .footnote : .caption)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Footnotes")
    }
}

private struct MarkdownBlock: View {
    @Environment(\.markdownFootnotes) private var notes
    let block: any BlockMarkup
    let font: Font

    var body: some View {
        switch block {
        case let heading as Heading:
            SwiftUI.Text(Inline.attributed(heading.inlineChildren, notes: notes))
                .font(headingFont(heading.level))
                .padding(.top, heading.level <= 2 ? 6 : 2)
                .accessibilityAddTraits(.isHeader)
        case let paragraph as Paragraph:
            ParagraphView(paragraph: paragraph, font: font)
        case let code as CodeBlock:
            CodeBlockView(code: code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code, language: code.language)
        case let list as UnorderedList:
            ListView(items: Array(list.listItems), ordered: false, start: 1, font: font)
        case let list as OrderedList:
            ListView(items: Array(list.listItems), ordered: true, start: Int(list.startIndex), font: font)
        case let quote as BlockQuote:
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(.tint.opacity(0.6)).frame(width: 3)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(quote.blockChildren.enumerated()), id: \.offset) { _, child in
                        MarkdownBlock(block: child, font: font)
                    }
                }
                .foregroundStyle(.secondary)
            }
        case let table as Markdown.Table:
            TableView(table: table, font: font)
        case is ThematicBreak:
            Divider().padding(.vertical, 4)
        case let html as HTMLBlock:
            // As text, as the web shows it (no HTML is rendered).
            SwiftUI.Text(html.rawHTML.trimmingCharacters(in: .newlines)).font(font)
        default:
            SwiftUI.Text(block.format()).font(font)
        }
    }

    /// Each level a step down, never below the text around it (the web's prose sizes, for a phone). In small text (an
    /// activity step, a space's update) headings stay close to it.
    private func headingFont(_ level: Int) -> Font {
        guard font == .body else { return level <= 2 ? font.bold() : font.weight(.semibold) }
        return switch level {
        case 1: .title2.bold()
        case 2: .title3.bold()
        case 3: .title3.weight(.semibold)
        default: .headline
        }
    }
}

/// Shows links to media (videos, audio, images) as players in a Markdown paragraph. Set by the chat; without it,
/// links stay links.
struct MarkdownMedia {
    /// Whether a link is media this resolver can show.
    let accepts: (String) -> Bool
    /// The player for a link and its label (nil when the label is just the link).
    let view: (_ url: String, _ title: String?) -> AnyView
}

extension EnvironmentValues {
    @Entry var markdownMedia: MarkdownMedia? = nil
}

/// A paragraph, followed by players for the media it links (the paragraph's text is left out when it's only links).
private struct ParagraphView: View {
    @Environment(\.markdownMedia) private var media
    @Environment(\.markdownFootnotes) private var notes
    let paragraph: Paragraph
    let font: Font

    var body: some View {
        let links = media.map { media in Self.links(in: paragraph).filter { media.accepts($0.url) } } ?? []
        VStack(alignment: .leading, spacing: 8) {
            if links.isEmpty || !Self.onlyLinks(paragraph, links: links) {
                SwiftUI.Text(Inline.attributed(paragraph.inlineChildren, notes: notes))
                    .font(font)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let media {
                ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                    media.view(link.url, link.title)
                }
            }
        }
    }

    /// Links, images, and bare URLs in a paragraph, in order, once each.
    static func links(in paragraph: Paragraph) -> [(url: String, title: String?)] {
        var found: [(url: String, title: String?)] = []
        func add(_ url: String, _ title: String?) {
            if !found.contains(where: { $0.url == url }) { found.append((url, title?.isEmpty == false && title != url ? title : nil)) }
        }
        func walk(_ markup: Markup) {
            if let link = markup as? Markdown.Link, let destination = link.destination { add(destination, link.plainText); return }
            if let image = markup as? Markdown.Image, let source = image.source { add(source, image.plainText); return }
            if let text = markup as? Markdown.Text {
                for match in text.string.matches(of: /https?:\/\/[^\s)<>"'\]]+/) { add(String(match.0).trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?")), nil) }
                return
            }
            for child in markup.children { walk(child) }
        }
        walk(paragraph)
        return found
    }

    /// Whether the paragraph says nothing besides these links (then only their players show).
    static func onlyLinks(_ paragraph: Paragraph, links: [(url: String, title: String?)]) -> Bool {
        var rest = paragraph.plainText
        for link in links {
            rest = rest.replacingOccurrences(of: link.url, with: "")
            if let title = link.title { rest = rest.replacingOccurrences(of: title, with: "") }
        }
        return rest.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).isEmpty
    }
}

private struct ListView: View {
    let items: [ListItem]
    let ordered: Bool
    let start: Int
    let font: Font

    var body: some View {
        // Numbers line up on their right edge, as the web's do: each takes the width of the widest one.
        let widest = String(repeating: "0", count: String(start + max(items.count - 1, 0)).count) + "."
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Group {
                        if let checkbox = item.checkbox {
                            Image(systemName: checkbox == .checked ? "checkmark.square.fill" : "square")
                                .foregroundStyle(checkbox == .checked ? Color.dexAccent : .secondary)
                                .accessibilityLabel(checkbox == .checked ? "Done" : "Not done")
                        } else if ordered {
                            SwiftUI.Text(widest).monospacedDigit().hidden()
                                .overlay(alignment: .trailing) { SwiftUI.Text("\(start + index).").monospacedDigit() }
                        } else {
                            SwiftUI.Text("•")
                        }
                    }
                    .font(font)
                    .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(item.blockChildren.enumerated()), id: \.offset) { _, child in
                            MarkdownBlock(block: child, font: font)
                        }
                    }
                }
            }
        }
    }
}

/// A table as the web draws it: a muted header row, a rule between rows, each column aligned as its delimiter row says.
private struct TableView: View {
    @Environment(\.markdownFootnotes) private var notes
    let table: Markdown.Table
    let font: Font

    var body: some View {
        let header = Array(table.head.cells)
        let rows = table.body.rows.map { Array($0.cells) }
        let alignments = table.columnAlignments
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { column, cell in
                        cellView(cell, alignment(alignments, column))
                            .font(font.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
                .background(.quaternary.opacity(0.5))
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider().gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, cell in cellView(cell, alignment(alignments, column)).font(font) }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.quaternary))
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        // A horizontal scroll view would otherwise ask for its content's width and push the page wider.
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func alignment(_ alignments: [Markdown.Table.ColumnAlignment?], _ column: Int) -> TextAlignment {
        switch column < alignments.count ? alignments[column] : nil {
        case .center: .center
        case .right: .trailing
        default: .leading
        }
    }

    private func cellView(_ cell: Markdown.Table.Cell, _ alignment: TextAlignment) -> some View {
        // swift-markdown reads a lone `^` as "the cell above spans this row too"; GFM shows it.
        let text = cell.rowspan == 0 ? AttributedString("^") : Inline.attributed(cell.inlineChildren, notes: notes)
        return CappedWidth(min: 60, max: 280, alignment: alignment) {
            SwiftUI.Text(text).multilineTextAlignment(alignment)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
    }
}

/// A table cell's text at its own width, between `min` and `max`, and as tall as it wraps at that width. (A plain
/// `.frame(maxWidth:)` reports the one-line height when the table asks for its ideal size, so a cell that wraps, as with
/// large text, would spill over the row below.)
private struct CappedWidth: Layout {
    let min: CGFloat
    let max: CGFloat
    var alignment: TextAlignment = .leading

    private func width(_ proposal: ProposedViewSize, _ subview: LayoutSubview) -> CGFloat {
        let wanted = proposal.width ?? subview.sizeThatFits(.unspecified).width
        return Swift.min(Swift.max(wanted, min), max)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let subview = subviews.first else { return .zero }
        let width = width(proposal, subview)
        return CGSize(width: width, height: subview.sizeThatFits(ProposedViewSize(width: width, height: nil)).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let subview = subviews.first else { return }
        let size = ProposedViewSize(width: bounds.width, height: nil)
        let spare = bounds.width - subview.sizeThatFits(size).width
        let x = switch alignment {
        case .leading: bounds.minX
        case .center: bounds.minX + spare / 2
        case .trailing: bounds.minX + spare
        }
        subview.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: size)
    }
}

/// A code block with its language and a copy button.
struct CodeBlockView: View {
    let code: String
    var language: String? = nil
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SwiftUI.Text(language?.isEmpty == false ? language! : "code")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption)
                        .labelStyle(.iconOnly)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(copied ? "Copied" : "Copy code")
                .sensoryFeedback(.success, trigger: copied) { _, new in new }
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(1.5))
                    copied = false
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.4))
            // Long lines scroll sideways: the indicator shows (and flashes when the block appears) so that's clear.
            ScrollView(.horizontal, showsIndicators: true) {
                SwiftUI.Text(code)
                    .font(.callout.monospaced())
                    .padding(12)
                    .textSelection(.enabled)
            }
            .scrollIndicatorsFlash(onAppear: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.quaternary))
    }
}

/// Inline Markdown as an AttributedString.
enum Inline {
    /// Inline content as the web shows it: styled, with bare URLs and email addresses linked and footnote references
    /// (by their labels in `notes`) as superscript numbers.
    static func attributed(_ children: some Sequence<any InlineMarkup>, notes: [String: Int] = [:]) -> AttributedString {
        decorate(build(children), notes: notes)
    }

    /// The styled runs, before `decorate`. `softBreak` is what a line break inside a paragraph becomes.
    static func build(_ children: some Sequence<any InlineMarkup>, softBreak: String = " ") -> AttributedString {
        var result = AttributedString()
        for child in children { result += build(child, softBreak: softBreak) }
        return result
    }

    private static func build(_ markup: any InlineMarkup, softBreak: String) -> AttributedString {
        switch markup {
        case let text as Markdown.Text:
            return AttributedString(text.string)
        case let strong as Strong:
            var inner = build(strong.inlineChildren, softBreak: softBreak)
            for run in inner.runs { inner[run.range].inlinePresentationIntent = (run.inlinePresentationIntent ?? []).union(.stronglyEmphasized) }
            return inner
        case let emphasis as Emphasis:
            var inner = build(emphasis.inlineChildren, softBreak: softBreak)
            for run in inner.runs { inner[run.range].inlinePresentationIntent = (run.inlinePresentationIntent ?? []).union(.emphasized) }
            return inner
        case let strike as Strikethrough:
            var inner = build(strike.inlineChildren, softBreak: softBreak)
            inner.strikethroughStyle = .single
            return inner
        case let code as InlineCode:
            var inner = AttributedString(code.code)
            inner.inlinePresentationIntent = .code
            inner.backgroundColor = Color.primary.opacity(0.08)
            return inner
        case let link as Markdown.Link:
            // `[^label]` that CommonMark resolved against `[^label]: word`: a footnote reference, for `decorate`.
            if let label = footnoteLabel(link) { return AttributedString("[^\(label)]") }
            var inner = build(link.inlineChildren, softBreak: softBreak)
            if let destination = link.destination, let url = URL(string: destination) {
                inner.link = url
                inner.underlineStyle = .single
            }
            return inner
        case let image as Markdown.Image:
            // The web loads only images Dex serves; others are a link naming the site. (Media the chat can show plays
            // under the paragraph.)
            let source = image.source ?? ""
            let alt = image.plainText.isEmpty ? "Image" : image.plainText
            let host = URL(string: source)?.host()
            var inner = AttributedString("🖼 " + alt + (host.map { " (\($0))" } ?? ""))
            if let url = URL(string: source) { inner.link = url }
            return inner
        case is SoftBreak:
            return AttributedString(softBreak)
        case is LineBreak:
            return AttributedString("\n")
        case let html as InlineHTML:
            return AttributedString(html.rawHTML)
        default:
            return AttributedString(markup.plainText)
        }
    }

    static let footnoteReference = /\[\^([^\]\s]+)\]/

    /// A link CommonMark made of `[^label]` (a footnote whose note is one word, read as a link definition): its label.
    static func footnoteLabel(_ link: Markdown.Link) -> String? {
        let text = link.plainText
        guard text.hasPrefix("^"), text.count > 1, !text.contains(where: \.isWhitespace), link.childCount == 1,
              let range = link.range, range.lowerBound.line == range.upperBound.line,
              range.upperBound.column - range.lowerBound.column == text.utf8.count + 2 else { return nil }
        return String(text.dropFirst())
    }

    /// GFM's extended autolinks (`https://…`, `www.…`, `name@example.com`), as remark-gfm finds them: after a space,
    /// a line's start, or `*_~(`, and without trailing punctuation or an unmatched `)`.
    static let autolink = /(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)*[^\s<]*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/

    /// Links bare URLs and turns footnote references into numbers, outside code and existing links.
    static func decorate(_ text: AttributedString, notes: [String: Int] = [:]) -> AttributedString {
        let string = String(text.characters)
        let links = string.contains("www.") || string.contains("://") || string.contains("@")
        let references = !notes.isEmpty && string.contains("[^")
        guard links || references else { return text }
        var result = text
        var edits: [(range: Range<String.Index>, apply: (inout AttributedString, Range<AttributedString.Index>) -> Void)] = []
        if links {
            for match in string.matches(of: autolink) {
                if match.range.lowerBound > string.startIndex {
                    let before = string[string.index(before: match.range.lowerBound)]
                    guard before.isWhitespace || "*_~(".contains(before) else { continue }
                }
                let found = trimmed(string[match.range])
                guard !found.isEmpty else { continue }
                let target = found.contains("@") && !found.contains("/") && !found.hasPrefix("www.") ? "mailto:" + found
                    : found.hasPrefix("www.") ? "http://" + found : String(found)
                guard let url = URL(string: target) else { continue }
                edits.append((found.startIndex..<found.endIndex, { text, range in
                    text[range].link = url
                    text[range].underlineStyle = .single
                }))
            }
        }
        if references {
            for match in string.matches(of: footnoteReference) {
                guard let number = notes[String(match.1)] else { continue }
                edits.append((match.range, { text, range in
                    var mark = AttributedString("\(number)")
                    mark[AttributeScopes.SwiftUIAttributes.BaselineOffsetAttribute.self] = 6
                    mark[AttributeScopes.SwiftUIAttributes.FontAttribute.self] = .caption2
                    mark[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Color.accentColor
                    text.replaceSubrange(range, with: mark)
                }))
            }
        }
        // From the end, so the earlier ranges stay where they were.
        for edit in edits.sorted(by: { $0.range.lowerBound > $1.range.lowerBound }) {
            let lower = string.distance(from: string.startIndex, to: edit.range.lowerBound)
            let count = string.distance(from: edit.range.lowerBound, to: edit.range.upperBound)
            let start = result.characters.index(result.startIndex, offsetBy: lower)
            let range = start..<result.characters.index(start, offsetBy: count)
            guard result[range].runs.allSatisfy({ $0.link == nil && $0.inlinePresentationIntent?.contains(.code) != true }) else { continue }
            edit.apply(&result, range)
        }
        return result
    }

    /// A found link without what GFM leaves off its end: trailing punctuation, an entity, or a `)` it didn't open.
    private static func trimmed(_ link: Substring) -> Substring {
        var link = link
        while let last = link.last {
            if "?!.,:*_~;".contains(last) {
                if last == ";", let amp = link.lastIndex(of: "&"), link[link.index(after: amp)...].dropLast().allSatisfy(\.isLetter) {
                    link = link[..<amp]
                } else {
                    link = link.dropLast()
                }
            } else if last == ")", link.filter({ $0 == ")" }).count > link.filter({ $0 == "(" }).count {
                link = link.dropLast()
            } else {
                break
            }
        }
        // An email can't end in `-` or `_`.
        if link.contains("@"), !link.contains("/"), let last = link.last, last == "-" || last == "_" { return link.prefix(0) }
        return link
    }
}

extension Markup {
    var plainText: String {
        if let text = self as? Markdown.Text { return text.string }
        return children.map(\.plainText).joined()
    }
}
