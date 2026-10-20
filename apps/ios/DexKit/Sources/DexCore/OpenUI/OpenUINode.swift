import Foundation

/// One component of an evaluated OpenUI program, as the engine hands it to the renderer: its name, its props with
/// every expression resolved, and what the app can do with it (press it, edit its field).
public struct OpenUINode: Hashable, Sendable, Identifiable {
    /// The component's name in the library, e.g. "BarChart".
    public let type: String
    /// Where it sits in the tree (`root.children.2`). Stable while the program keeps its shape, so it identifies the
    /// node across renders and keys its view-only state (the open tab, the table page).
    public let key: String
    /// The statement that made it (`chart = BarChart(…)`), when it has one.
    public let statement: String?
    public let props: [String: OpenUIValue]
    /// The action a press runs (buttons, follow-ups, clickable list items and cards).
    public let action: String?
    /// A field's current state: `value` and `error` for inputs, `selection` and `type` for Chips and OptionCards.
    public let field: JSONValue?
    /// FormControl: its input's validation error, and whether it's required.
    public let error: String?
    public let required: Bool
    /// Live data is still loading and there's nothing to show yet (tables, pie and radial charts).
    public let loading: Bool
    /// Its arguments are still streaming in.
    public let partial: Bool

    public var id: String { key }

    public init(type: String, key: String, statement: String? = nil, props: [String: OpenUIValue] = [:], action: String? = nil, field: JSONValue? = nil,
                error: String? = nil, required: Bool = false, loading: Bool = false, partial: Bool = false) {
        self.type = type
        self.key = key
        self.statement = statement
        self.props = props
        self.action = action
        self.field = field
        self.error = error
        self.required = required
        self.loading = loading
        self.partial = partial
    }

    /// Reads the engine's JSON for a node (`{"$": type, "k": key, "p": props, …}`).
    init?(json: JSONValue) {
        guard let object = json.object, let type = object["$"]?.string, let key = object["k"]?.string else { return nil }
        self.type = type
        self.key = key
        statement = object["s"]?.string
        props = (object["p"]?.object ?? [:]).mapValues(OpenUIValue.init(json:))
        action = object["a"]?.string
        field = object["f"].flatMap { $0.isNull ? nil : $0 }
        error = object["error"]?.string
        required = object["required"]?.bool ?? false
        loading = object["loading"]?.bool ?? false
        partial = object["partial"]?.bool ?? false
    }

    public subscript(prop: String) -> OpenUIValue? { props[prop] }

    /// A text prop: strings as they are, numbers and booleans as text.
    public func string(_ prop: String) -> String? { props[prop]?.text }
    public func number(_ prop: String) -> Double? { props[prop]?.number }
    public func bool(_ prop: String) -> Bool? { props[prop]?.bool }
    /// A component prop.
    public func node(_ prop: String) -> OpenUINode? { props[prop]?.node }
    /// The components in a list prop (skipping anything else).
    public func nodes(_ prop: String) -> [OpenUINode] { props[prop]?.nodes ?? [] }

    /// The field's value (inputs).
    public var value: JSONValue { field?["value"] ?? .null }
    /// The field's validation error.
    public var fieldError: String? { field?["error"]?.string }

    /// Every node in this subtree, depth first (this one first).
    public var descendants: [OpenUINode] {
        [self] + props.keys.sorted().flatMap { props[$0]!.descendantNodes }
    }
}

