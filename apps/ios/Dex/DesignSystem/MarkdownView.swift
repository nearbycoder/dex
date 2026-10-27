import Markdown
import SwiftUI

/// Renders Markdown (GitHub flavored) natively: headings, paragraphs, lists, quotes, code blocks with copy, tables
/// that scroll sideways in their own frame, thematic breaks, and inline styles and links. Raw HTML is shown as text.
struct MarkdownView: View {
    let text: String
    var font: Font = .body
    /// Links are opened here (the chat routes Dex links in-app).
    var onLink: ((URL) -> Void)? = nil

    var body: some View {
        let document = Document(parsing: text, options: [.parseBlockDirectives, .parseSymbolLinks])
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(document.blockChildren.enumerated()), id: \.offset) { _, block in
                MarkdownBlock(block: block, font: font)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            if let onLink { onLink(url); return .handled }
            return .systemAction
        })
        .textSelection(.enabled)
    }
}

private struct MarkdownBlock: View {
    let block: any BlockMarkup
    let font: Font

    var body: some View {
        switch block {
        case let heading as Heading:
            SwiftUI.Text(Inline.attributed(heading.inlineChildren))
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
            SwiftUI.Text(html.rawHTML).font(.callout.monospaced()).foregroundStyle(.secondary)
        default:
            SwiftUI.Text(block.format()).font(font)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.bold()
        case 2: .title3.bold()
        case 3: .headline
        default: .subheadline.bold()
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
    let paragraph: Paragraph
    let font: Font

    var body: some View {
        let links = media.map { media in Self.links(in: paragraph).filter { media.accepts($0.url) } } ?? []
        VStack(alignment: .leading, spacing: 8) {
            if links.isEmpty || !Self.onlyLinks(paragraph, links: links) {
                SwiftUI.Text(Inline.attributed(paragraph.inlineChildren))
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
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Group {
                        if let checkbox = item.checkbox {
                            Image(systemName: checkbox == .checked ? "checkmark.square.fill" : "square")
                                .foregroundStyle(checkbox == .checked ? Color.accentColor : .secondary)
                        } else if ordered {
                            SwiftUI.Text("\(start + index).").monospacedDigit()
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

private struct TableView: View {
    let table: Markdown.Table
    let font: Font

    var body: some View {
        let header = Array(table.head.cells)
        let rows = table.body.rows.map { Array($0.cells) }
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        cellView(cell).font(font.weight(.semibold))
                    }
                }
                .background(.quaternary.opacity(0.5))
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    Divider().gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in cellView(cell).font(font) }
                    }
                    .background(index.isMultiple(of: 2) ? Color.clear : Color.primary.opacity(0.025))
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.quaternary))
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        // A horizontal scroll view would otherwise ask for its content's width and push the page wider.
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func cellView(_ cell: Markdown.Table.Cell) -> some View {
        SwiftUI.Text(Inline.attributed(cell.inlineChildren))
            .frame(minWidth: 60, maxWidth: 280, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
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
    static func attributed(_ children: some Sequence<any InlineMarkup>) -> AttributedString {
        var result = AttributedString()
        for child in children { result += attributed(child) }
        return result
    }

    static func attributed(_ markup: any InlineMarkup) -> AttributedString {
        switch markup {
        case let text as Markdown.Text:
            return AttributedString(text.string)
        case let strong as Strong:
            var inner = attributed(strong.inlineChildren)
            inner.inlinePresentationIntent = (inner.inlinePresentationIntent ?? []).union(.stronglyEmphasized)
            return inner
        case let emphasis as Emphasis:
            var inner = attributed(emphasis.inlineChildren)
            inner.inlinePresentationIntent = (inner.inlinePresentationIntent ?? []).union(.emphasized)
            return inner
        case let strike as Strikethrough:
            var inner = attributed(strike.inlineChildren)
            inner.strikethroughStyle = .single
            return inner
        case let code as InlineCode:
            var inner = AttributedString(code.code)
            inner.inlinePresentationIntent = .code
            inner.backgroundColor = Color.primary.opacity(0.08)
            return inner
        case let link as Markdown.Link:
            var inner = attributed(link.inlineChildren)
            if let destination = link.destination, let url = URL(string: destination) {
                inner.link = url
                inner.underlineStyle = .single
            }
            return inner
        case let image as Markdown.Image:
            var inner = AttributedString("🖼 " + (image.plainText.isEmpty ? "image" : image.plainText))
            if let source = image.source, let url = URL(string: source) { inner.link = url }
            return inner
        case is SoftBreak:
            return AttributedString(" ")
        case is LineBreak:
            return AttributedString("\n")
        case let html as InlineHTML:
            return AttributedString(html.rawHTML)
        default:
            return AttributedString(markup.plainText)
        }
    }
}

extension Markup {
    var plainText: String {
        if let text = self as? Markdown.Text { return text.string }
        return children.map(\.plainText).joined()
    }
}
