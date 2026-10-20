import Foundation
import Observation

/// What a card needs from the chat it's in (the web's OpenUIHost and ChatSecrets contexts, and its router).
public struct OpenUICardHost {
    /// Runs an app operation for the card (DexAgent.runUiOperation).
    public var run: (_ name: String, _ args: JSONValue, _ query: Bool, _ confirmed: Bool) async throws -> UiOperationResult
    /// Sends a message to the chat.
    public var send: (String) async throws -> Void
    /// Keeps a password field's value as a chat secret; returns the name to put in `{{secret:<name>}}`.
    public var storeSecret: (_ field: String, _ value: String) async throws -> String
    /// Saves the card's state (form values and $variables, without passwords).
    public var saveState: (JSONValue) -> Void
    /// Opens a link or a place in Dex.
    public var open: (OpenUIDestination) -> Void
    /// Copies text; false if it couldn't.
    public var copy: (String) -> Bool

    public init(run: @escaping (String, JSONValue, Bool, Bool) async throws -> UiOperationResult, send: @escaping (String) async throws -> Void,
                storeSecret: @escaping (String, String) async throws -> String, saveState: @escaping (JSONValue) -> Void,
                open: @escaping (OpenUIDestination) -> Void, copy: @escaping (String) -> Bool) {
        self.run = run
        self.send = send
        self.storeSecret = storeSecret
        self.saveState = saveState
        self.open = open
        self.copy = copy
    }
}

/// Where a press can take you.
public enum OpenUIDestination: Hashable, Sendable {
    case url(URL)
    case chat(String)
    case file(String)
    case machine(String)
}

/// One `render_ui` card in a chat: its program in the engine, wired to the chat like the web's OpenUIBlock
/// (apps/web/src/client/components/openui-block.tsx). Queries and Mutations run app operations (admin ones only after
/// you confirm Dex's own summary), Queries only while the card is on screen, presses send messages (password values
/// kept as secrets), and its state is saved shortly after each change.
@MainActor
@Observable
public final class OpenUICard {
    /// The render_ui call's id: the key of its saved state.
    public let id: String
    public let document: OpenUIDocument
    /// Live data that didn't load and buttons that failed, for the list under the card.
    public private(set) var toolErrors: [String] = []
    /// Problems in the program itself, for "Fix it".
    public private(set) var problems: [String] = []
    /// A press that couldn't be done.
    public var error: String?
    /// A short confirmation ("Copied").
    public private(set) var notice: String?
    /// An admin operation waiting for you to confirm Dex's summary of it.
    public private(set) var confirmation: Confirmation?
    /// View-only state kept with the card (open tab, table page), so it reopens as you left it.
    public var local: [String: JSONValue] = [:]

    public struct Confirmation: Identifiable, Equatable {
        public let id = UUID()
        public let summary: String
        public static func == (a: Confirmation, b: Confirmation) -> Bool { a.id == b.id }
    }

    /// The card is on screen (or about to be): only then do Queries run.
    public var visible = false {
        didSet {
            guard visible else { return }
            let resume = waiting
            waiting = []
            resume.forEach { $0.resume() }
        }
    }

    public static let cancelled = "You cancelled it."

    @ObservationIgnored private let host: OpenUICardHost
    @ObservationIgnored private var waiting: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var answer: ((Bool) -> Void)?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var savedState: JSONValue?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    /// How long after a change the state is saved.
    @ObservationIgnored public var saveDelay: Duration = .milliseconds(800)

    public init(id: String, savedState: JSONValue?, host: OpenUICardHost, runtime: OpenUIRuntime? = nil) {
        self.id = id
        self.host = host
        document = OpenUIDocument(id: "card-\(id)-\(UUID().uuidString)", runtime: runtime)
        self.savedState = savedState?.object != nil ? savedState : nil
        document.onTool = { [weak self] call in await self?.runTool(call) ?? .failure(OpenUIToolError(Self.cancelled)) }
        document.onAction = { [weak self] event in self?.handle(event) }
        document.onStateChange = { [weak self] state in self?.stateChanged(state) }
        document.onRender = { [weak self] in self?.refreshErrors() }
        document.restore(self.savedState)
    }

    /// The program so far (streaming) or in full.
    public func update(code: String, streaming: Bool) {
        document.setCode(code, streaming: streaming)
    }

