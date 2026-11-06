import DexCore
import Foundation
import Markdown
import SwiftUI
import Testing
import UIKit
@testable import Dex

/// The Markdown renderer against the fixture (`MockMarkdown.fixture`: everything the web renders), and the fixture drawn
/// light and dark into `apps/ios/artifacts/markdown/` (or `$DEX_SCREENSHOTS/../markdown`) to compare with the web.
@MainActor
@Suite struct MarkdownTests {
    let document = MarkdownDocument(parsing: MockMarkdown.fixture)

    /// Every block, nested ones too, depth first.
    private func all(_ blocks: [any BlockMarkup]) -> [Markup] {
        blocks.flatMap { block -> [Markup] in [block] + all(Array(block.children.compactMap { $0 as? BlockMarkup })) }
    }

    private func paragraph(_ prefix: String, in document: MarkdownDocument? = nil) throws -> Paragraph {
        let found = all((document ?? self.document).blocks).compactMap { $0 as? Paragraph }.first { $0.plainText.hasPrefix(prefix) }
        return try #require(found, "no paragraph starting “\(prefix)”")
    }

    private func text(_ paragraph: Paragraph, notes: [String: Int] = [:]) -> AttributedString {
        Inline.attributed(paragraph.inlineChildren, notes: notes)
    }

    private func links(_ text: AttributedString) -> [String] {
        text.runs.compactMap { $0.link?.absoluteString }.reduce(into: []) { found, url in if found.last != url { found.append(url) } }
    }

    private func intent(_ text: AttributedString, of word: String) -> InlinePresentationIntent? {
        guard let range = text.range(of: word) else { return nil }
        return text[range].runs.first?.inlinePresentationIntent
    }

    @Test func blocks() throws {
        let blocks = all(document.blocks)
        #expect(blocks.compactMap { ($0 as? Heading)?.level } == [1, 2, 3, 4, 5, 6])
        let code = blocks.compactMap { $0 as? CodeBlock }
        #expect(code.map(\.language) == ["sh", "swift", nil])
        #expect(code[2].code == "indented code block\nsecond line\n")
        let tables = blocks.compactMap { $0 as? Markdown.Table }
        #expect(tables.count == 2)
        #expect(tables[0].columnAlignments == [.left, .center, .right])
        #expect(tables[1].maxColumnCount == 12)
        let quote = try #require(blocks.compactMap { $0 as? BlockQuote }.first)
        #expect(quote.blockChildren.contains { $0 is BlockQuote })
        #expect(blocks.contains { $0 is ThematicBreak })
        #expect(blocks.compactMap { ($0 as? HTMLBlock)?.rawHTML } == ["<div>A block of HTML</div>\n"])
        #expect(blocks.compactMap { ($0 as? OrderedList)?.startIndex } == [1, 9])
        let checkboxes = blocks.compactMap { ($0 as? ListItem)?.checkbox }
        #expect(checkboxes == [.unchecked, .checked])
        // A list item with two paragraphs, and one with a code block.
        let items = blocks.compactMap { $0 as? ListItem }
        #expect(items.contains { $0.blockChildren.filter { $0 is Paragraph }.count == 2 })
        #expect(items.contains { $0.blockChildren.contains { $0 is CodeBlock } })
        // A bullet list inside a numbered one.
        #expect(blocks.contains { ($0 as? OrderedList)?.listItems.contains { $0.blockChildren.contains { $0 is UnorderedList } } == true })
        // None of DocC's extensions.
        let outline = document.blocks.map { $0.debugDescription() }.joined()
        #expect(!outline.contains("BlockDirective") && !outline.contains("SymbolLink"))
    }

    @Test func inlineStyles() throws {
        let text = text(try paragraph("A paragraph with"))
        #expect(intent(text, of: "bold")?.contains(.stronglyEmphasized) == true)
        #expect(intent(text, of: "italic")?.contains(.emphasized) == true)
        let both = try #require(intent(text, of: "bold and italic"))
        #expect(both.contains(.stronglyEmphasized) && both.contains(.emphasized))
        let struck = try #require(text.range(of: "struck"))
        #expect(text[struck].runs.first?.strikethroughStyle == .single)
        #expect(intent(text, of: "inline code") == .code)
        // Code inside bold keeps both.
        let nested = try #require(text.range(of: "code", options: .backwards))
        let nestedIntent = try #require(text[nested].runs.first?.inlinePresentationIntent)
        #expect(nestedIntent.contains(.code) && nestedIntent.contains(.stronglyEmphasized))
        // A soft break is a space; two trailing spaces, a new line.
        #expect(String(text.characters).hasSuffix("inside. Soft line breaks join lines,\nand a backslash (or two trailing spaces) makes a hard break."))
    }

    @Test func textStaysAsWritten() throws {
        let text = String(text(try paragraph("Words like")).characters)
        #expect(text.contains("snake_case_names and my_file_v2.py stay"))
        #expect(text.contains("Escapes: *not italic*, `not code`, # not a heading."))
        #expect(text.contains("Entities: & © <b> #."))
        // No smart punctuation (remark has none): flags and quotes as typed.
        #expect(text.contains("--force and \"straight quotes\""))
        #expect(String(self.text(try paragraph("Raw HTML")).characters) == "Raw HTML shows as text: <b>not bold</b>.")
    }

