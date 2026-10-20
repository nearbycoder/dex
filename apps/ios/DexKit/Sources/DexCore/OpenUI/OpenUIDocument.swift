import Foundation
import Observation

/// One OpenUI program in the engine: feed it the code (again and again while it streams), and it keeps the
/// evaluated tree, the problems, and whether live data is loading. Edits and presses go back in; Query and Mutation
/// calls, actions, and state changes come out through the handlers.
@MainActor
@Observable
public final class OpenUIDocument {
    public nonisolated let id: String
    /// The evaluated program (nil until it has a root component).
    public private(set) var tree: OpenUINode?
    /// OpenUI's errors for the program as it stands (none while it streams).
    public private(set) var errors: [OpenUIError] = []
    /// Some live data is loading.
    public private(set) var loading = false
    public private(set) var streaming = false
    /// Names of the program's password inputs: their values are never saved or sent.
    public private(set) var passwordFields: Set<String> = []
    public private(set) var code = ""
    /// The engine failed (didn't load, or threw).
    public private(set) var engineError: String?

    /// Runs a Query or Mutation: the result, or an error message.
    @ObservationIgnored public var onTool: ((OpenUIToolCall) async -> Result<JSONValue, OpenUIToolError>)?
    /// A press asks the host to do something (send to the chat, open, copy).
    @ObservationIgnored public var onAction: ((OpenUIActionEvent) -> Void)?
    /// The $variables and form values changed (the whole store).
    @ObservationIgnored public var onStateChange: ((JSONValue) -> Void)?
    /// After each evaluation.
    @ObservationIgnored public var onRender: (() -> Void)?

    @ObservationIgnored private let runtime: OpenUIRuntime
    @ObservationIgnored private var renderScheduled = false
    @ObservationIgnored private var toolsInFlight = 0
    @ObservationIgnored private var lastState: JSONValue?

    public init(id: String = UUID().uuidString, runtime: OpenUIRuntime? = nil) {
        self.id = id
        self.runtime = runtime ?? .shared
        self.runtime.register(self)
        if !self.runtime.isLoaded { engineError = self.runtime.lastException ?? "The OpenUI engine didn't load." }
    }

    isolated deinit {
        runtime.unregister(id)
    }

    /// Starts from saved state (`uiStates`): `$` keys are variables, others are forms. Call before the code.
    public func restore(_ state: JSONValue?) {
        _ = runtime.call(id, "setInitialState", ["state": state ?? .null])
        render()
    }

    /// The program so far; `streaming` while its arguments are still arriving.
    public func setCode(_ code: String, streaming: Bool) {
        guard code != self.code || streaming != self.streaming else { return }
        self.code = code
        self.streaming = streaming
        _ = runtime.call(id, "setCode", ["code": .string(code), "streaming": .bool(streaming)])
        render()
    }

    // MARK: Input

    /// A field's new value (by its node's key).
    public func setField(_ key: String, _ value: JSONValue) {
        _ = runtime.call(id, "setField", ["key": .string(key), "value": value])
        render()
    }

    public func focusField(_ key: String) { _ = runtime.call(id, "focusField", ["key": .string(key)]) }
    public func blurField(_ key: String, _ value: JSONValue) { _ = runtime.call(id, "blurField", ["key": .string(key), "value": value]) }

    /// Chips and OptionCards: selects or clears an option.
    public func toggle(_ key: String, _ value: String) {
        _ = runtime.call(id, "toggle", ["key": .string(key), "value": .string(value)])
        render()
    }

    /// EditableTable's Save Changes, with its rows as `{ id, values }`.
    public func saveTable(_ key: String, rows: JSONValue) {
        _ = runtime.call(id, "saveTable", ["key": .string(key), "rows": rows])
        render()
    }

    /// Presses a button (or a follow-up, list item, or card): its action id.
    public func press(_ action: String) {
        _ = runtime.call(id, "press", ["id": .string(action)])
        render()
    }

    /// Loads the failed queries again.
    public func retry() { _ = runtime.call(id, "retry") }

    /// The current $variables and form values.
    public var state: JSONValue {
        runtime.call(id, "snapshot").flatMap { try? JSONValue.parse($0) } ?? .object([:])
    }

    /// Waits until the program has settled: renders done and no Query or Mutation running (tests).
    public func settle(timeout: Duration = .seconds(5)) async {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        var quiet = 0
        while clock.now < deadline {
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(5))
            if renderScheduled || toolsInFlight > 0 { quiet = 0 } else { quiet += 1 }
            if quiet >= 3 { return }
        }
    }

    // MARK: Engine

    func receive(kind: String, payload: String) {
        switch kind {
        case "invalidate":
            scheduleRender()
        case "state":
            guard let state = try? JSONValue.parse(payload), state != lastState else { return }
            lastState = state
            onStateChange?(state)
        case "action":
            guard let event = try? JSONValue.parse(payload) else { return }
            let action = OpenUIActionEvent(json: event)
            Task { @MainActor [weak self] in self?.onAction?(action) }
        case "tool":
            guard let request = try? JSONValue.parse(payload), let number = request["request"]?.number, let name = request["name"]?.string else { return }
            let call = OpenUIToolCall(name: name, args: request["args"] ?? .object([:]), query: request["query"]?.bool ?? true)
            toolsInFlight += 1
            Task { @MainActor [weak self] in
                guard let self else { return }
                let outcome = await self.onTool?(call) ?? .failure(OpenUIToolError("Live data isn't available here."))
                var answer: JSONValue = ["request": .number(number)]
                switch outcome {
                case .success(let result): answer["result"] = result
                case .failure(let error): answer["error"] = .string(error.message)
                }
                _ = self.runtime.call(self.id, "resolveTool", answer)
                self.toolsInFlight -= 1
                self.scheduleRender()
            }
        default:
            break
        }
    }

    private func scheduleRender() {
        guard !renderScheduled else { return }
        renderScheduled = true
        Task { @MainActor [weak self] in
            guard let self, self.renderScheduled else { return }
            self.render()
        }
    }

    /// Evaluates the program now.
    public func render() {
        renderScheduled = false
        guard let text = runtime.call(id, "render"), let output = try? JSONValue.parse(text) else {
            engineError = runtime.lastException ?? engineError
            return
        }
        engineError = nil
        let next = output["tree"].flatMap(OpenUINode.init(json:))
        if next != tree { tree = next }
        let found = (output["errors"]?.array ?? []).compactMap { try? $0.decode(OpenUIError.self) }
        if found != errors { errors = found }
        let busy = output["loading"]?.bool ?? false
        if busy != loading { loading = busy }
        let passwords = Set((output["passwordFields"]?.array ?? []).compactMap(\.string))
        if passwords != passwordFields { passwordFields = passwords }
        onRender?()
    }
}

/// A Query or Mutation that failed: the message the program (and you) see.
public struct OpenUIToolError: Error, Hashable, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
}
