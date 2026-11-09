import Foundation

/// When to tell you a chat finished, and what to say (the server's `notifyRunEnd`, done on the device: Web Push can't
/// reach a native app). A chat's run ended when its synced `busy` goes from true to false.
public enum ChatAlerts {
    /// Chats whose run ended between two synced states.
    public static func finished(previous: [SessionMeta], current: [SessionMeta]) -> [SessionMeta] {
        let wasBusy = Set(previous.filter(\.busy).map(\.id))
        return current.filter { !$0.busy && wasBusy.contains($0.id) }
    }

    /// Whether to notify about a chat: not muted, and you aren't looking at it (in the foreground).
    public static func shouldNotify(_ session: SessionMeta, openChat: String?, appActive: Bool) -> Bool {
        if session.muted { return false }
        return !(appActive && openChat == session.id)
    }

    public struct Content: Sendable, Equatable {
        public var title: String
        public var body: String
        public var failed: Bool
    }

    /// The notification for a finished run: the chat's title and the reply's start, or the problem.
    public static func content(title: String, reply: String?, error: String?) -> Content {
        let name = String(title.prefix(80))
        if let error {
            return Content(title: "Problem in “\(name)”", body: String((error.isEmpty ? "The model request failed." : error).prefix(180)), failed: true)
        }
        let summary = summarize(reply ?? "")
        return Content(title: name, body: summary.isEmpty ? "Done." : summary, failed: false)
    }

    /// A reply as one line of plain text: no code blocks, links, or Markdown marks.
    public static func summarize(_ markdown: String) -> String {
        var text = markdown.replacing(/```[\s\S]*?```/, with: " ")
        text = text.replacing(/!?\[([^\]]*)\]\([^)]*\)/) { String($0.1) }
        text = text.replacing(/[#*_`>|~-]+/, with: " ")
        text = text.replacing(/\s+/, with: " ")
        return String(text.trimmingCharacters(in: .whitespaces).prefix(180))
    }

    /// The last reply in a transcript: its text, or its error if it failed (or the run did).
    public static func lastReply(_ transcript: TranscriptState) -> (text: String, error: String?)? {
        if let error = transcript.error { return ("", error) }
        for item in transcript.displayItems.reversed() {
            guard case .assistant(_, let messages, _, _) = item, let last = messages.last else { continue }
            if last.stopReason == "aborted" { return nil }
            let text = messages.map(\.text).joined(separator: "\n")
            return (text, last.stopReason == "error" ? (last.errorMessage ?? "The model request failed.") : nil)
        }
        return nil
    }

    /// The last assistant message in `app_read_session`'s result (`{ messages: [{ role, text }] }`).
    public static func lastReply(readSession result: JSONValue) -> String? {
        let messages = result["messages"]?.array ?? []
        return messages.last { $0["role"]?.string == "assistant" }?["text"]?.string
    }
}

/// Text a user message carries besides what you typed.
public enum UserText {
    static let uiNotesHeader = "[Done in this chat's UI since my last message]"
    static let scheduledPrefix = "[Scheduled task] "