/// A prop's value: JSON, or a component, an action, or a $variable binding.
public indirect enum OpenUIValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([OpenUIValue])
    case object([String: OpenUIValue])
    case node(OpenUINode)
    /// An action plan (a press is run with its id).
    case action(String)
    /// `value: $name`: the field reads and writes the variable.
    case binding(target: String, value: JSONValue)

    public init(json: JSONValue) {
        switch json {
        case .null: self = .null
        case .bool(let value): self = .bool(value)
        case .number(let value): self = .number(value)
        case .string(let value): self = .string(value)
        case .array(let items): self = .array(items.map(OpenUIValue.init(json:)))
        case .object(let object):
            if object["$"] != nil, object["k"] != nil, let node = OpenUINode(json: json) {
                self = .node(node)
            } else if let id = object["$a"]?.string, object.count == 1 {
                self = .action(id)
            } else if let target = object["$bind"]?.string {
                self = .binding(target: target, value: object["value"] ?? .null)
            } else {
                self = .object(object.mapValues(OpenUIValue.init(json:)))
            }
        }
    }

    public var string: String? { if case .string(let value) = self { value } else { nil } }
    public var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
    public var node: OpenUINode? { if case .node(let value) = self { value } else { nil } }
    public var array: [OpenUIValue]? { if case .array(let value) = self { value } else { nil } }
    public var object: [String: OpenUIValue]? { if case .object(let value) = self { value } else { nil } }
    public var isNull: Bool { if case .null = self { true } else { false } }

    /// A number, or a string that reads as one.
    public var number: Double? {
        switch self {
        case .number(let value): value
        case .string(let value): Double(value.trimmingCharacters(in: .whitespaces))
        default: nil
        }
    }

    /// The value as text for a label: strings, numbers (without a needless ".0"), booleans.
    public var text: String? {
        switch self {
        case .string(let value): value
        case .number(let value): OpenUIValue.format(value)
        case .bool(let value): String(value)
        case .binding(_, let value): value.string ?? value.number.map(OpenUIValue.format)
        default: nil
        }
    }

    /// The components in a list (or the one component).
    public var nodes: [OpenUINode] {
        switch self {
        case .node(let node): [node]
        case .array(let items): items.compactMap(\.node)
        default: []
        }
    }

    public subscript(key: String) -> OpenUIValue? { object?[key] }

    /// Back to plain JSON (components and actions become null).
    public var json: JSONValue {
        switch self {
        case .null, .node, .action: .null
        case .bool(let value): .bool(value)
        case .number(let value): .number(value)
        case .string(let value): .string(value)
        case .array(let items): .array(items.map(\.json))
        case .object(let object): .object(object.mapValues(\.json))
        case .binding(_, let value): value
        }
    }

    var descendantNodes: [OpenUINode] {
        switch self {
        case .node(let node): node.descendants
        case .array(let items): items.flatMap(\.descendantNodes)
        case .object(let object): object.keys.sorted().flatMap { object[$0]!.descendantNodes }
        default: []
        }
    }

    static func format(_ value: Double) -> String {
        value.rounded() == value && abs(value) < 1e15 ? String(Int64(value)) : String(value)
    }
}

/// A problem the engine reports, as OpenUI's `OpenUIError`: the parser's, a runtime one, or a Query or Mutation that
/// failed.
public struct OpenUIError: Hashable, Sendable, Codable {
    public var source: String
    public var code: String
    public var message: String
    public var statementId: String?
    public var component: String?
    public var path: String?
    public var toolName: String?
    public var hint: String?
    public var severity: String?

    public init(source: String, code: String, message: String, statementId: String? = nil, component: String? = nil, path: String? = nil,
                toolName: String? = nil, hint: String? = nil, severity: String? = nil) {
        self.source = source
        self.code = code
        self.message = message
        self.statementId = statementId
        self.component = component
        self.path = path
        self.toolName = toolName
        self.hint = hint
        self.severity = severity
    }
}

/// What a press asks the host to do (OpenUI's `ActionEvent`): send a message to the chat, open a link, or one of
/// Dex's actions (OpenChat, OpenFile, OpenMachine, Copy).
public struct OpenUIActionEvent: Hashable, Sendable {
    public var type: String
    public var params: [String: JSONValue]
    public var humanFriendlyMessage: String
    /// The form's values (or every value, outside a form) when it was pressed.
    public var formState: JSONValue?
    public var formName: String?

    public init(type: String, params: [String: JSONValue] = [:], humanFriendlyMessage: String = "", formState: JSONValue? = nil, formName: String? = nil) {
        self.type = type
        self.params = params
        self.humanFriendlyMessage = humanFriendlyMessage
        self.formState = formState
        self.formName = formName
    }

    public init(json: JSONValue) {
        type = json["type"]?.string ?? "continue_conversation"
        params = json["params"]?.object ?? [:]
        humanFriendlyMessage = json["humanFriendlyMessage"]?.string ?? ""
        formState = json["formState"]
        formName = json["formName"]?.string
    }

    public static let continueConversation = "continue_conversation"
    public static let openURL = "open_url"
}

/// A Query or Mutation call for the host to run.
public struct OpenUIToolCall: Hashable, Sendable {
    public var name: String
    public var args: JSONValue
    /// A Query (runs on its own while the card shows; may only read), not a button's Mutation.
    public var query: Bool

    public init(name: String, args: JSONValue, query: Bool) {
        self.name = name
        self.args = args
        self.query = query
    }
}
