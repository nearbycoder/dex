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
}

/// A skill on skills.sh (the web's `DirectorySkill`).
public struct DirectorySkill: Codable, Sendable, Hashable, Identifiable {
    /// `owner/repo/skill`.
    public var id: String
    public var source: String
    public var skillId: String
    public var name: String
    public var installs: Int

    public init(id: String, source: String, skillId: String, name: String, installs: Int) {
        self.id = id; self.source = source; self.skillId = skillId; self.name = name; self.installs = installs
    }

    enum CodingKeys: String, CodingKey { case id, source, skillId, name, installs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        source = c.value(.source, default: "")
        skillId = c.value(.skillId, default: "")
        name = c.value(.name, default: "")
        installs = c.value(.installs, default: 0)
    }

    /// "1.2M", "34K", "980".
    public static func formatInstalls(_ count: Int) -> String {
        if count >= 1_000_000 { return String(format: "%.1fM", Double(count) / 1_000_000) }
        if count >= 1_000 { return String(format: count >= 10_000 ? "%.0fK" : "%.1fK", Double(count) / 1_000) }
        return String(count)
    }

    /// The slash menu: your skills matching `query` (names starting with it first), at most six.
    public static func installed(_ skills: [SkillInfo], matching query: String) -> [SkillInfo] {
        let q = query.lowercased()
        return skills.filter { q.isEmpty || $0.id.contains(q) }
            .sorted { a, b in
                let (pa, pb) = (a.id.hasPrefix(q), b.id.hasPrefix(q))
                return pa != pb ? pa : a.id < b.id
            }
            .prefix(6).map { $0 }
    }

    /// skills.sh results you don't have yet, at most five.
    public static func notInstalled(_ results: [DirectorySkill], have skills: [SkillInfo]) -> [DirectorySkill] {
        let have = Set(skills.map { "\($0.source ?? "")/\($0.path?.split(separator: "/").last.map(String.init) ?? $0.id)" })
        return Array(results.filter { !have.contains($0.id) }.prefix(5))
    }

    /// What follows a `/` at the start of a message while the skill's name is still being typed.
    public static func slashQuery(_ text: String) -> String? {
        guard let match = text.wholeMatch(of: /\/([a-zA-Z0-9-]*)/) else { return nil }
        return String(match.1)
    }
}