    @Test func linksAndAutolinks() throws {
        #expect(links(text(try paragraph("Links:"))) == [
            "https://example.com", "https://example.com/docs", "https://example.com/angle",
            "https://example.com/path_with_underscores?q=1", "http://www.example.com", "mailto:someone@example.com"
        ])
        let long = text(try paragraph("A very long line"))
        #expect(links(long) == ["https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all/so/it/must/break/somewhere"])
        #expect(intent(long, of: "bold")?.contains(.stronglyEmphasized) == true)
    }

    @Test func autolinkEdges() throws {
        func found(_ markdown: String) throws -> [String] {
            links(text(try paragraph("", in: MarkdownDocument(parsing: markdown))))
        }
        #expect(try found("(see https://example.com/a) and https://en.wikipedia.org/wiki/A_(b).") == ["https://example.com/a", "https://en.wikipedia.org/wiki/A_(b)"])
        #expect(try found("In code: `https://example.com` and *https://example.com/i*") == ["https://example.com/i"])
        #expect(try found("not.www.example.com, x@y, and nothttps://example.com") == [])
        #expect(try found("[named](https://example.com/n) https://example.com/n2") == ["https://example.com/n", "https://example.com/n2"])
    }

    @Test func images() throws {
        let text = text(try paragraph("An image"))
        #expect(String(text.characters).contains("🖼 a chart (example.com)"))
        #expect(links(text).first == "https://example.com/chart.png")
    }

    @Test func footnotes() throws {
        #expect(document.numbers == ["note": 1, "2": 2])
        #expect(document.footnotes.map { String($0.text.characters) } == ["The footnote's text, with bold.", "https://example.com/source"])
        #expect(intent(document.footnotes[0].text, of: "bold")?.contains(.stronglyEmphasized) == true)
        #expect(links(document.footnotes[1].text) == ["https://example.com/source"])
        // The definitions aren't drawn where they were written; the references are numbers.
        #expect(!all(document.blocks).contains { ($0 as? Paragraph)?.plainText.hasPrefix("[^") == true })
        #expect(String(text(try paragraph("A footnote"), notes: document.numbers).characters) == "A footnote reference1 and another2.")
    }

    @Test func oneWordFootnote() throws {
        // CommonMark reads `[^a]: https://…` as a link definition, so `[^a]` comes out a link; it's still a footnote.
        let document = MarkdownDocument(parsing: "Hi[^a] and [^b](https://example.com/link).\n\n[^a]: https://example.com/a\n")
        #expect(document.footnotes.map { String($0.text.characters) } == ["https://example.com/a"])
        let text = text(try paragraph("Hi", in: document), notes: document.numbers)
        #expect(String(text.characters) == "Hi1 and ^b.")
        #expect(links(text) == ["https://example.com/link"])
        // Unreferenced definitions aren't shown, as remark leaves them out.
        #expect(MarkdownDocument(parsing: "Hi.\n\n[^x]: Never used.").footnotes.isEmpty)
    }

    @Test func streaming() throws {
        let document = MarkdownDocument(parsing: MockMarkdown.streaming)
        let blocks = all(document.blocks)
        #expect(try String(text(paragraph("Here's", in: document)).characters) == "Here's **the plan so far")
        let table = try #require(blocks.compactMap { $0 as? Markdown.Table }.first)
        #expect(table.body.childCount == 2)
        #expect(blocks.compactMap { ($0 as? CodeBlock)?.language } == ["ts"])
    }

    @Test func spaceUpdates() throws {
        let message = Spaces.update(thread: (id: "t1", title: "Fix the build"), outcome: .finished, body: "Done:\n\n- **one**\n- `two`")
        let updates = try #require(Spaces.parseUpdates(message))
        #expect(updates.map(\.threadId) == ["t1"])
        #expect(updates[0].body == "Done:\n\n- **one**\n- `two`")
        #expect(Spaces.parseUpdates("[Space update] something else")?.isEmpty == true)
    }

    // MARK: - Drawn

    static var folder: URL {
        if let shots = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"], !shots.isEmpty {
            return URL(fileURLWithPath: shots).deletingLastPathComponent().appending(path: "markdown")
        }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "artifacts/markdown")
    }

    /// Drawn in a window (scroll views draw only there), at an iPhone's width.
    private func draw(_ view: some View, scheme: ColorScheme, width: CGFloat = 402) throws -> UIImage {
        let host = UIHostingController(rootView: view.padding(16).frame(width: width).background(Color(.systemBackground)).environment(\.colorScheme, scheme))
        host.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        let size = host.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = host
        window.isHidden = false
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        defer { window.isHidden = true }
        return UIGraphicsImageRenderer(size: size).image { _ in _ = host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
    }

    @Test func drawFixture() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let name = scheme == .dark ? "dark" : "light"
            let image = try draw(MarkdownView(text: MockMarkdown.fixture), scheme: scheme)
            #expect(image.size.height > 1500)
            try #require(image.pngData()).write(to: Self.folder.appending(path: "fixture-\(name).png"))
            let streaming = try draw(MarkdownView(text: MockMarkdown.streaming, live: true), scheme: scheme)
            try #require(streaming.pngData()).write(to: Self.folder.appending(path: "streaming-\(name).png"))
            let small = try draw(MarkdownView(text: MockMarkdown.fixture, font: .footnote), scheme: scheme)
            try #require(small.pngData()).write(to: Self.folder.appending(path: "fixture-footnote-\(name).png"))
        }
    }
}
