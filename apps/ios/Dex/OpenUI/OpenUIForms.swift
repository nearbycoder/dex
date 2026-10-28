import DexCore
import SwiftUI

// MARK: Form structure

/// A form: its fields, then its buttons. The primary button validates the fields before it acts.
struct OUIForm: View {
    let node: OpenUINode

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            OUIChildren(nodes: node.nodes("fields"), spacing: 16)
            if let buttons = node.node("buttons") { OpenUINodeView(node: buttons) }
        }
    }
}

/// A labelled field, with its validation error (or hint) under it.
struct OUIFormControl: View {
    let node: OpenUINode

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 2) {
                Text(node.string("label") ?? "").font(.subheadline.weight(.medium))
                if node.required { Text("*").font(.subheadline).foregroundStyle(.red).accessibilityLabel("required") }
            }
            if let input = node.node("input") { OpenUINodeView(node: input) }
            if let error = node.error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("openui.error.\(node.node("input")?.string("name") ?? "")")
            } else if let hint = node.string("hint") {
                Text(hint).font(.caption).foregroundStyle(.secondary)
            }
        }
        .animation(.smooth(duration: 0.2), value: node.error)
    }
}

/// The look of a text field or picker on the card: a filled rounded rectangle.
struct OUIFieldBackground: ViewModifier {
    var error = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OUIStyle.panel, in: .rect(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(error ? Color.red.opacity(0.7) : Color.clear))
    }
}

// MARK: Text

/// A text input. Password inputs are secure, and their values are never saved or sent (only as chat secrets).
struct OUIInput: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming
    @FocusState private var focused: Bool

    var body: some View {
        let name = node.string("name") ?? ""
        let type = node.string("type") ?? "text"
        let text = Binding<String>(get: { node.value.string ?? node.value.number.map { OpenUIValue.number($0).text ?? "" } ?? "" },
                                   set: { card.document.setField(node.key, .string($0)) })
        Group {
            if type == "password" {
                SecureField(node.string("placeholder") ?? "", text: text).textContentType(.password)
            } else {
                TextField(node.string("placeholder") ?? "", text: text)
                    .keyboardType(Self.keyboard(type))
                    .textContentType(type == "email" ? .emailAddress : type == "url" ? .URL : nil)
                    .textInputAutocapitalization(type == "text" ? .sentences : .never)
                    .autocorrectionDisabled(type != "text")
            }
        }
        .focused($focused)
        .submitLabel(.done)
        .modifier(OUIFieldBackground(error: node.fieldError != nil))
        .disabled(streaming)
        .onChange(of: focused) { _, focused in
            if focused { card.document.focusField(node.key) } else { card.document.blurField(node.key, .string(text.wrappedValue)) }
        }
        .accessibilityIdentifier("openui.field.\(name)")
    }

    static func keyboard(_ type: String) -> UIKeyboardType {
        switch type {
        case "email": .emailAddress
        case "number": .decimalPad
        case "url": .URL
        default: .default
        }
    }
}

struct OUITextArea: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming
    @FocusState private var focused: Bool

    var body: some View {
        let text = Binding<String>(get: { node.value.string ?? "" }, set: { card.document.setField(node.key, .string($0)) })
        TextField(node.string("placeholder") ?? "", text: text, axis: .vertical)
            .lineLimit(max(2, Int(node.number("rows") ?? 3))...12)
            .focused($focused)
            .modifier(OUIFieldBackground(error: node.fieldError != nil))
            .disabled(streaming)
            .onChange(of: focused) { _, focused in
                if focused { card.document.focusField(node.key) } else { card.document.blurField(node.key, .string(text.wrappedValue)) }
            }
            .accessibilityIdentifier("openui.field.\(node.string("name") ?? "")")
    }
}

// MARK: Choices

