import DexCore
import SwiftUI

extension OpenUICard {
    /// View-only state kept with the card (survives leaving the chat and coming back).
    func localBinding(_ key: String, default fallback: JSONValue) -> Binding<JSONValue> {
        Binding(get: { self.local[key] ?? fallback }, set: { self.local[key] = $0 })
    }
}

// MARK: Tabs, accordions, sections, carousels, steps

/// Tabs: a segmented control (or scrolling glass pills when there are many), then the open tab's content. While the
/// program streams, the tab that's growing is shown; once you pick one, it stays (also when you come back).
struct OUITabs: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items").filter { $0.string("value") != nil }
        let chosen = card.local[node.local("tab")]?.string
        let fallback = streaming ? items.last?.string("value") : items.first?.string("value")
        let active = items.contains { $0.string("value") == chosen } ? chosen : fallback
        let selection = Binding<String>(get: { active ?? "" }, set: { card.local[node.local("tab")] = .string($0) })
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                if items.count <= 4, items.allSatisfy({ ($0.string("trigger") ?? "").count <= 18 }) {
                    Picker("Tabs", selection: selection) {
                        ForEach(items) { item in Text(item.string("trigger") ?? "").tag(item.string("value") ?? "") }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("openui.tabs")
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(items) { item in
                                let value = item.string("value") ?? ""
                                Button(item.string("trigger") ?? "") { selection.wrappedValue = value }
                                    .buttonStyle(.glass)
                                    .tint(value == active ? .dexAccent : nil)
                                    .fontWeight(value == active ? .semibold : .regular)
                                    .accessibilityAddTraits(value == active ? .isSelected : [])
                            }
                        }
                    }
                    .scrollClipDisabled()
                }
                if let open = items.first(where: { $0.string("value") == active }) {
                    OUIChildren(nodes: open.nodes("content"))
                        .id(open.key)
                        .transition(.opacity)
                }
            }
            .animation(.smooth(duration: 0.2), value: active)
            .sensoryFeedback(.selection, trigger: active)
        }
    }
}

/// Collapsible sections, one open at a time; the newest opens as the program streams in.
struct OUIAccordion: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card

    var body: some View {
        let items = node.nodes("items")
        let open = card.local[node.local("open")]?.string ?? items.last?.string("value") ?? ""
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let value = item.string("value") ?? item.key
                DisclosureGroup(isExpanded: Binding(get: { open == value }, set: { card.local[node.local("open")] = .string($0 ? value : "") })) {
                    OUIChildren(nodes: item.nodes("content")).padding(.vertical, 8)
                } label: {
                    Text(item.string("trigger") ?? "").font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                }
                .tint(.primary)
                .padding(.vertical, 10)
                if index < items.count - 1 { Divider() }
            }
        }
    }
}

/// Sections: foldable (the first open, or each new one while streaming), or flat headings.
struct OUISectionBlock: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("sections")
        if node.bool("isFoldable") == false {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(item.string("trigger") ?? "").font(.headline).accessibilityAddTraits(.isHeader)
                        OUIChildren(nodes: item.nodes("content"))
                    }
                }
            }
        } else {
            let fallback: [String] = streaming ? items.compactMap { $0.string("value") } : items.first?.string("value").map { [$0] } ?? []
            let open = card.local[node.local("open")]?.array?.compactMap(\.string) ?? fallback
            VStack(spacing: 8) {
                ForEach(items) { item in
                    let value = item.string("value") ?? item.key
                    DisclosureGroup(isExpanded: Binding(get: { open.contains(value) }, set: { expanded in
                        let next = expanded ? open + [value] : open.filter { $0 != value }
                        card.local[node.local("open")] = .array(next.map(JSONValue.string))
                    })) {
                        OUIChildren(nodes: item.nodes("content")).padding(.top, 10)
                    } label: {
                        Text(item.string("trigger") ?? "").font(.headline).foregroundStyle(.primary)
                    }
                    .tint(.primary)
                    .ouiPanel()
                }
            }
        }
    }
}

