import DexCore
import SwiftUI

// MARK: Card

/// The root: everything stacks top to bottom on a soft grouped surface, with its sources (if any) at the bottom.
struct OUICard: View {
    let node: OpenUINode

    var body: some View {
        let sources = node.props["sources"]?.array ?? []
        VStack(alignment: .leading, spacing: 16) {
            OUIChildren(nodes: node.nodes("children"), spacing: 16)
            if !sources.isEmpty { OUISources(sources: sources) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// The Sources strip: numbered links the text's [n] citations point to.
struct OUISources: View {
    let sources: [OpenUIValue]
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sources").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(sources.enumerated()), id: \.offset) { index, source in
                        let url = OpenUICard.safeHttpUrl(source["url"]?.json)
                        Button {
                            if let url { openURL(url) }
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("\(index + 1)").font(.caption2.monospacedDigit().weight(.bold)).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(source["title"]?.text ?? url?.host() ?? "Source").font(.caption.weight(.medium)).lineLimit(1)
                                    Text(source["sourceName"]?.text ?? url?.host() ?? "").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .frame(maxWidth: 200, alignment: .leading)
                        }
                        .buttonStyle(.glass)
                        .disabled(url == nil)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }
}

// MARK: Text

struct OUICardHeader: View {
    let node: OpenUINode

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let title = node.string("title") { Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader) }
            if let subtitle = node.string("subtitle") { Text(subtitle).font(.subheadline).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct OUIInlineHeader: View {
    let node: OpenUINode

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(node.string("heading") ?? "").font(.headline).accessibilityAddTraits(.isHeader)
            if let description = node.string("description") { Text(description).font(.footnote).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Markdown text in one of five sizes.
struct OUITextContent: View {
    let node: OpenUINode
    @Environment(\.openURL) private var openURL

    var body: some View {
        let size = node.string("size") ?? "default"
        let font: Font = switch size {
        case "small", "small-heavy": .subheadline
        case "large", "large-heavy": .title3
        default: .body
        }
        MarkdownView(text: node.string("text") ?? "", font: font) { openURL($0) }
            .fontWeight(size.hasSuffix("heavy") ? .semibold : nil)
    }
}

/// Markdown, clear, on a panel ("card"), or sunk.
struct OUIMarkdown: View {
    let node: OpenUINode
    @Environment(\.openURL) private var openURL

    var body: some View {
        let text = MarkdownView(text: node.string("textMarkdown") ?? "") { openURL($0) }
        switch node.string("variant") {
        case "card": text.ouiPanel()
        case "sunk": text.padding(12).background(.quaternary.opacity(0.5), in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
        default: text
        }
    }
}

/// A banner. With a `visible` $binding it hides itself after 3 seconds (setting the variable to false).
struct OUICallout: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openURL) private var openURL

    var body: some View {
        let bound = node.field != nil
        let shown = !bound || node.value == .bool(true) || node.value == .string("true")
        if shown {
            let variant = node.string("variant") == "error" ? "warning" : node.string("variant")
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: symbol(variant)).foregroundStyle(OUIStyle.tint(variant))
                VStack(alignment: .leading, spacing: 3) {
                    if let title = node.string("title") { Text(title).font(.subheadline.weight(.semibold)) }
                    MarkdownView(text: node.string("description") ?? "", font: .subheadline) { openURL($0) }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OUIStyle.tint(variant).opacity(0.12), in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
            .task(id: bound) {
                guard bound else { return }
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                withAnimation(.smooth) { card.document.setField(node.key, .bool(false)) }
            }
            .transition(.opacity)
        }
    }

    private func symbol(_ variant: String?) -> String {
        switch variant {
        case "success": "checkmark.circle.fill"
        case "warning", "error", "danger": "exclamationmark.triangle.fill"
        case "neutral": "info.circle"
        default: "info.circle.fill"
        }
    }
}

struct OUITextCallout: View {
    let node: OpenUINode

    var body: some View {
        let tint = OUIStyle.tint(node.string("variant"))
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(tint).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                if let title = node.string("title") { Text(title).font(.subheadline.weight(.semibold)) }
                if let description = node.string("description") { Text(description).font(.subheadline).foregroundStyle(.secondary) }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.08), in: .rect(cornerRadius: 10, style: .continuous))
    }
}

struct OUISeparator: View {
    let node: OpenUINode

    var body: some View {
        if node.string("orientation") == "vertical" { Divider().frame(height: 24) } else { Divider() }
    }
}

/// A line of text with optional subtext: Text, or BoldText. `number` uses tabular digits; a `metric` subtext is
/// green or red by its sign.
struct OUIText: View {
    let node: OpenUINode

    var body: some View {
        let bold = node.type == "BoldText"
        let number = node.string("variant") == "number"
        let size: Font = switch node.string("size") {
        case "xs": .footnote
        case "sm": .subheadline
        case "lg": .title3
        default: bold ? .headline : .body
        }
        VStack(alignment: .leading, spacing: 2) {
            Text(node.string("value") ?? "")
                .font(size)
                .fontWeight(bold ? .semibold : .regular)
                .monospacedDigit(number)
            if let subtext = node.string("subtext") {
                Text(subtext)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(subtextColor(subtext))
            }
        }
    }

    private func subtextColor(_ text: String) -> Color {
        guard node.string("subtextVariant") == "metric" else { return .secondary }
        if text.hasPrefix("+") { return .green }
        if text.hasPrefix("-") || text.hasPrefix("−") { return .red }
        return .secondary
    }
}

private extension View {
    @ViewBuilder
    func monospacedDigit(_ on: Bool) -> some View {
        if on { self.monospacedDigit() } else { self }
    }
}

// MARK: Tags, lists, icons

struct OUITag: View {
    let node: OpenUINode

    var body: some View {
        OUITagLabel(text: node.string("text") ?? "", icon: node.node("icon"), size: node.string("size"), variant: node.string("variant"))
    }
}

struct OUITagLabel: View {
    let text: String
    var icon: OpenUINode? = nil
    var size: String? = nil
    var variant: String? = nil

    var body: some View {
        let tint = variant.map { OUIStyle.tint($0) }
        HStack(spacing: 4) {
            if let icon { OUIIcon(node: icon).imageScale(.small) }
            Text(text).lineLimit(1)
        }
        .font(size == "lg" ? .subheadline : size == "sm" ? .caption2 : .caption)
        .fontWeight(.medium)
        .padding(.horizontal, size == "sm" ? 7 : 9)
        .padding(.vertical, size == "lg" ? 5 : 3)
        .foregroundStyle(tint ?? .primary)
        .background((tint ?? .secondary).opacity(0.14), in: .capsule)
    }
}

struct OUITagBlock: View {
    let node: OpenUINode

    var body: some View {
        let tags = (node.props["tags"]?.array ?? []).compactMap(\.text)
        OUIFlow(spacing: 6) {
            ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in OUITagLabel(text: tag, size: node.string("size")) }
        }
    }
}

/// Two-column rows (left label, right value), with an optional header and footer row.
struct OUIEntityList: View {
    let node: OpenUINode

    var body: some View {
        let small = node.string("size") == "small"
        let rows = node.props["rows"]?.array ?? []
        VStack(spacing: 0) {
            if !small, let header = node.props["header"], header.object != nil {
                row(header, font: .caption.weight(.semibold), color: .secondary)
                Divider()
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                self.row(row, font: small ? .footnote : .subheadline, color: .primary)
                if index < rows.count - 1 { Divider().opacity(0.5) }
            }
            if !small, let footer = node.props["footer"], footer.object != nil {
                Divider()
                row(footer, font: .subheadline.weight(.semibold), color: .primary)
            }
        }
    }

    private func row(_ value: OpenUIValue, font: Font, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(value["left"]?.text ?? "").foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value["right"]?.text ?? "")
                .foregroundStyle(color)
                .monospacedDigit(value["rightVariant"]?.string == "number")
                .multilineTextAlignment(.trailing)
        }
        .font(font)
        .padding(.vertical, 6)
    }
}