/// A menu of options (also the filters bound to a $variable).
struct OUISelect: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items").filter { !($0.string("value") ?? "").isEmpty }
        let value = node.value.string ?? node.value.number.map { OpenUIValue.number($0).text ?? "" } ?? ""
        let current = items.first { $0.string("value") == value }
        Menu {
            Picker(node.string("placeholder") ?? "Choose", selection: Binding(get: { value }, set: { card.document.setField(node.key, .string($0)) })) {
                ForEach(items) { item in
                    Text(item.string("label") ?? item.string("value") ?? "").tag(item.string("value") ?? "")
                }
            }
        } label: {
            HStack {
                Text(current.map { $0.string("label") ?? $0.string("value") ?? "" } ?? (node.string("placeholder").flatMap { $0.isEmpty ? nil : $0 } ?? "Select…"))
                    .foregroundStyle(current == nil ? .secondary : .primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .font(node.string("size") == "small" ? .subheadline : .body)
            .modifier(OUIFieldBackground(error: node.fieldError != nil))
            .contentShape(.rect)
        }
        .disabled(streaming)
        .accessibilityIdentifier("openui.field.\(node.string("name") ?? "")")
    }
}

/// A date, or a date range (kept as ISO 8601 text, like JavaScript dates in the web's form state).
struct OUIDatePicker: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let range = node.string("mode") == "range"
        HStack(spacing: 10) {
            if range {
                picker(node.value["from"], label: "From") { set(from: $0, to: Self.date(node.value["to"]) ?? $0) }
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                picker(node.value["to"], label: "To") { set(from: Self.date(node.value["from"]) ?? $0, to: $0) }
            } else {
                picker(node.value, label: "Date") { card.document.setField(node.key, .string(Self.iso($0))) }
            }
            Spacer(minLength: 0)
        }
        .disabled(streaming)
        .accessibilityIdentifier("openui.field.\(node.string("name") ?? "")")
    }

    @ViewBuilder
    private func picker(_ value: JSONValue?, label: String, set: @escaping (Date) -> Void) -> some View {
        if let date = Self.date(value) {
            DatePicker(label, selection: Binding(get: { date }, set: set), displayedComponents: .date).labelsHidden()
        } else {
            Button { set(Calendar.current.startOfDay(for: .now)) } label: { Label(label, systemImage: "calendar") }
                .buttonStyle(.glass)
        }
    }

    private func set(from: Date, to: Date) {
        card.document.setField(node.key, ["from": .string(Self.iso(min(from, to))), "to": .string(Self.iso(max(from, to)))])
    }

    static func date(_ value: JSONValue?) -> Date? {
        guard let text = value?.string else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text) ?? {
            let day = DateFormatter()
            day.dateFormat = "yyyy-MM-dd"
            return day.date(from: text)
        }()
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// A number on a slider; the value is kept (as `[n]`) when you let go.
struct OUISlider: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming
    @State private var dragging: Double?

    var body: some View {
        let low = node.number("min") ?? 0
        let high = max(node.number("max") ?? 100, low + 1)
        let step = node.number("step") ?? (node.string("variant") == "discrete" ? 1 : 0)
        let stored = node.value.array?.first?.number ?? node.value.number ?? node.props["defaultValue"]?.array?.first?.number ?? low
        let value = dragging ?? stored
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(node.string("label") ?? node.string("name") ?? "").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text(OpenUIValue.number(value).text ?? "").font(.subheadline.monospacedDigit().weight(.medium))
            }
            Group {
                if step > 0 {
                    Slider(value: Binding(get: { value }, set: { dragging = $0 }), in: low...high, step: step) { editing in commit(editing) }
                } else {
                    Slider(value: Binding(get: { value }, set: { dragging = $0 }), in: low...high) { editing in commit(editing) }
                }
            }
            .disabled(streaming)
            .accessibilityIdentifier("openui.field.\(node.string("name") ?? "")")
        }
        .sensoryFeedback(.selection, trigger: step > 0 ? value : 0)
    }

    private func commit(_ editing: Bool) {
        guard !editing, let dragging else { return }
        card.document.setField(node.key, [.number(dragging)])
        self.dragging = nil
    }
}