/// Slides that scroll sideways, one (or more, when wide) at a time.
struct OUICarousel: View {
    let node: OpenUINode

    var body: some View {
        let slides = node.props["children"]?.array ?? []
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(Array(slides.enumerated()), id: \.offset) { _, slide in
                    OUIChildren(nodes: slide.nodes, spacing: 10)
                        .padding(12)
                        .background(node.string("variant") == "sunk" ? AnyShapeStyle(.quaternary.opacity(0.5)) : AnyShapeStyle(OUIStyle.panel),
                                    in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
                        .containerRelativeFrame(.horizontal, count: 6, span: 5, spacing: 12)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
    }
}

struct OUISteps: View {
    let node: OpenUINode
    @Environment(\.openURL) private var openURL

    var body: some View {
        let items = node.nodes("items")
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.footnote.weight(.bold).monospacedDigit())
                        .frame(width: 26, height: 26)
                        .background(.tint.opacity(0.15), in: .circle)
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.string("title") ?? "").font(.subheadline.weight(.semibold))
                        if let details = item.string("details") {
                            MarkdownView(text: details, font: .subheadline) { openURL($0) }.foregroundStyle(.secondary)
                        } else if let details = item.node("details") {
                            OpenUINodeView(node: details)
                        }
                    }
                }
            }
        }
    }
}

// MARK: Buttons

/// A button: primary is prominent glass, secondary glass, tertiary plain; destructive ones are red. Disabled while
/// the program streams.
struct OUIButton: View {
    let node: OpenUINode
    var fullWidth = false
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming
    @State private var presses = 0

    var body: some View {
        let label = node.string("label") ?? ""
        let destructive = node.string("type") == "destructive"
        let variant = node.string("variant") ?? "primary"
        Button(role: destructive ? .destructive : nil) {
            presses += 1
            OUIPress(card: card, streaming: streaming)(node.action)
        } label: {
            Text(label)
                .lineLimit(2)
                .frame(maxWidth: fullWidth ? .infinity : nil)
        }
        .ouiButtonStyle(variant)
        .tint(destructive ? .red : nil)
        .controlSize(Self.controlSize(node.string("size")))
        .disabled(streaming)
        .sensoryFeedback(.impact(weight: .light), trigger: presses)
        .accessibilityIdentifier("openui.button.\(label)")
    }

    static func controlSize(_ size: String?) -> ControlSize {
        switch size {
        case "extra-small": .mini
        case "small": .small
        case "large": .large
        default: .regular
        }
    }
}

extension View {
    @ViewBuilder
    func ouiButtonStyle(_ variant: String) -> some View {
        switch variant {
        case "secondary": buttonStyle(.glass)
        case "tertiary", "ghost": buttonStyle(.borderless)
        default: prominentButton()
        }
    }
}

struct OUIButtons: View {
    let node: OpenUINode

    var body: some View {
        let buttons = node.nodes("buttons")
        if node.string("direction") == "column" {
            VStack(spacing: 8) {
                ForEach(buttons) { button in
                    if button.type == "Button" { OUIButton(node: button, fullWidth: true) } else { OpenUINodeView(node: button) }
                }
            }
        } else {
            OUIFlow(spacing: 8) {
                ForEach(buttons) { OpenUINodeView(node: $0) }
            }
        }
    }
}

struct OUIIconButton: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let name = node.string("name") ?? ""
        Button {
            OUIPress(card: card, streaming: streaming)(node.action)
        } label: {
            Group {
                if let icon = node.node("icon") { OUIIcon(node: icon) } else { Image(systemName: "circle") }
            }
            .frame(width: 22, height: 22)
        }
        .ouiButtonStyle(node.string("variant") ?? "secondary")
        .buttonBorderShape(node.string("shape") == "circle" ? .circle : .roundedRectangle)
        .controlSize(OUIButton.controlSize(node.string("size")))
        .disabled(streaming)
        .accessibilityLabel(name)
        .accessibilityIdentifier("openui.button.\(name)")
    }
}

