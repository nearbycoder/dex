import Foundation
import JavaScriptCore

/// The OpenUI engine (Resources/openui-engine.js, built from apps/ios/OpenUIEngine) running in one JavaScriptCore
/// context that every card shares. It gives the engine timers, logging, and Dex's formatting, and routes what the
/// engine reports to the document it's about.
@MainActor
public final class OpenUIRuntime {
    public static let shared = OpenUIRuntime()

    private let context: JSContext
    private var engine: JSValue!
    private var documents: [String: WeakDocument] = [:]
    private var timers: [Int: Task<Void, Never>] = [:]
    /// The last error the engine threw (tests read it).
    public private(set) var lastException: String?

    private struct WeakDocument { weak var document: OpenUIDocument? }

    /// Loads the engine and the component library (Resources/openui-spec.json, the web's `npm run openui:spec`).
    public init(engineSource: String? = nil, spec: String? = nil) {
        context = JSContext()!
        context.name = "Dex OpenUI"
        let host = JSValue(newObjectIn: context)!
        let emit: @convention(block) (String, String, String) -> Void = { [weak self] id, kind, payload in
            MainActor.assumeIsolated { self?.documents[id]?.document?.receive(kind: kind, payload: payload) }
        }
        let setTimer: @convention(block) (Int, Double, Bool) -> Void = { [weak self] id, ms, repeats in
            MainActor.assumeIsolated { self?.schedule(timer: id, after: ms, repeats: repeats) }
        }
        let clearTimer: @convention(block) (Int) -> Void = { [weak self] id in
            MainActor.assumeIsolated { self?.cancel(timer: id) }
        }
        let format: @convention(block) (String, Double) -> String = { kind, value in
            switch kind {
            case "ago": Format.ago(value)
            case "dateTime": Format.dateTime(value)
            case "bytes": Format.bytes(Int(value))
            default: ""
            }
        }
        let log: @convention(block) (String) -> Void = { message in
            #if DEBUG
            print("[openui]", message)
            #endif
        }
        host.setObject(emit, forKeyedSubscript: "emit" as NSString)
        host.setObject(setTimer, forKeyedSubscript: "setTimer" as NSString)
        host.setObject(clearTimer, forKeyedSubscript: "clearTimer" as NSString)
        host.setObject(format, forKeyedSubscript: "format" as NSString)
        host.setObject(log, forKeyedSubscript: "log" as NSString)
        context.setObject(host, forKeyedSubscript: "__host" as NSString)
        context.exceptionHandler = { [weak self] _, exception in
            let message = exception?.toString() ?? "unknown error"
            MainActor.assumeIsolated { self?.report(message) }
        }
        let source = engineSource ?? Self.resource("openui-engine", "js")
        context.evaluateScript(source, withSourceURL: URL(string: "dex://openui-engine.js"))
        engine = context.objectForKeyedSubscript("OpenUIEngine")
        engine.invokeMethod("configure", withArguments: [spec ?? Self.resource("openui-spec", "json")])
    }

    /// Whether the engine loaded (its script ran and configured the library).
    public var isLoaded: Bool { engine.isObject && lastException == nil }

    /// The component library's spec (Resources/openui-spec.json): components, groups, functions, actions, examples.
    public nonisolated static let spec: JSONValue = (try? JSONValue.parse(resource("openui-spec", "json"))) ?? .null

    private nonisolated static func resource(_ name: String, _ ext: String) -> String {
        guard let url = Bundle.module.url(forResource: name, withExtension: ext), let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return text
    }

    private func report(_ message: String) {
        lastException = message
        #if DEBUG
        print("[openui] exception:", message)
        #endif
    }

    // MARK: Documents

    func register(_ document: OpenUIDocument) {
        documents = documents.filter { $0.value.document != nil }
        documents[document.id] = WeakDocument(document: document)
        _ = call(document.id, "create")
    }

    func unregister(_ id: String) {
        documents[id] = nil
        _ = call(id, "dispose")
    }

    /// Runs a document method in the engine; returns its JSON result (nil if it threw).
    func call(_ id: String, _ method: String, _ payload: JSONValue = .null) -> String? {
        lastException = nil
        let result = engine.invokeMethod("call", withArguments: [id, method, payload.isNull ? "" : payload.jsonText])
        guard lastException == nil, let result, result.isString else { return nil }
        return result.toString()
    }

    // MARK: Timers

    private func schedule(timer id: Int, after milliseconds: Double, repeats: Bool) {
        timers[id]?.cancel()
        timers[id] = Task { [weak self] in
            repeat {
                try? await Task.sleep(for: .milliseconds(max(milliseconds, 1)))
                guard !Task.isCancelled, let self else { return }
                if !repeats { self.timers[id] = nil }
                self.engine.invokeMethod("fireTimer", withArguments: [id])
            } while repeats && !Task.isCancelled
        }
    }

    private func cancel(timer id: Int) {
        timers[id]?.cancel()
        timers[id] = nil
    }
}