    /// A scheduled prompt's text, when this "message" is one Dex sent itself on a schedule (`[Scheduled task] <prompt>`,
    /// from the agent's scheduled runs): shown as a note, not as something you said.
    public static func scheduledPrompt(_ text: String) -> String? {
        guard text.hasPrefix(scheduledPrefix) else { return nil }
        return String(text.dropFirst(scheduledPrefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// What you did in a chat's UI since your last message (Dex puts it in front of the next one), and the message.
    public static func splitUiNotes(_ text: String) -> (notes: [String], text: String) {
        guard text.hasPrefix(uiNotesHeader + "\n") else { return ([], text) }
        let end = text.range(of: "\n\n")
        let block = end.map { String(text[..<$0.lowerBound]) } ?? text
        let notes = block.split(separator: "\n", omittingEmptySubsequences: false).dropFirst().map { line in
            line.hasPrefix("- ") ? String(line.dropFirst(2)) : String(line)
        }
        return (notes, end.map { String(text[$0.upperBound...]) } ?? "")
    }

    static let uiActionPrefix = "[UI action] "

    /// A message a button in the chat's generated UI sent (`OpenUICard.modelMessage`), or nil for any other message.
    /// The same reading as the web's shared/ui-action.ts.
    public static func uiAction(_ text: String) -> UiAction? {
        guard text.hasPrefix(uiActionPrefix) else { return nil }
        var lines = text.dropFirst(uiActionPrefix.count).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        func jsonLine(_ prefix: String) -> (value: JSONValue, raw: String)? {
            guard lines.count > 1, let line = lines.last, line.hasPrefix(prefix) else { return nil }
            let raw = String(line.dropFirst(prefix.count))
            guard let value = try? JSONValue.parse(raw) else { return nil }
            lines.removeLast()
            return (value, raw)
        }
        let context = jsonLine("Context: ")
        let values = jsonLine("Form values: ")
        var details: [UiAction.Detail] = []
        if let values { collect(values.value, name: "", raw: values.raw, into: &details) }
        if let context, isReadable(context.value) { collect(context.value, name: "", raw: context.raw, into: &details) }
        return UiAction(message: lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), details: Array(details.prefix(UiAction.maxDetails)))
    }

    /// A message as plain words for lists: a UI action's words, anything else as it is.
    public static func withoutUiAction(_ text: String) -> String { uiAction(text)?.message ?? text }

    /// A context worth showing: a plain value or a flat set of them. Anything nested is the UI's own bookkeeping.
    private static func isReadable(_ context: JSONValue) -> Bool {
        func isPlain(_ value: JSONValue) -> Bool {
            switch value {
            case .null, .bool, .number: true
            case .string(let text): !text.contains("{") && !text.contains("[")
            default: false
            }
        }
        return isPlain(context) || (context.object?.values.allSatisfy(isPlain) ?? false)
    }

    /// The values in a form's state or a context, by field name: `{ value }` wrappers opened, nesting flattened.
    private static func collect(_ node: JSONValue, name: String, raw: String, into details: inout [UiAction.Detail]) {
        func add(_ value: String) {
            let detail = UiAction.Detail(label: label(name), value: value)
            if !value.isEmpty, !details.contains(detail) { details.append(detail) }
        }
        switch node {
        case .null: return
        case .bool, .number, .string: add(shown(node) ?? "")
        case .array(let items):
            let leaves = items.compactMap(shown)
            if leaves.count == items.count {
                add(leaves.filter { !$0.isEmpty }.joined(separator: ", "))
            } else {
                for item in items { collect(item, name: name, raw: raw, into: &details) }
            }
        case .object(let object):
            if let value = object["value"] {
                collect(value, name: name, raw: raw, into: &details)
            } else {
                for key in inSourceOrder(object.keys, raw: raw) { collect(object[key] ?? .null, name: key, raw: raw, into: &details) }
            }
        }
    }

    /// An object's keys in the order its JSON wrote them (a decoded object has none of its own).
    private static func inSourceOrder(_ keys: some Collection<String>, raw: String) -> [String] {
        func place(_ key: String) -> Int {
            raw.range(of: "\"\(key)\":").map { raw.distance(from: raw.startIndex, to: $0.lowerBound) } ?? Int.max
        }
        return keys.map { (key: $0, at: place($0)) }.sorted { ($0.at, $0.key) < ($1.at, $1.key) }.map(\.key)
    }

    /// A value as you'd read it: a stored secret's placeholder as dots, long text cut short. Nil unless it's a single value.
    private static func shown(_ value: JSONValue) -> String? {
        switch value {
        case .bool(let flag): return flag ? "Yes" : "No"
        case .number(let number):
            return number.rounded() == number && abs(number) < 1e15 ? String(Int(number)) : String(number)
        case .string(let text):
            if text.wholeMatch(of: /\{\{secret:[^}]*\}\}/) != nil { return "••••••" }
            let line = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
            return line.count > UiAction.maxDetailCharacters ? "\(line.prefix(UiAction.maxDetailCharacters - 1))…" : line
        default: return nil
        }
    }

    /// "$first_name" → "first name".
    private static func label(_ name: String) -> String {
        (name.hasPrefix("$") ? String(name.dropFirst()) : name)
            .replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }
}

/// A button pressed in a chat's generated UI: what it does in words, and what it carried (form fields, the button's context).
public struct UiAction: Hashable, Sendable {
    public struct Detail: Hashable, Sendable {
        /// The field's name, or empty.
        public let label: String
        public let value: String
    }

    public static let maxDetails = 6
    static let maxDetailCharacters = 80

    public let message: String
    public let details: [Detail]

    /// The action in a sentence, for VoiceOver: "Pressed in the UI: Deploy it. env prod, notify Yes".
    public var spoken: String {
        let carried = details.map { $0.label.isEmpty ? $0.value : "\($0.label) \($0.value)" }.joined(separator: ", ")
        return "Pressed in the UI: \(message)" + (carried.isEmpty ? "" : ". \(carried)")
    }
}

/// The slash menu's skill lookups (DirectorySkill itself is in API/Library.swift).
public extension DirectorySkill {
    /// "1.2M", "34K", "980".
    static func formatInstalls(_ count: Int) -> String {
        if count >= 1_000_000 { return String(format: "%.1fM", Double(count) / 1_000_000) }
        if count >= 1_000 { return String(format: count >= 10_000 ? "%.0fK" : "%.1fK", Double(count) / 1_000) }
        return String(count)
    }

    /// The slash menu: your skills matching `query` (names starting with it first), at most six.
    static func installed(_ skills: [SkillInfo], matching query: String) -> [SkillInfo] {
        let q = query.lowercased()
        return skills.filter { q.isEmpty || $0.id.contains(q) }
            .sorted { a, b in
                let (pa, pb) = (a.id.hasPrefix(q), b.id.hasPrefix(q))
                return pa != pb ? pa : a.id < b.id
            }
            .prefix(6).map { $0 }
    }

    /// skills.sh results you don't have yet, at most five.
    static func notInstalled(_ results: [DirectorySkill], have skills: [SkillInfo]) -> [DirectorySkill] {
        let have = Set(skills.map { "\($0.source ?? "")/\($0.path?.split(separator: "/").last.map(String.init) ?? $0.id)" })
        return Array(results.filter { !have.contains($0.id) }.prefix(5))
    }

    /// What follows a `/` at the start of a message while the skill's name is still being typed.
    static func slashQuery(_ text: String) -> String? {
        guard let match = text.wholeMatch(of: /\/([a-zA-Z0-9-]*)/) else { return nil }
        return String(match.1)
    }
}