// MARK: Lists

/// A numbered (or image) list; items with an action are tappable rows.
struct OUIListBlock: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items")
        let small = node.string("size") == "small"
        let images = node.string("variant") == "image"
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let row = HStack(spacing: 12) {
                    if images, let image = item.props["image"] {
                        OUIImage(src: image["src"]?.text, alt: image["alt"]?.text, fill: true)
                            .frame(width: small ? 32 : 44, height: small ? 32 : 44)
                            .clipShape(.rect(cornerRadius: 8, style: .continuous))
                    } else {
                        Text("\(index + 1)")
                            .font((small ? Font.caption : .footnote).weight(.semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: small ? 20 : 26, height: small ? 20 : 26)
                            .background(.quaternary.opacity(0.6), in: .circle)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.string("title") ?? "").font(small ? .footnote : .subheadline.weight(.medium)).foregroundStyle(.primary)
                        if let subtitle = item.string("subtitle") { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer(minLength: 8)
                    if item.action != nil {
                        if let label = item.string("actionLabel") { Text(label).font(.caption.weight(.medium)).foregroundStyle(.tint) }
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, small ? 6 : 10)
                .contentShape(.rect)
                if item.action != nil {
                    Button { OUIPress(card: card, streaming: streaming)(item.action) } label: { row }
                        .buttonStyle(.plain)
                        .disabled(streaming)
                        .accessibilityIdentifier("openui.listItem.\(item.string("title") ?? "")")
                } else {
                    row
                }
                if index < items.count - 1 { Divider().padding(.leading, images ? (small ? 44 : 56) : (small ? 32 : 38)) }
            }
        }
    }
}

/// Suggestions at the end of a reply: tapping one sends it.
struct OUIFollowUpBlock: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items")
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let text = item.string("text") ?? ""
                Button {
                    OUIPress(card: card, streaming: streaming)(item.action)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.turn.down.right").font(.footnote).foregroundStyle(.tint)
                        Text(text).font(.subheadline).foregroundStyle(.primary).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 9)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(streaming)
                .accessibilityIdentifier("openui.followUp.\(text)")
                if index < items.count - 1 { Divider().padding(.leading, 26) }
            }
        }
    }
}

// MARK: Tables

