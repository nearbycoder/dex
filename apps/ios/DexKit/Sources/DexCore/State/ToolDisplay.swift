import Foundation

/// How a tool step shows in a reply's activity (the web's ToolCard): its symbol, and for known tools a readable
/// form of what it did (a terminal, search results, a file, an app operation) instead of raw JSON.
public enum ToolDisplay: Sendable, Equatable {
    /// bash and vm_exec: the command and its output.
    case terminal(command: String, onVm: Bool)
    case search(query: String)
    case fetch(url: String)
    /// read_file / write_file / edit_file, on the workspace or the VM.
    case file(path: String, action: FileAction, onVm: Bool)
    /// app_call: a Dex operation and its arguments.
    case appCall(operation: String, arguments: JSONValue)
    case generic

    public enum FileAction: Sendable, Equatable {
        case read
        case write(content: String)
        case edit(old: String, new: String)
    }

    public init(_ call: ContentBlock.ToolCall) {
        let args = call.arguments
        let path = args["path"]?.string ?? ""
        switch call.name {
        case "bash", "vm_exec": self = .terminal(command: args["command"]?.string ?? "", onVm: call.name == "vm_exec")
        case "web_search": self = .search(query: args["query"]?.string ?? "")
        case "web_fetch": self = .fetch(url: args["url"]?.string ?? "")
        case "read_file", "vm_read_file": self = .file(path: path, action: .read, onVm: call.name.hasPrefix("vm_"))
        case "write_file", "vm_write_file": self = .file(path: path, action: .write(content: args["content"]?.string ?? ""), onVm: call.name.hasPrefix("vm_"))
        case "edit_file": self = .file(path: path, action: .edit(old: args["old_string"]?.string ?? "", new: args["new_string"]?.string ?? ""), onVm: false)
        case "app_call": self = .appCall(operation: args["operation"]?.string ?? "", arguments: args["arguments"] ?? .object([:]))
        default: self = .generic
        }
    }

    /// An SF Symbol for a tool (the web's lucide icons).
    public static func symbol(_ name: String) -> String {
        if name.contains("skill") { return "book" }
        switch name {
        case "bash": return "terminal"
        case "read_file", "vm_read_file": return "doc.text"
        case "write_file", "edit_file", "vm_write_file": return "square.and.pencil"
        case "web_search": return "magnifyingglass"
        case "web_fetch", "vm_expose_port": return "globe"
        case "schedule_prompt", "list_scheduled_prompts", "cancel_scheduled_prompt": return "clock"
        case "vm_exec", "vm_stop": return "desktopcomputer"
        case "vm_screenshot": return "camera"
        case "vm_computer": return "cursorarrow.click.2"
        case "share_media": return "photo.on.rectangle"
        case "app_operations", "app_call": return "slider.horizontal.3"
        case "render_ui", "load_ui_guide": return "rectangle.3.group"
        default: return name.contains("__") ? "powerplug" : "wrench.and.screwdriver"
        }
    }

    /// The text of a tool result; images show as "[image]" (the web's `resultText`).
    public static func resultText(_ result: ToolResultMessage) -> String {
        result.content.compactMap { block -> String? in
            switch block {
            case .text(let text): text
            case .image: "[image]"
            default: nil
            }
        }.joined(separator: "\n")
    }

    /// An exit code at the end of a command's output ("exit code: 1", "Exit 2", "[exit 1]"), if it says.
    public static func exitCode(_ output: String) -> Int? {
        let tail = String(output.suffix(200))
        guard let match = tail.firstMatch(of: /(?i)\[?exit(?:\s+code)?[:=\s]+(-?\d+)\]?\s*$/) else { return nil }
        return Int(match.1)
    }

    public struct SearchResult: Sendable, Equatable, Identifiable {
        public var title: String
        public var url: String
        public var snippet: String
        public var id: String { url + title }
    }

    /// Search results from a web_search output: each result's title, link, and the text under it. Empty when the
    /// output isn't in a shape it recognizes (the step then shows the text as it is).
    public static func searchResults(_ output: String) -> [SearchResult] {
        var results: [SearchResult] = []
        var current: SearchResult?
        func flush() { if let current, !current.url.isEmpty { results.append(current) } }
        for raw in output.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let urlMatch = line.firstMatch(of: /https?:\/\/[^\s)>\]]+/)
            // "1. Title", "1. Title — https://…", "## Title", "Title: …"
            if let numbered = line.firstMatch(of: /^(?:\d+[.)]|#+|[-*])\s+(.+)$/) {
                flush()
                var title = String(numbered.1)
                var url = ""
                if let urlMatch {
                    url = String(urlMatch.0)
                    title = title.replacingOccurrences(of: url, with: "").trimmingCharacters(in: CharacterSet(charactersIn: " —-–:()<>[]"))
                }
                if let link = title.firstMatch(of: /^\[(.+)\]\(.*\)$/) { title = String(link.1) }
                current = SearchResult(title: title.isEmpty ? url : title, url: url, snippet: "")
            } else if var result = current {
                let text = line.replacing(/^(?i)(snippet|description|content|url):\s*/, with: "")
                if let urlMatch, result.url.isEmpty {
                    result.url = String(urlMatch.0)
                    let rest = text.replacingOccurrences(of: result.url, with: "").trimmingCharacters(in: CharacterSet(charactersIn: " —-–:()<>[]"))
                    if !rest.isEmpty { result.snippet += (result.snippet.isEmpty ? "" : " ") + rest }
                } else if urlMatch.map({ String($0.0) }) != result.url, !text.isEmpty {
                    result.snippet += (result.snippet.isEmpty ? "" : " ") + text
                }
                current = result
            }
        }
        flush()
        return results
    }
}

public extension ReplyLayout {
    /// Admin operations this reply asked for (app_call calls answered with a pending confirmation).
    func confirmations(results: [String: ToolResultMessage]) -> [(id: String, summary: String)] {
        toolCalls.compactMap { call in
            guard call.name == "app_call", let confirmation = results[call.id]?.details?["confirmation"],
                  let id = confirmation["id"]?.string else { return nil }
            return (id, confirmation["summary"]?.string ?? "")
        }
    }

    /// Media the chat shared (share_media), unless the answer already links it.
    func sharedMedia(results: [String: ToolResultMessage]) -> [(url: String, name: String)] {
        let shownText = shown.compactMap { if case .text(let text) = $0.block { text } else { nil } }.joined(separator: "\n")
        return toolCalls.compactMap { call in
            guard call.name == "share_media", let media = results[call.id]?.details?["media"], let url = media["url"]?.string,
                  !shownText.contains(url) else { return nil }
            return (url, media["name"]?.string ?? ChatMedia.fileName(url))
        }
    }
}