    /// Reads the engine's errors into the lists under the card (call after it renders).
    public func refreshErrors() {
        let errors = document.errors
        var seen = Set<String>()
        let messages = errors
            .filter { ($0.source == "query" || $0.source == "mutation") && !$0.message.hasSuffix(Self.cancelled) }
            .map { Self.toolMessage($0.message) }
            .filter { seen.insert($0).inserted }
        if messages != toolErrors { toolErrors = messages }
        let found = Self.programProblems(errors)
        if found != problems { problems = found }
    }

    /// Asks the chat to render the UI again without its problems.
    public func fix() async throws {
        try await host.send(Self.fixMessage(problems))
    }

    /// Your answer to the confirmation.
    public func confirm(_ yes: Bool) {
        let respond = answer
        answer = nil
        confirmation = nil
        respond?(yes)
    }

    // MARK: Tools

    private func runTool(_ call: OpenUIToolCall) async -> Result<JSONValue, OpenUIToolError> {
        do {
            if call.query, !visible { await withCheckedContinuation { waiting.append($0) } }
            var outcome = try await host.run(call.name, call.args, call.query, false)
            if case .confirm(let summary) = outcome {
                guard await ask(summary) else { return .failure(OpenUIToolError(Self.cancelled)) }
                outcome = try await host.run(call.name, call.args, call.query, true)
            }
            switch outcome {
            case .ok(let result, _): return .success(result)
            case .failed(let error): return .failure(OpenUIToolError(error))
            case .confirm: return .failure(OpenUIToolError("It wasn't confirmed."))
            }
        } catch {
            return .failure(OpenUIToolError(error.localizedDescription))
        }
    }

    private func ask(_ summary: String) async -> Bool {
        confirm(false)
        return await withCheckedContinuation { continuation in
            answer = { continuation.resume(returning: $0) }
            confirmation = Confirmation(summary: summary)
        }
    }

    // MARK: Actions

    private func handle(_ event: OpenUIActionEvent) {
        switch event.type {
        case OpenUIActionEvent.continueConversation:
            Task { await submit(event) }
        case OpenUIActionEvent.openURL:
            if let url = Self.safeHttpUrl(event.params["url"]) { host.open(.url(url)) }
        case "OpenChat":
            if let id = Self.param(event, "sessionId") { host.open(.chat(id)) }
        case "OpenFile":
            if let path = Self.param(event, "path") { host.open(.file(path)) }
        case "OpenMachine":
            if let key = Self.param(event, "vmKey") { host.open(.machine(key)) }
        case "Copy":
            guard let text = event.params["text"]?.string else { return }
            if host.copy(text) { flash("Copied") } else { error = "Couldn't copy to the clipboard." }
        default:
            break
        }
    }

    /// Password fields' values never go into the message: Dex keeps them and the chat gets placeholders.
    private func submit(_ event: OpenUIActionEvent) async {
        error = nil
        do {
            let fields = document.passwordFields
            let state = fields.isEmpty ? event.formState : try await Self.withoutSecrets(event.formState ?? .null, fields: fields, store: host.storeSecret)
            try await host.send(Self.modelMessage(event, formState: state))
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func flash(_ text: String) {
        notice = text
        noticeTask?.cancel()
        noticeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, self?.notice == text else { return }
            self?.notice = nil
        }
    }

    // MARK: State

    /// Filters, tabs, and half-filled forms are saved shortly after each change, without passwords.
    private func stateChanged(_ state: JSONValue) {
        guard !document.streaming else { return }
        let next = Self.withoutPasswords(state, fields: document.passwordFields)
        guard next != savedState else { return }
        savedState = next
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.saveDelay)
            guard !Task.isCancelled, let state = self.savedState else { return }
            self.host.saveState(state)
        }
    }
}

// MARK: The web's rules (openui-block.tsx), as plain functions

public extension OpenUICard {
    /// Model-written UI can carry any URL; only open web pages, never `javascript:` or `data:` ones.
    static func safeHttpUrl(_ value: JSONValue?) -> URL? {
        guard let text = value?.string ?? value?.number.map({ String($0) }),
              let url = URL(string: text.trimmingCharacters(in: .whitespaces)), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host() != nil else { return nil }
        return url
    }