/// A column-oriented table, 10 rows a page. Wide tables scroll sideways inside the card.
struct OUITable: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @State private var width: CGFloat = 0

    private static let pageSize = 10

    var body: some View {
        let columns = node.nodes("columns")
        let data = columns.map { column -> [OpenUIValue] in
            if case .array(let items) = column.props["data"] ?? .null { return items }
            return column.props["data"].map { $0.isNull ? [] : [$0] } ?? []
        }
        let rows = data.map(\.count).max() ?? 0
        if node.loading {
            VStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { _ in LineBone(font: .subheadline) }
            }
            .redacted(reason: .placeholder)
        } else if !columns.isEmpty {
            let pages = max(1, Int(ceil(Double(rows) / Double(Self.pageSize))))
            let page = min(card.local[node.local("page")]?.int ?? 0, pages - 1)
            let range = (page * Self.pageSize)..<min(rows, (page + 1) * Self.pageSize)
            VStack(alignment: .trailing, spacing: 8) {
                // Columns as wide as their text (long text wraps at 240 points), spread over the card when there's
                // room; wider tables scroll sideways inside the card.
                ScrollView(.horizontal, showsIndicators: false) {
                    grid(columns, data: data, rows: range, widths: Self.columnWidths(columns, data: data, rows: range, fitting: width))
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
                .accessibilityIdentifier("openui.table")
                if pages > 1 {
                    HStack(spacing: 10) {
                        Button { card.local[node.local("page")] = .number(Double(page - 1)) } label: { Image(systemName: "chevron.left") }
                            .disabled(page == 0)
                            .accessibilityLabel("Previous page")
                        Text("\(page + 1) / \(pages)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        Button { card.local[node.local("page")] = .number(Double(page + 1)) } label: { Image(systemName: "chevron.right") }
                            .disabled(page >= pages - 1)
                            .accessibilityLabel("Next page")
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.small)
                }
            }
        }
    }

    private static let spacing: CGFloat = 16

    private func grid(_ columns: [OpenUINode], data: [[OpenUIValue]], rows: Range<Int>, widths: [CGFloat]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Self.spacing) {
                ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                    Text(column.string("label") ?? "")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .lineLimit(2)
                        .frame(width: widths[index], alignment: column.string("type") == "number" ? .trailing : .leading)
                }
            }
            .padding(.vertical, 8)
            ForEach(Array(rows), id: \.self) { row in
                Divider()
                HStack(alignment: .firstTextBaseline, spacing: Self.spacing) {
                    ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                        cell(row < data[index].count ? data[index][row] : .null)
                            .frame(width: widths[index], alignment: column.string("type") == "number" ? .trailing : .leading)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 8)
            }
        }
    }

    @ViewBuilder
    private func cell(_ value: OpenUIValue) -> some View {
        if case .node(let child) = value {
            OpenUINodeView(node: child).fixedSize()
        } else {
            Text(Self.text(value)).font(.subheadline).monospacedDigit().lineLimit(4)
        }
    }

    private static func text(_ value: OpenUIValue) -> String {
        value.text ?? (value.isNull ? "" : value.json.jsonText)
    }

    /// Each column's width: its widest text (wrapping at 240 points), spread over `available` when there's room.
    static func columnWidths(_ columns: [OpenUINode], data: [[OpenUIValue]], rows: Range<Int>, fitting available: CGFloat) -> [CGFloat] {
        let body = UIFont.preferredFont(forTextStyle: .subheadline)
        let header = UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .caption1).pointSize, weight: .semibold)
        func measure(_ text: String, _ font: UIFont) -> CGFloat { ceil((text as NSString).size(withAttributes: [.font: font]).width) + 6 }
        var widths = columns.enumerated().map { index, column in
            let cells = rows.map { row -> CGFloat in
                guard row < data[index].count else { return 0 }
                if case .node = data[index][row] { return 90 }
                return min(240, measure(text(data[index][row]), body))
            }
            return max(min(160, measure((column.string("label") ?? "").uppercased(), header)), cells.max() ?? 0, 24)
        }
        let total = widths.reduce(0, +) + spacing * CGFloat(max(columns.count - 1, 0))
        if available > total, !widths.isEmpty {
            let extra = (available - total) / CGFloat(widths.count)
            widths = widths.map { $0 + extra }
        }
        return widths
    }
}

// MARK: Card blocks

/// Snippet, overview, context, composite, and visual cards: a two-column grid or a sideways carousel. With an action,
/// every card is tappable (the pressed card's details go with it).
struct OUICardBlock: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items")
        let carousel = node.string("layout") == "carousel"
        let gap = CGFloat(node.number("gap") ?? 10)
        if carousel {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: gap) {
                    ForEach(items) { item in
                        tile(item).containerRelativeFrame(.horizontal, count: 5, span: node.type == "VisualCardBlock" ? 4 : 3, spacing: gap)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
        } else {
            let minimum: CGFloat = ["CompositeCardBlock", "VisualCardBlock"].contains(node.type) ? 240 : 150
            LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: gap, alignment: .top)], spacing: gap) {
                ForEach(items) { tile($0) }
            }
        }
    }

    @ViewBuilder
    private func tile(_ item: OpenUINode) -> some View {
        let content = OUICardItem(item: item)
        if let action = item.action {
            content
                .contentShape(.rect(cornerRadius: OUIStyle.corner))
                .onTapGesture { OUIPress(card: card, streaming: streaming)(action) }
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { OUIPress(card: card, streaming: streaming)(action) }
                .hoverEffect(.highlight)
        } else {
            content
        }
    }
}