/// A lucide icon (by kebab-case name) as the closest SF Symbol, falling back on its category.
struct OUIIcon: View {
    let node: OpenUINode

    var body: some View {
        Image(systemName: LucideSymbols.symbol(for: node.string("name") ?? "", category: node.string("category")))
            .accessibilityLabel(node.string("name") ?? "")
    }
}

/// An icon badge with a title and subtitle.
struct OUIIconText: View {
    let node: OpenUINode

    var body: some View {
        let vertical = node.string("layout") == "vertical"
        let layout = vertical ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 10))
        layout {
            badge
            VStack(alignment: .leading, spacing: 1) {
                Text(node.string("title") ?? "").font(.subheadline.weight(node.bool("bold") == true ? .semibold : .medium))
                if let subtitle = node.string("subtitle") { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private var badge: some View {
        let variant = node.string("iconVariant")
        let tint: Color = ["filled", "inverted"].contains(variant ?? "") ? .accentColor : OUIStyle.tint(variant == "soft" ? "info" : variant)
        let side: CGFloat = switch node.string("iconSize") {
        case "xs": 22
        case "s", "sm": 28
        case "l", "lg": 40
        case "xl": 48
        default: 34
        }
        return Group {
            if let icon = node.node("icon") { OUIIcon(node: icon) } else { Image(systemName: "circle.dashed") }
        }
        .font(.system(size: side * 0.45, weight: .medium))
        .foregroundStyle(variant == "filled" || variant == "inverted" ? Color.white : tint)
        .frame(width: side, height: side)
        .background(variant == "filled" || variant == "inverted" ? AnyShapeStyle(tint) : AnyShapeStyle(tint.opacity(0.14)), in: .rect(cornerRadius: side * 0.3, style: .continuous))
    }
}

struct OUIImageText: View {
    let node: OpenUINode

    var body: some View {
        let side = CGFloat(node.number("imageSize") ?? 40)
        let vertical = node.string("layout") == "vertical"
        let layout = vertical ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
        layout {
            OUIImage(src: node.string("src"), alt: node.string("alt"), fill: true)
                .frame(width: side, height: side)
                .clipShape(.rect(cornerRadius: side * 0.25, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(node.string("title") ?? "").font(.subheadline.weight(node.bool("bold") == true ? .semibold : .medium))
                if let subtitle = node.string("subtitle") { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

struct OUIImageTextLarge: View {
    let node: OpenUINode

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            OUIImage(src: node.string("src"), alt: node.string("alt"), fill: true)
                .frame(height: 140)
                .frame(maxWidth: .infinity)
                .clipShape(.rect(cornerRadius: 12, style: .continuous))
            Text(node.string("title") ?? "").font(.headline)
            if let subtitle = node.string("subtitle") { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

/// A headline metric with an optional trend (and struck-through previous value).
struct OUIMetric: View {
    let node: OpenUINode

    var body: some View {
        let trend = node.props["trend"]
        let up = trend?["direction"]?.string == "up"
        let figures = OUIFlow(spacing: 6) {
            Text(node.string("value") ?? "").font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            if let previous = node.string("previousValue") {
                Text(previous).font(.subheadline).strikethrough().foregroundStyle(.secondary).lineLimit(1)
            }
            if let trend, let value = trend["value"]?.number {
                Label("\(up ? "+" : "−")\(OpenUIValue.number(abs(value)).text ?? "")%", systemImage: up ? "arrow.up.right" : "arrow.down.right")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(up ? .green : .red)
                    .lineLimit(1)
                    .padding(.top, 5)
            }
        }
        let subtext = node.string("subtext").map { Text($0).font(.caption).foregroundStyle(.secondary) }
        // Inline: the subtext follows on the same line when there's room.
        if node.type == "MetricIndicatorInline", let subtext {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 6) { figures.fixedSize(); subtext.lineLimit(1) }
                VStack(alignment: .leading, spacing: 2) { figures; subtext }
            }
        } else {
            VStack(alignment: .leading, spacing: 2) {
                figures
                subtext
            }
        }
    }
}

// MARK: Images

/// A web image (http or https only), with a placeholder while it loads or if it can't.
struct OUIImage: View {
    let src: String?
    let alt: String?
    var fill = false

    var body: some View {
        let url = OpenUICard.safeHttpUrl(src.map(JSONValue.string))
        AsyncImage(url: url, transaction: Transaction(animation: .smooth)) { phase in
            switch phase {
            case .success(let image):
                if fill { image.resizable().scaledToFill() } else { image.resizable().scaledToFit().clipShape(.rect(cornerRadius: 12, style: .continuous)) }
            case .failure:
                placeholder(symbol: "photo.badge.exclamationmark")
            default:
                if url == nil { placeholder(symbol: "photo") } else { placeholder(symbol: nil) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(alt ?? "Image")
    }

    private func placeholder(symbol: String?) -> some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(.quaternary.opacity(0.6))
            .aspectRatio(fill ? nil : 16 / 9, contentMode: .fit)
            .overlay {
                Image(systemName: symbol ?? "photo").foregroundStyle(.tertiary)
            }
    }
}

/// A grid of images; tap one to see it full screen.
struct OUIImageGallery: View {
    let node: OpenUINode
    @State private var shown: Int?

    var body: some View {
        let images = node.props["images"]?.array ?? []
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
            ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                Button { shown = index } label: {
                    OUIImage(src: image["src"]?.text, alt: image["alt"]?.text, fill: true)
                        .frame(height: 110)
                        .clipShape(.rect(cornerRadius: 10, style: .continuous))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .sheet(item: Binding(get: { shown.map { GalleryIndex(id: $0) } }, set: { shown = $0?.id })) { index in
            NavigationStack {
                TabView(selection: Binding(get: { index.id }, set: { shown = $0 })) {
                    ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                        VStack(spacing: 12) {
                            OUIImage(src: image["src"]?.text, alt: image["alt"]?.text)
                            if let details = image["details"]?.text ?? image["alt"]?.text { Text(details).font(.subheadline).foregroundStyle(.secondary) }
                        }
                        .padding()
                        .tag(offset)
                    }
                }
                .tabViewStyle(.page)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { shown = nil } } }
            }
        }
    }

    private struct GalleryIndex: Identifiable { let id: Int }
}

// MARK: Layout helpers

/// Lays children out in rows, wrapping (tags, chips, buttons); each row's items are centered vertically.
struct OUIFlow: Layout {
    var spacing: CGFloat = 8

    private struct Row {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, view) in subviews.enumerated() {
            var size = view.sizeThatFits(.init(width: width, height: nil))
            size.width = min(size.width, width)
            if !rows[rows.count - 1].items.isEmpty, rows[rows.count - 1].width + spacing + size.width > width { rows.append(Row()) }
            var row = rows[rows.count - 1]
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append((index, size))
            rows[rows.count - 1] = row
        }
        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            var x = bounds.minX
            for item in row.items {
                subviews[item.index].place(at: CGPoint(x: x, y: y + (row.height - item.size.height) / 2), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += row.height + spacing
        }
    }
}