/// CheckBoxGroup (check marks) and SwitchGroup (switches): the field is a map of item name → on.
struct OUIToggleGroup: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items")
        let switches = node.type == "SwitchGroup"
        let stored = node.value.object ?? [:]
        let aggregate = Dictionary(items.map { ($0.string("name") ?? "", stored[$0.string("name") ?? ""]?.bool ?? $0.bool("defaultChecked") ?? false) }, uniquingKeysWith: { a, _ in a })
        let group = VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let name = item.string("name") ?? ""
                let on = Binding<Bool>(get: { aggregate[name] ?? false }, set: { value in
                    var next = aggregate.mapValues(JSONValue.bool)
                    next[name] = .bool(value)
                    card.document.setField(node.key, .object(next))
                })
                if switches {
                    Toggle(isOn: on) { label(item) }
                        .padding(.vertical, 8)
                        .accessibilityIdentifier("openui.switch.\(name)")
                } else {
                    Button { on.wrappedValue.toggle() } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: on.wrappedValue ? "checkmark.square.fill" : "square")
                                .font(.title3)
                                .foregroundStyle(on.wrappedValue ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                                .contentTransition(.symbolEffect(.replace))
                            label(item)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on.wrappedValue ? .isSelected : [])
                    .accessibilityIdentifier("openui.check.\(name)")
                }
                if index < items.count - 1 { Divider() }
            }
        }
        .disabled(streaming)
        .sensoryFeedback(.selection, trigger: aggregate)
        switch node.string("variant") {
        case "card": group.padding(.horizontal, 12).padding(.vertical, 4).background(OUIStyle.panel, in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
        case "sunk": group.padding(.horizontal, 12).padding(.vertical, 4).background(.quaternary.opacity(0.5), in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
        default: group
        }
    }

    private func label(_ item: OpenUINode) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let label = item.string("label") { Text(label).font(.subheadline).foregroundStyle(.primary) }
            if let description = item.string("description"), !description.isEmpty { Text(description).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

struct OUIRadioGroup: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let items = node.nodes("items")
        let value = node.value.string ?? node.string("defaultValue")
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let option = item.string("value") ?? ""
                Button { card.document.setField(node.key, .string(option)) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: value == option ? "largecircle.fill.circle" : "circle")
                            .font(.title3)
                            .foregroundStyle(value == option ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.string("label") ?? option).font(.subheadline)
                            if let description = item.string("description"), !description.isEmpty { Text(description).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 8)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(value == option ? .isSelected : [])
                .accessibilityIdentifier("openui.radio.\(option)")
                if index < items.count - 1 { Divider() }
            }
        }
        .disabled(streaming)
        .sensoryFeedback(.selection, trigger: value)
    }
}

