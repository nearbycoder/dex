import Foundation

/// Any JSON value. The agent's protocol carries free-form JSON in places (tool arguments and details, operation
/// results, OpenUI state), and this keeps it intact through decoding and re-encoding.
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not JSON")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
    ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
    public init(nilLiteral: ()) { self = .null }
}

public extension JSONValue {
    var string: String? { if case .string(let value) = self { value } else { nil } }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
    var int: Int? { number.map { Int($0) } }
    var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
    var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
    var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
    var isNull: Bool { if case .null = self { true } else { false } }

    subscript(key: String) -> JSONValue? {
        get { object?[key] }
        set {
            guard case .object(var dictionary) = self else { return }
            dictionary[key] = newValue
            self = .object(dictionary)
        }
    }

    subscript(index: Int) -> JSONValue? {
        guard let array, array.indices.contains(index) else { return nil }
        return array[index]
    }

    /// Any Encodable value as JSON.
    init<T: Encodable>(encoding value: T) throws {
        let data = try JSONEncoder.dex.encode(value)
        self = try JSONDecoder.dex.decode(JSONValue.self, from: data)
    }

    /// Decodes this value as `T`.
    func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder.dex.decode(T.self, from: JSONEncoder.dex.encode(self))
    }

    /// Compact JSON text, keys sorted (stable for tests and display).
    var jsonText: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    /// Indented JSON text for people.
    var prettyText: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    /// Parses JSON text.
    static func parse(_ text: String) throws -> JSONValue {
        try JSONDecoder.dex.decode(JSONValue.self, from: Data(text.utf8))
    }

    /// The value as Foundation objects (for JavaScriptCore and JSONSerialization).
    var foundationObject: Any {
        switch self {
        case .null: NSNull()
        case .bool(let value): value
        case .number(let value): value
        case .string(let value): value
        case .array(let value): value.map(\.foundationObject)
        case .object(let value): value.mapValues(\.foundationObject)
        }
    }

    /// Foundation objects (from JavaScriptCore or JSONSerialization) as JSON. Unknown values become null.
    init(foundation value: Any?) {
        switch value {
        case nil, is NSNull: self = .null
        case let number as NSNumber:
            // NSNumber wraps both booleans and numbers.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { self = .bool(number.boolValue) } else { self = .number(number.doubleValue) }
        case let string as String: self = .string(string)
        case let array as [Any]: self = .array(array.map { JSONValue(foundation: $0) })
        case let dictionary as [String: Any]: self = .object(dictionary.mapValues { JSONValue(foundation: $0) })
        default: self = .null
        }
    }

    /// Appends `delta` to the string at `path`, creating objects on the way (streamed tool-call arguments).
    mutating func append(_ delta: String, at path: ArraySlice<PathKey>) {
        guard let first = path.first else {
            self = .string((string ?? "") + delta)
            return
        }
        let rest = path.dropFirst()
        switch first {
        case .key(let key):
            var dictionary = object ?? [:]
            var child = dictionary[key] ?? (rest.isEmpty ? .string("") : .object([:]))
            if !rest.isEmpty, child.object == nil, child.array == nil { child = .object([:]) }
            child.append(delta, at: rest)
            dictionary[key] = child
            self = .object(dictionary)
        case .index(let index):
            if var array = self.array, array.indices.contains(index) {
                array[index].append(delta, at: rest)
                self = .array(array)
            } else {
                // Like JavaScript, a numeric key on an object (or a missing slot) is just a key.
                var dictionary = object ?? [:]
                var child = dictionary[String(index)] ?? (rest.isEmpty ? .string("") : .object([:]))
                child.append(delta, at: rest)
                dictionary[String(index)] = child
                self = .object(dictionary)
            }
        }
    }
}

/// One step of a path into JSON: an object key or an array index.
public enum PathKey: Sendable, Hashable, Codable {
    case key(String)
    case index(Int)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let index = try? container.decode(Int.self) { self = .index(index) } else { self = .key(try container.decode(String.self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .key(let key): try container.encode(key)
        case .index(let index): try container.encode(index)
        }
    }
}

public extension JSONDecoder {
    /// The decoder for everything from the agent.
    static var dex: JSONDecoder { JSONDecoder() }
}

public extension JSONEncoder {
    static var dex: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return encoder
    }
}

/// Decodes a field that may be missing or null as a default, so state from an older agent never fails to decode.
public extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, default fallback: @autoclosure () -> T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback()
    }
}
