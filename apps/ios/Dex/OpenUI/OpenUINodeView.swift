import DexCore
import SwiftUI

/// Renders one OpenUI component natively: OpenUI's chat library (react-ui's genui-lib) with Dex's look. Anything the
/// app doesn't know renders as a small placeholder, never a crash.
struct OpenUINodeView: View {
    let node: OpenUINode

    var body: some View {
        switch node.type {
        // Containers and layout
        case "Card": OUICard(node: node)
        case "Tabs": OUITabs(node: node)
        case "Accordion": OUIAccordion(node: node)
        case "SectionBlock": OUISectionBlock(node: node)
        case "Carousel": OUICarousel(node: node)
        case "Steps": OUISteps(node: node)
        // Content
        case "CardHeader": OUICardHeader(node: node)
        case "InlineHeader": OUIInlineHeader(node: node)
        case "TextContent": OUITextContent(node: node)
        case "MarkDownRenderer": OUIMarkdown(node: node)
        case "Callout": OUICallout(node: node)
        case "TextCallout": OUITextCallout(node: node)
        case "Image": OUIImage(src: node.string("src"), alt: node.string("alt"))
        case "ImageBlock": OUIImage(src: node.string("src"), alt: node.string("alt"))
        case "ImageGallery": OUIImageGallery(node: node)
        case "CodeBlock": CodeBlockView(code: node.string("codeString") ?? "", language: node.string("language"))
        case "Separator": OUISeparator(node: node)
        case "Label": Text(node.string("text") ?? "").font(.subheadline.weight(.medium))
        case "TagBlock": OUITagBlock(node: node)
        case "Tag": OUITag(node: node)
        case "EntityList": OUIEntityList(node: node)
        case "Icon": OUIIcon(node: node)
        case "Text", "BoldText": OUIText(node: node)
        case "IconText": OUIIconText(node: node)
        case "ImageText": OUIImageText(node: node)
        case "ImageTextLarge": OUIImageTextLarge(node: node)
        case "MetricIndicatorInline", "MetricIndicatorWithStrikethrough": OUIMetric(node: node)
        // Data
        case "Table": OUITable(node: node)
        case "EditableTable": OUIEditableTable(node: node)
        case "BarChart", "LineChart", "AreaChart", "HorizontalBarChart": OUICartesianChart(node: node)
        case "RadarChart": OUIRadarChart(node: node)
        case "PieChart": OUIPieChart(node: node)
        case "RadialChart": OUIRadialChart(node: node)
        case "SingleStackedBarChart": OUIStackedBarChart(node: node)
        case "ScatterChart": OUIScatterChart(node: node)
        // Forms
        case "Form": OUIForm(node: node)
        case "FormControl": OUIFormControl(node: node)
        case "Input": OUIInput(node: node)
        case "TextArea": OUITextArea(node: node)
        case "Select": OUISelect(node: node)
        case "DatePicker": OUIDatePicker(node: node)
        case "Slider": OUISlider(node: node)
        case "CheckBoxGroup", "SwitchGroup": OUIToggleGroup(node: node)
        case "RadioGroup": OUIRadioGroup(node: node)
        case "Chips": OUIChips(node: node)
        case "OptionCards": OUIOptionCards(node: node)
        // Buttons and lists
        case "Button": OUIButton(node: node)
        case "Buttons": OUIButtons(node: node)
        case "IconButton": OUIIconButton(node: node)
        case "ListBlock": OUIListBlock(node: node)
        case "FollowUpBlock": OUIFollowUpBlock(node: node)
        // Card blocks
        case "SnippetCardBlock", "OverviewCardBlock", "ContextCardBlock", "CompositeCardBlock", "VisualCardBlock": OUICardBlock(node: node)
        // Parts rendered by their parent (shown on their own only if a program misplaces them)
        case "Series", "Slice", "Point", "ScatterSeries", "Col", "SelectItem", "CheckBoxItem", "RadioItem", "SwitchItem", "ChipItem", "OptionCard",
             "ListItem", "FollowUpItem", "TabItem", "AccordionItem", "SectionItem", "StepsItem", "SnippetCardItem", "OverviewCardItem",
             "ContextCardItem", "CompositeCardItem", "VisualCardItem":
            OUIChildren(nodes: node.props.values.flatMap(\.nodes))
        default:
            OUIUnknown(node: node)
        }
    }
}

/// Components in a column, as a card's children stack.
struct OUIChildren: View {
    let nodes: [OpenUINode]
    var spacing: CGFloat = 14

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(nodes) { OpenUINodeView(node: $0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A component this version of the app doesn't know.
struct OUIUnknown: View {
    let node: OpenUINode

    var body: some View {
        Label(node.type, systemImage: "questionmark.square.dashed")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .padding(8)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 8))
            .accessibilityLabel("Unsupported component \(node.type)")
    }
}

// MARK: Shared look

enum OUIStyle {
    /// Inner panels (card items, option cards, table header) on the card's surface.
    static let panel = Color(.tertiarySystemBackground)
    static let corner: CGFloat = 14

    /// The chart palette: eight categorical hues in a fixed order, stepped for light and dark (validated for color
    /// vision deficiencies; see the dataviz reference palette).
    static func series(_ index: Int, dark: Bool) -> Color {
        let light: [UInt32] = [0x2a78d6, 0xeb6834, 0x1baf7a, 0xeda100, 0xe87ba4, 0x008300, 0x4a3aa7, 0xe34948]
        let night: [UInt32] = [0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181, 0x008300, 0x9085e9, 0xe66767]
        let hex = (dark ? night : light)[index % 8]
        return Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }

    /// A variant name's tint (callouts, tags, icon badges).
    static func tint(_ variant: String?) -> Color {
        switch variant {
        case "info": .blue
        case "success": .green
        case "warning": .orange
        case "error", "danger": .red
        case "inverted": .primary
        default: .secondary
        }
    }
}

extension View {
    /// An inner panel on the card.
    func ouiPanel(padding: CGFloat = 12) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OUIStyle.panel, in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
    }
}

/// Presses through the card, disabled while the program streams.
struct OUIPress {
    let card: OpenUICard
    let streaming: Bool

    func callAsFunction(_ action: String?) {
        guard let action, !streaming else { return }
        card.document.press(action)
    }
}

extension OpenUINode {
    /// A view-only state key for this node (open tab, page).
    func local(_ name: String) -> String { "\(key)#\(name)" }
}