/// Compact selectable pills (one or many).
struct OUIChips: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let selection = node.field?["selection"]?.array?.compactMap(\.string) ?? []
        OUIFlow(spacing: 8) {
            ForEach(node.nodes("items").filter { !($0.string("value") ?? "").isEmpty }) { item in
                let value = item.string("value") ?? ""
                let on = selection.contains(value)
                Button { card.document.toggle(node.key, value) } label: {
                    HStack(spacing: 5) {
                        if let icon = item.node("icon") { OUIIcon(node: icon).imageScale(.small) }
                        Text(item.string("label") ?? value)
                        if on { Image(systemName: "checkmark").font(.caption2.weight(.bold)) }
                    }
                    .font(.subheadline)
                }
                .ouiButtonStyle(on ? "primary" : "secondary")
                .controlSize(.small)
                .disabled(item.bool("disabled") == true || streaming)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("openui.chip.\(value)")
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Selectable cards with a title, subtitle, and an icon or image on top.
struct OUIOptionCards: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming

    var body: some View {
        let selection = node.field?["selection"]?.array?.compactMap(\.string) ?? []
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .top)], spacing: 10) {
            ForEach(node.nodes("items").filter { !($0.string("value") ?? "").isEmpty }) { item in
                let value = item.string("value") ?? ""
                let on = selection.contains(value)
                Button { card.document.toggle(node.key, value) } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        if let top = item.node("topContent") {
                            if top.type == "Icon" {
                                OUIIcon(node: top).font(.title3).foregroundStyle(.tint)
                            } else {
                                OUIImage(src: top.string("src"), alt: top.string("alt"), fill: true).frame(height: 70).clipShape(.rect(cornerRadius: 8))
                            }
                        }
                        Text(item.string("title") ?? value).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        if let subtitle = item.string("subtitle") { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                    }
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(12)
                    .background(on ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(OUIStyle.panel), in: .rect(cornerRadius: OUIStyle.corner, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: OUIStyle.corner, style: .continuous).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1.5))
                    .overlay(alignment: .topTrailing) {
                        if on { Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint).padding(8) }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(item.bool("disabled") == true || streaming)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("openui.option.\(value)")
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

// MARK: Editable table

/// A small spreadsheet: edit cells inline, then Save Changes sends the rows (as the table's form field) to the chat.
struct OUIEditableTable: View {
    let node: OpenUINode
    @Environment(OpenUICard.self) private var card
    @Environment(\.openUIStreaming) private var streaming
    @State private var edits: [String: [JSONValue]] = [:]

    private struct Column {
        let type: String
        let key: String
        let header: String
        let options: [(value: String, label: String)]
    }

    var body: some View {
        let columns = (node.props["columns"]?.array ?? []).map { column in
            Column(type: column["type"]?.string ?? "text", key: column["key"]?.string ?? "", header: column["header"]?.text ?? "",
                   options: (column["options"]?.array ?? []).map { ($0["value"]?.text ?? "", $0["label"]?.text ?? "") })
        }
        let saved = node.value.array ?? node.props["data"]?.json.array ?? []
        let rows: [(id: String, values: [JSONValue])] = saved.map { (OpenUIValue(json: $0["id"] ?? .null).text ?? "", $0["values"]?.array ?? []) }
        let changed = rows.reduce(0) { count, row in
            guard let edit = edits[row.id] else { return count }
            return count + zip(edit, row.values).filter { $0 != $1 }.count
        }
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 6) {
                    GridRow {
                        ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                            Text(column.header).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                        }
                    }
                    ForEach(rows, id: \.id) { row in
                        GridRow {
                            ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                                cell(column, value: (edits[row.id] ?? row.values)[ouiAt: index] ?? .null) { value in
                                    var values = edits[row.id] ?? row.values
                                    while values.count < columns.count { values.append(.null) }
                                    values[index] = value
                                    edits[row.id] = values
                                }
                            }
                        }
                    }
                }
            }
            if changed > 0 {
                HStack {
                    Text("\(changed) \(changed == 1 ? "change" : "changes")").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Reset") { edits = [:] }.buttonStyle(.glass).controlSize(.small)
                    Button("Save Changes") {
                        let out = rows.map { row -> JSONValue in ["id": .string(row.id), "values": .array(edits[row.id] ?? row.values)] }
                        card.document.saveTable(node.key, rows: .array(out))
                        edits = [:]
                    }
                    .prominentButton()
                    .controlSize(.small)
                    .accessibilityIdentifier("openui.button.Save Changes")
                }
                .transition(.opacity)
            }
        }
        .disabled(streaming)
        .animation(.smooth(duration: 0.2), value: changed)
    }

    @ViewBuilder
    private func cell(_ column: Column, value: JSONValue, set: @escaping (JSONValue) -> Void) -> some View {
        switch column.type {
        case "select":
            Picker(column.header, selection: Binding(get: { value.string ?? "" }, set: { set(.string($0)) })) {
                ForEach(column.options, id: \.value) { Text($0.label).tag($0.value) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        case "date-single":
            DatePicker(column.header, selection: Binding(get: { OUIDatePicker.date(value) ?? .now }, set: { set(.string(OUIDatePicker.iso($0))) }), displayedComponents: .date)
                .labelsHidden()
        case "number":
            TextField(column.header, text: Binding(get: { value.number.map { OpenUIValue.number($0).text ?? "" } ?? value.string ?? "" },
                                                   set: { set(Double($0).map(JSONValue.number) ?? .string($0)) }))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(minWidth: 70)
                .modifier(OUIFieldBackground())
        default:
            TextField(column.header, text: Binding(get: { value.string ?? value.number.map { OpenUIValue.number($0).text ?? "" } ?? "" }, set: { set(.string($0)) }))
                .keyboardType(column.type == "url" ? .URL : .default)
                .frame(minWidth: 110)
                .modifier(OUIFieldBackground())
        }
    }
}

private extension Array {
    subscript(ouiAt index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