    /// `[UI action] …`, then the form's values and the context, as the web sends them.
    static func modelMessage(_ event: OpenUIActionEvent, formState: JSONValue?) -> String {
        var lines = ["[UI action] \(event.humanFriendlyMessage)"]
        if let object = formState?.object, !object.isEmpty { lines.append("Form values: \(scriptJSON(.object(object)))") }
        if let context = event.params["context"] { lines.append("Context: \(scriptJSON(context))") }
        return lines.joined(separator: "\n")
    }

    /// The form's values with each password field's value swapped for its `{{secret:<name>}}` placeholder, after
    /// storing it. Fields are found by name (`{ value }` or a bare string), wherever the form nests them.
    static func withoutSecrets(_ state: JSONValue, fields: Set<String>, store: (String, String) async throws -> String) async throws -> JSONValue {
        func walk(_ node: JSONValue, key: String?) async throws -> JSONValue {
            if let key, fields.contains(key) {
                let value = node.string ?? node["value"]?.string
                if let value, !value.isEmpty {
                    let placeholder = JSONValue.string("{{secret:\(try await store(key, value))}}")
                    if node.string != nil { return placeholder }
                    var copy = node
                    copy["value"] = placeholder
                    return copy
                }
            }
            switch node {
            case .array(let items):
                var out: [JSONValue] = []
                for item in items { out.append(try await walk(item, key: nil)) }
                return .array(out)
            case .object(let object):
                var out: [String: JSONValue] = [:]
                for (name, value) in object { out[name] = try await walk(value, key: name) }
                return .object(out)
            default:
                return node
            }
        }
        return try await walk(state, key: nil)
    }

    /// State to save, without password fields: those values are only ever kept as secrets.
    static func withoutPasswords(_ node: JSONValue, fields: Set<String>) -> JSONValue {
        switch node {
        case .array(let items): .array(items.map { withoutPasswords($0, fields: fields) })
        case .object(let object): .object(object.filter { !fields.contains($0.key) }.mapValues { withoutPasswords($0, fields: fields) })
        default: node
        }
    }

    /// Problems in the program itself (not failed data), described for the model that wrote it.
    static func programProblems(_ errors: [OpenUIError]) -> [String] {
        errors
            .filter { ($0.source == "parser" || $0.source == "runtime") && $0.severity != "warning" }
            .map { error in
                [error.statementId.map { "\($0):" }, error.component, error.message, error.hint.map { "(\($0))" }]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            }
    }

    /// `Query "app_x" returned an error: …` → `app_x: …`.
    static func toolMessage(_ message: String) -> String {
        guard let pattern = try? Regex(#"^(?:Query|Mutation) "([^"]+)" (?:returned an error|failed): "#),
              let match = try? pattern.prefixMatch(in: message), let name = match.output[1].substring else { return message }
        return "\(name): " + message[match.range.upperBound...]
    }

    static func fixMessage(_ problems: [String]) -> String {
        "[UI errors] The UI you rendered has problems. Render it again, fixed:\n" + problems.map { "- \($0)" }.joined(separator: "\n")
    }

    /// A string parameter of a Dex action, within reason.
    static func param(_ event: OpenUIActionEvent, _ key: String) -> String? {
        guard let value = event.params[key]?.string, !value.isEmpty, value.count <= 2_000 else { return nil }
        return value
    }

    /// JSON as JavaScript's JSON.stringify writes it (keys in their order aren't kept by JSONValue, so sorted).
    static func scriptJSON(_ value: JSONValue) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }
}

/// What a generated UI gets back when it runs an operation (the web's `UiOperationResult`).
public enum UiOperationResult: Hashable, Sendable, Decodable {
    /// `changed`: Dex's summary of what it did, when it changed something.
    case ok(result: JSONValue, changed: String?)
    case failed(String)
    /// An admin operation: run it again with `confirmed` once you've confirmed this summary.
    case confirm(String)

    public init(from decoder: Decoder) throws {
        self.init(json: try JSONValue(from: decoder))
    }

    public init(json: JSONValue) {
        switch json["ok"] {
        case .bool(true): self = .ok(result: json["result"] ?? .null, changed: json["changed"]?.string)
        case .string("confirm"): self = .confirm(json["summary"]?.string ?? "Run this operation?")
        default: self = .failed(json["error"]?.string ?? "It didn't work.")
        }
    }
}
