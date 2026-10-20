import Foundation

/// How a reply is laid out (the web's AssistantTurn): its work (thinking, tool calls, and notes between them) folds
/// into one activity row, and what it shows you (UI cards and the answer after the last step) stays in view.
public struct ReplyLayout: Sendable, Equatable {
    public struct Step: Sendable, Equatable, Identifiable {
        public let id: String
        public let block: ContentBlock
        /// The end of the message still streaming.
        public let live: Bool
    }

    /// Thinking, tool calls, and notes, in order (UI cards excluded).
    public let steps: [Step]
    /// UI cards and the answer text, in order.
    public let shown: [Step]
    /// Still on the work: no answer text yet.
    public let active: Bool
    public let errors: [String]
    /// A change to MEMORY.md, which is never tucked away.
    public let touchedMemory: Bool

    /// `running`: the chat's run is still on this reply (also between steps, when nothing streams).
    public init(messages: [AssistantMessage], streaming: Bool, running: Bool = false) {
        var blocks: [Step] = []
        for (m, message) in messages.enumerated() {
            for (index, block) in message.content.enumerated() {
                blocks.append(Step(id: "\(m):\(index)", block: block, live: streaming && m == messages.count - 1 && index == message.content.count - 1))
            }
        }
        let lastWork = blocks.lastIndex { Self.isWork($0.block) } ?? -1
        let work = blocks.prefix(lastWork + 1)
        steps = work.filter { !Self.isUI($0.block) }
        shown = work.filter { Self.isUI($0.block) } + blocks.dropFirst(lastWork + 1)
        let hasAnswer = shown.contains { if case .text(let text) = $0.block { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } else { false } }
        active = (streaming || running) && !hasAnswer
        errors = messages.filter { $0.stopReason == "error" }.map { $0.errorMessage ?? "The model returned an error." }
        touchedMemory = blocks.contains { step in
            guard case .toolCall(let call) = step.block else { return false }
            let path = call.arguments["path"]?.string ?? ""
            let command = call.arguments["command"]?.string ?? ""
            if call.name == "write_file" || call.name == "edit_file" { return path.range(of: #"(^|/)MEMORY\.md$"#, options: [.regularExpression, .caseInsensitive]) != nil }
            if call.name == "bash" { return command.range(of: "MEMORY.md", options: .caseInsensitive) != nil && command.range(of: #"(>|\btee\b|sed\s+-i)"#, options: .regularExpression) != nil }
            return false
        }
    }

    public static func isUI(_ block: ContentBlock) -> Bool {
        if case .toolCall(let call) = block { call.name == "render_ui" && call.arguments["code"]?.string != nil } else { false }
    }

    public static func isWork(_ block: ContentBlock) -> Bool {
        switch block {
        case .thinking(let text, _): !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .toolCall: !isUI(block)
        default: false
        }
    }

    public var toolCalls: [ContentBlock.ToolCall] { steps.compactMap(\.block.toolCall) }
    public var thoughtCount: Int { steps.filter { if case .thinking = $0.block { true } else { false } }.count }

    /// The activity row's status: what's running now, or how long it worked.
    public func status(results: [String: ToolResultMessage], startedAt: Double, endedAt: Double?, now: Double) -> (title: String, detail: String, monospaced: Bool) {
        if !active { return ("Worked for \(Self.duration((endedAt ?? now) - startedAt))", "", false) }
        if let current = toolCalls.last(where: { results[$0.id] == nil }) {
            return (Self.activity(current.name), Self.summarize(current.arguments), true)
        }
        let latest = steps.last { step in
            switch step.block {
            case .thinking(let text, _): !text.trimmingCharacters(in: .whitespaces).isEmpty
            case .text(let text): !text.trimmingCharacters(in: .whitespaces).isEmpty
            default: true
            }
        }
        switch latest?.block {
        case .thinking(let text, _): return ("Thinking", Self.latestLine(text), false)
        case .text(let text): return ("Thinking", Self.latestLine(text), false)
        case .toolCall(let call): return ("Thinking", "\(call.name) \(Self.summarize(call.arguments))", true)
        default: return ("Thinking", "", false)
        }
    }

    /// "3 tools · 2 thoughts · 1 failed · 12s".
    public func counts(results: [String: ToolResultMessage], startedAt: Double, now: Double) -> String {
        let calls = toolCalls
        let failed = calls.filter { results[$0.id]?.isError == true }.count
        var parts: [String] = []
        if !calls.isEmpty { parts.append(Self.plural(calls.count, "tool")) }
        if thoughtCount > 0 { parts.append(Self.plural(thoughtCount, "thought")) }
        if failed > 0 { parts.append("\(failed) failed") }
        if active { parts.append(Self.duration(now - startedAt)) }
        return parts.joined(separator: " · ")
    }

    public func failedCount(results: [String: ToolResultMessage]) -> Int { toolCalls.filter { results[$0.id]?.isError == true }.count }

    // MARK: Words

    public static func duration(_ milliseconds: Double) -> String {
        let seconds = max(0, Int((milliseconds / 1000).rounded()))
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }

    static func plural(_ count: Int, _ one: String) -> String { "\(count) \(count == 1 ? one : one + "s")" }

    /// The latest line of some thinking or notes, as plain text.
    public static func latestLine(_ text: String) -> String {
        let lines = text.split(separator: "\n").map { line in
            line.replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        return String((lines.last ?? "").suffix(200))
    }

    static let summaryKeys = ["command", "path", "query", "url", "prompt", "name", "id", "operation"]

    /// A tool call's arguments in a line: its command, path, query, URL, or the JSON.
    public static func summarize(_ arguments: JSONValue) -> String {
        guard let object = arguments.object else { return "" }
        for key in summaryKeys {
            if let value = object[key]?.string, !value.isEmpty { return String(value.split(separator: "\n", omittingEmptySubsequences: false).first ?? "") }
        }
        return String(arguments.jsonText.prefix(120))
    }

    /// What a tool call is doing, in words.
    public static func activity(_ name: String) -> String {
        if name.contains("skill") { return "Reading a skill" }
        if name.contains("__") { return "Using \(name.components(separatedBy: "__")[0])" }
        return activities[name] ?? "Using \(name)"
    }

    static let activities: [String: String] = [
        "bash": "Running a command", "read_file": "Reading a file", "write_file": "Writing a file", "edit_file": "Editing a file",
        "web_search": "Searching the web", "web_fetch": "Reading a page", "schedule_prompt": "Scheduling a prompt",
        "list_scheduled_prompts": "Checking the schedule", "cancel_scheduled_prompt": "Cancelling a scheduled prompt",
        "vm_exec": "Running on the VM", "vm_read_file": "Reading a file on the VM", "vm_write_file": "Writing a file on the VM",
        "vm_expose_port": "Opening a port", "vm_screenshot": "Looking at the VM's screen", "vm_computer": "Using the VM's desktop",
        "vm_stop": "Stopping the VM", "share_media": "Sharing a file from the VM", "app_operations": "Looking up app operations", "app_call": "Managing Dex",
        "load_ui_guide": "Reading the UI guide", "use_skill": "Reading a skill"
    ]
}