/// One card in a card block.
struct OUICardItem: View {
    let item: OpenUINode
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch item.type {
        case "SnippetCardItem":
            // Label and value side by side when they fit, else the value under the label.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 8) {
                    if let lhs = item.node("lhs") { OpenUINodeView(node: lhs).fixedSize() }
                    Spacer(minLength: 4)
                    if let rhs = item.node("rhs") { OpenUINodeView(node: rhs).fixedSize() }
                }
                VStack(alignment: .leading, spacing: 8) {
                    if let lhs = item.node("lhs") { OpenUINodeView(node: lhs) }
                    if let rhs = item.node("rhs") { OpenUINodeView(node: rhs) }
                }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .ouiPanel()
        case "OverviewCardItem":
            VStack(alignment: .leading, spacing: 10) {
                if let top = item.node("top") { OpenUINodeView(node: top) }
                Spacer(minLength: 0)
                if let bottom = item.node("bottom") { OpenUINodeView(node: bottom) }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .ouiPanel()
        case "ContextCardItem":
            context
        case "CompositeCardItem":
            VStack(alignment: .leading, spacing: 10) {
                if let header = item.node("header") { OpenUINodeView(node: header) }
                ForEach(item.nodes("body")) { OpenUINodeView(node: $0) }
                if let footer = item.props["footer"], footer.object != nil {
                    HStack {
                        if let price = footer["price"]?.node { OpenUINodeView(node: price) }
                        Spacer(minLength: 8)
                        if let button = footer["button"]?.node { OpenUINodeView(node: button).controlSize(.small) }
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .ouiPanel()
        case "VisualCardItem":
            visual
        default:
            OpenUINodeView(node: item)
        }
    }

    @ViewBuilder
    private var title: some View {
        if let tag = item.node("title") {
            OUITagLabel(text: tag.string("text") ?? "", icon: tag.node("icon"), size: "sm", variant: tag.string("variant"))
        } else if let title = item.string("title") {
            Text(title).font(.subheadline.weight(.semibold))
        }
    }

    private var context: some View {
        let image = OpenUICard.safeHttpUrl(item.props["bgImageSrc"]?.json)
        return VStack(alignment: .leading, spacing: 6) {
            title
            if let body = item.string("body") {
                MarkdownView(text: body, font: .subheadline) { openURL($0) }.fontWeight(.medium)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .foregroundStyle(image != nil ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .background {
            if image != nil {
                OUIImage(src: item.string("bgImageSrc"), alt: item.string("bgImageAlt"), fill: true)
                    .overlay(LinearGradient(colors: [.black.opacity(0.65), .black.opacity(0.2)], startPoint: .bottom, endPoint: .top))
            } else if item.string("bgColor") == "gray" {
                Color(.quaternarySystemFill)
            } else {
                OUIStyle.panel
            }
        }
        .clipShape(.rect(cornerRadius: OUIStyle.corner, style: .continuous))
        .environment(\.colorScheme, image != nil ? .dark : colorScheme)
    }

    @Environment(\.colorScheme) private var colorScheme

    private var visual: some View {
        ZStack(alignment: .bottomLeading) {
            OUIImage(src: item.string("bgImageSrc"), alt: item.string("bgImageAlt"), fill: true)
                .frame(height: 200)
                .frame(maxWidth: .infinity)
                .clipped()
            if let body = item.node("body") {
                OpenUINodeView(node: body)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.ultraThinMaterial)
            }
        }
        .overlay(alignment: .topLeading) {
            if let tag = item.node("tag") {
                OUITagLabel(text: tag.string("text") ?? "", icon: tag.node("icon"), size: "sm", variant: tag.string("variant"))
                    .background(.regularMaterial, in: .capsule)
                    .padding(8)
            }
        }
        .clipShape(.rect(cornerRadius: OUIStyle.corner, style: .continuous))
    }
}
