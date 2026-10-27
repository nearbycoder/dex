import Foundation

// Pi Durable's transcript records and agent events (@earendil-works/pi-durable and pi-ai), as much of them as a chat
// screen reads. Unknown kinds decode to `.other` rather than failing, so a newer agent never breaks an older app.

public struct Usage: Codable, Sendable, Hashable {
    public var input: Double
    public var output: Double
    public var cacheRead: Double
    public var cacheWrite: Double
    public var totalTokens: Double
    public init(input: Double = 0, output: Double = 0, cacheRead: Double = 0, cacheWrite: Double = 0, totalTokens: Double = 0) {
        self.input = input; self.output = output; self.cacheRead = cacheRead; self.cacheWrite = cacheWrite; self.totalTokens = totalTokens
    }
    enum CodingKeys: String, CodingKey { case input, output, cacheRead, cacheWrite, totalTokens }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        input = c.value(.input, default: 0); output = c.value(.output, default: 0); cacheRead = c.value(.cacheRead, default: 0)
        cacheWrite = c.value(.cacheWrite, default: 0); totalTokens = c.value(.totalTokens, default: 0)
    }
}

/// One block of an assistant message: text, thinking, or a tool call.
public enum ContentBlock: Codable, Sendable, Hashable {
    case text(String)
    case thinking(String, redacted: Bool)
    case toolCall(ToolCall)
    /// `ref` is set when the agent left the bytes out (`transcriptImage(sessionId, ref)` loads them).
    case image(data: String, mimeType: String, ref: String?)
    case other(JSONValue)

    public struct ToolCall: Codable, Sendable, Hashable {
        public var id: String
        public var name: String
        public var arguments: JSONValue
        public var argumentsError: String?
        public init(id: String, name: String, arguments: JSONValue = .object([:]), argumentsError: String? = nil) {
            self.id = id; self.name = name; self.arguments = arguments; self.argumentsError = argumentsError
        }
    }

    enum CodingKeys: String, CodingKey { case type, text, thinking, redacted, id, name, arguments, argumentsError, data, mimeType, ref }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch c.value(.type, default: "") {
        case "text": self = .text(c.value(.text, default: ""))
        case "thinking": self = .thinking(c.value(.thinking, default: ""), redacted: c.value(.redacted, default: false))
        case "toolCall":
            self = .toolCall(ToolCall(id: c.value(.id, default: ""), name: c.value(.name, default: "tool"),
                                      arguments: c.value(.arguments, default: .object([:])), argumentsError: c.value(.argumentsError, default: nil)))
        case "image": self = .image(data: c.value(.data, default: ""), mimeType: c.value(.mimeType, default: "image/png"), ref: c.value(.ref, default: nil))
        default: self = .other((try? JSONValue(from: decoder)) ?? .null)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text): try c.encode("text", forKey: .type); try c.encode(text, forKey: .text)
        case .thinking(let thinking, let redacted):
            try c.encode("thinking", forKey: .type); try c.encode(thinking, forKey: .thinking)
            if redacted { try c.encode(true, forKey: .redacted) }
        case .toolCall(let call):
            try c.encode("toolCall", forKey: .type); try c.encode(call.id, forKey: .id); try c.encode(call.name, forKey: .name)
            try c.encode(call.arguments, forKey: .arguments); try c.encodeIfPresent(call.argumentsError, forKey: .argumentsError)
        case .image(let data, let mimeType, let ref):
            try c.encode("image", forKey: .type); try c.encode(data, forKey: .data); try c.encode(mimeType, forKey: .mimeType); try c.encodeIfPresent(ref, forKey: .ref)
        case .other(let value): try value.encode(to: encoder)
        }
    }

    public var toolCall: ToolCall? { if case .toolCall(let call) = self { call } else { nil } }
}

public struct AssistantMessage: Codable, Sendable, Hashable {
    public var content: [ContentBlock]
    public var model: String
    public var provider: String
    public var usage: Usage
    /// pending, stop, length, toolUse, error, aborted, deferred
    public var stopReason: String
    public var errorMessage: String?
    public var timestamp: Double
    public var durationMs: Double?

    public init(content: [ContentBlock] = [], model: String = "", provider: String = "", usage: Usage = .init(), stopReason: String = "pending", errorMessage: String? = nil, timestamp: Double = 0, durationMs: Double? = nil) {
        self.content = content; self.model = model; self.provider = provider; self.usage = usage; self.stopReason = stopReason
        self.errorMessage = errorMessage; self.timestamp = timestamp; self.durationMs = durationMs
    }

    enum CodingKeys: String, CodingKey { case role, content, model, provider, usage, stopReason, errorMessage, timestamp, durationMs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        content = c.value(.content, default: [])
        model = c.value(.model, default: "")
        provider = c.value(.provider, default: "")
        usage = c.value(.usage, default: .init())
        stopReason = c.value(.stopReason, default: "stop")
        errorMessage = c.value(.errorMessage, default: nil)
        timestamp = c.value(.timestamp, default: 0)
        durationMs = c.value(.durationMs, default: nil)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("assistant", forKey: .role); try c.encode(content, forKey: .content); try c.encode(model, forKey: .model)
        try c.encode(provider, forKey: .provider); try c.encode(usage, forKey: .usage); try c.encode(stopReason, forKey: .stopReason)
        try c.encodeIfPresent(errorMessage, forKey: .errorMessage); try c.encode(timestamp, forKey: .timestamp); try c.encodeIfPresent(durationMs, forKey: .durationMs)
    }

    /// All text blocks joined.
    public var text: String { content.compactMap { if case .text(let text) = $0 { text } else { nil } }.joined() }
    public var toolCalls: [ContentBlock.ToolCall] { content.compactMap(\.toolCall) }
}

/// An image in a message: inline `data`, or (when the agent left a large one out) a `ref` to load it by.
public struct ImagePart: Sendable, Hashable {
    public var data: String
    public var mimeType: String
    public var ref: String?
    public init(data: String, mimeType: String, ref: String? = nil) { self.data = data; self.mimeType = mimeType; self.ref = ref }
}

public struct UserMessage: Codable, Sendable, Hashable {
    /// Its text parts, joined (attachment tags included; see splitAttachments).
    public var text: String
    public var imageParts: [ImagePart]
    public var timestamp: Double
    public var images: Int { imageParts.count }

    public init(text: String, imageParts: [ImagePart] = [], timestamp: Double = 0) { self.text = text; self.imageParts = imageParts; self.timestamp = timestamp }

    enum CodingKeys: String, CodingKey { case role, content, timestamp }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        timestamp = c.value(.timestamp, default: 0)
        if let text = try? c.decode(String.self, forKey: .content) {
            self.text = text; imageParts = []
        } else {
            let parts: [ContentBlock] = c.value(.content, default: [])
            text = parts.compactMap { if case .text(let text) = $0 { text } else { nil } }.joined(separator: "\n")
            imageParts = parts.compactMap { if case .image(let data, let mimeType, let ref) = $0 { ImagePart(data: data, mimeType: mimeType, ref: ref) } else { nil } }
        }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("user", forKey: .role); try c.encode(timestamp, forKey: .timestamp)
        if imageParts.isEmpty {
            try c.encode(text, forKey: .content)
        } else {
            try c.encode([ContentBlock.text(text)] + imageParts.map { ContentBlock.image(data: $0.data, mimeType: $0.mimeType, ref: $0.ref) }, forKey: .content)
        }
    }
}

public struct ToolResultMessage: Codable, Sendable, Hashable {
    public var toolCallId: String
    public var toolName: String
    public var content: [ContentBlock]
    public var details: JSONValue?
    public var isError: Bool
    public var timestamp: Double
    public var durationMs: Double?

    public init(toolCallId: String, toolName: String, content: [ContentBlock] = [], details: JSONValue? = nil, isError: Bool = false, timestamp: Double = 0, durationMs: Double? = nil) {
        self.toolCallId = toolCallId; self.toolName = toolName; self.content = content; self.details = details; self.isError = isError
        self.timestamp = timestamp; self.durationMs = durationMs
    }

    enum CodingKeys: String, CodingKey { case role, toolCallId, toolName, content, details, isError, timestamp, durationMs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        toolCallId = c.value(.toolCallId, default: "")
        toolName = c.value(.toolName, default: "")
        content = c.value(.content, default: [])
        details = c.value(.details, default: nil)
        isError = c.value(.isError, default: false)
        timestamp = c.value(.timestamp, default: 0)
        durationMs = c.value(.durationMs, default: nil)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("toolResult", forKey: .role); try c.encode(toolCallId, forKey: .toolCallId); try c.encode(toolName, forKey: .toolName)
        try c.encode(content, forKey: .content); try c.encodeIfPresent(details, forKey: .details); try c.encode(isError, forKey: .isError)
        try c.encode(timestamp, forKey: .timestamp); try c.encodeIfPresent(durationMs, forKey: .durationMs)
    }

    /// Text output, joined.
    public var text: String { content.compactMap { if case .text(let text) = $0 { text } else { nil } }.joined(separator: "\n") }
    /// Images in the result: inline data, or a `ref` to load (snapshots leave large ones out; see `transcriptImage`).
    public var images: [(data: String, mimeType: String, ref: String?)] { content.compactMap { if case .image(let data, let type, let ref) = $0 { (data, type, ref) } else { nil } } }
}

public enum PiMessage: Codable, Sendable, Hashable {
    case user(UserMessage)
    case assistant(AssistantMessage)
    case toolResult(ToolResultMessage)
    case system
    case other

    enum CodingKeys: String, CodingKey { case role }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch c.value(.role, default: "") {
        case "user": self = .user(try UserMessage(from: decoder))
        case "assistant": self = .assistant(try AssistantMessage(from: decoder))
        case "toolResult": self = .toolResult(try ToolResultMessage(from: decoder))
        case "system": self = .system
        default: self = .other
        }
    }
    public func encode(to encoder: Encoder) throws {
        switch self {
        case .user(let message): try message.encode(to: encoder)
        case .assistant(let message): try message.encode(to: encoder)
        case .toolResult(let message): try message.encode(to: encoder)
        case .system: var c = encoder.container(keyedBy: CodingKeys.self); try c.encode("system", forKey: .role)
        case .other: var c = encoder.container(keyedBy: CodingKeys.self); try c.encode("other", forKey: .role)
        }
    }
}

/// One record in a chat's transcript.
public struct EntryRecord: Codable, Sendable, Hashable, Identifiable {
    /// Entry ids are numbers or strings depending on the storage; kept as text.
    public var id: String
    public var kind: String
    public var model: [PiMessage]?
    public var data: JSONValue?

    public init(id: String, kind: String, model: [PiMessage]? = nil, data: JSONValue? = nil) { self.id = id; self.kind = kind; self.model = model; self.data = data }

    enum CodingKeys: String, CodingKey { case id, kind, model, data }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let number = try? c.decode(Double.self, forKey: .id) {
            id = number == number.rounded() ? String(Int64(number)) : String(number)
        } else {
            id = c.value(.id, default: UUID().uuidString)
        }
        kind = c.value(.kind, default: "")
        model = c.value(.model, default: nil)
        data = c.value(.data, default: nil)
    }
}

public struct ToolSlot: Codable, Sendable, Hashable {
    public var callId: String
    public var name: String
    /// pending, running, done
    public var status: String
    public var output: String?
    public var details: JSONValue?
}

public struct SnapshotEvent: Codable, Sendable, Hashable {
    public struct Generation: Codable, Sendable, Hashable {
        public struct Retry: Codable, Sendable, Hashable { public var at: Double; public var error: String }
        public var attempt: Int?
        public var message: AssistantMessage?
        public var retry: Retry?
    }
    public struct Run: Codable, Sendable, Hashable { public var inputs: [String]? }

    public var entries: [EntryRecord]
    public var run: Run?
    public var generation: Generation?
    public var tools: [ToolSlot]
    public var inbox: [JSONValue]

    public init(entries: [EntryRecord] = [], run: Run? = nil, generation: Generation? = nil, tools: [ToolSlot] = [], inbox: [JSONValue] = []) {
        self.entries = entries; self.run = run; self.generation = generation; self.tools = tools; self.inbox = inbox
    }

    enum CodingKeys: String, CodingKey { case entries, run, generation, tools, inbox }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = c.value(.entries, default: [])
        run = c.value(.run, default: nil)
        generation = c.value(.generation, default: nil)
        tools = c.value(.tools, default: [])
        inbox = c.value(.inbox, default: [])
    }
}

/// One change to the in-flight assistant message.
public enum MessageChange: Codable, Sendable, Hashable {
    case start(contentIndex: Int, block: ContentBlock)
    case textDelta(contentIndex: Int, delta: String)
    case thinkingDelta(contentIndex: Int, delta: String)
    case toolCallDelta(contentIndex: Int, path: [PathKey], delta: String)
    case block(contentIndex: Int, block: ContentBlock)
    case message(AssistantMessage)
    case other

    enum CodingKeys: String, CodingKey { case type, contentIndex, block, delta, path, message }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let index: Int = c.value(.contentIndex, default: 0)
        switch c.value(.type, default: "") {
        case "text_start", "thinking_start", "toolcall_start": self = .start(contentIndex: index, block: try c.decode(ContentBlock.self, forKey: .block))
        case "text_delta": self = .textDelta(contentIndex: index, delta: c.value(.delta, default: ""))
        case "thinking_delta": self = .thinkingDelta(contentIndex: index, delta: c.value(.delta, default: ""))
        case "toolcall_delta": self = .toolCallDelta(contentIndex: index, path: c.value(.path, default: []), delta: c.value(.delta, default: ""))
        case "block": self = .block(contentIndex: index, block: try c.decode(ContentBlock.self, forKey: .block))
        case "message": self = .message(try c.decode(AssistantMessage.self, forKey: .message))
        default: self = .other
        }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .start(let index, let block):
            let type = switch block { case .thinking: "thinking_start"; case .toolCall: "toolcall_start"; default: "text_start" }
            try c.encode(type, forKey: .type); try c.encode(index, forKey: .contentIndex); try c.encode(block, forKey: .block)
        case .textDelta(let index, let delta): try c.encode("text_delta", forKey: .type); try c.encode(index, forKey: .contentIndex); try c.encode(delta, forKey: .delta)
        case .thinkingDelta(let index, let delta): try c.encode("thinking_delta", forKey: .type); try c.encode(index, forKey: .contentIndex); try c.encode(delta, forKey: .delta)
        case .toolCallDelta(let index, let path, let delta):
            try c.encode("toolcall_delta", forKey: .type); try c.encode(index, forKey: .contentIndex); try c.encode(path, forKey: .path); try c.encode(delta, forKey: .delta)
        case .block(let index, let block): try c.encode("block", forKey: .type); try c.encode(index, forKey: .contentIndex); try c.encode(block, forKey: .block)
        case .message(let message): try c.encode("message", forKey: .type); try c.encode(message, forKey: .message)
        case .other: try c.encode("other", forKey: .type)
        }
    }
}

public enum ToolOutputUpdate: Sendable, Hashable {
    case set(String)
    case window(trimStart: Int, append: String)
}

/// Pi's agent events, as the agent streams them in `dex.events` batches.
public enum AgentEvent: Codable, Sendable, Hashable {
    case snapshot(SnapshotEvent)
    case runStart
    case runEnd
    case messageStart(PiMessage)
    case messageUpdate([MessageChange])
    case messageEnd(EntryRecord)
    case entryAppended(EntryRecord)
    case toolStart(callId: String, name: String, args: JSONValue, parent: String?)
    case toolUpdate(callId: String, name: String, output: ToolOutputUpdate?, details: JSONValue?, parent: String?)
    case toolEnd(callId: String, name: String, entry: EntryRecord?, parent: String?)
    case inboxUpdate(count: Int)
    case autoRetryStart(at: Double, error: String)
    case autoRetryEnd
    case taskFailed(String)
    case other(String)

    enum CodingKeys: String, CodingKey { case type, message, changes, entry, toolCallId, toolName, args, output, details, parentToolCallId, items, at, errorMessage }
    enum OutputKeys: String, CodingKey { case set, trimStart, append }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type: String = c.value(.type, default: "")
        let callId: String = c.value(.toolCallId, default: "")
        let name: String = c.value(.toolName, default: "tool")
        let parent: String? = c.value(.parentToolCallId, default: nil)
        switch type {
        case "snapshot": self = .snapshot(try SnapshotEvent(from: decoder))
        case "run_start": self = .runStart
        case "run_end": self = .runEnd
        case "message_start": self = .messageStart(try c.decode(PiMessage.self, forKey: .message))
        case "message_update": self = .messageUpdate(c.value(.changes, default: []))
        case "message_end": self = .messageEnd(try c.decode(EntryRecord.self, forKey: .entry))
        case "entry_appended": self = .entryAppended(try c.decode(EntryRecord.self, forKey: .entry))
        case "tool_execution_start": self = .toolStart(callId: callId, name: name, args: c.value(.args, default: .object([:])), parent: parent)
        case "tool_execution_update":
            var output: ToolOutputUpdate?
            if let o = try? c.nestedContainer(keyedBy: OutputKeys.self, forKey: .output) {
                if let set = try? o.decode(String.self, forKey: .set) { output = .set(set) } else {
                    output = .window(trimStart: o.value(.trimStart, default: 0), append: o.value(.append, default: ""))
                }
            }
            self = .toolUpdate(callId: callId, name: name, output: output, details: c.value(.details, default: nil), parent: parent)
        case "tool_execution_end": self = .toolEnd(callId: callId, name: name, entry: c.value(.entry, default: nil), parent: parent)
        case "inbox_update": self = .inboxUpdate(count: (c.value(.items, default: [JSONValue]())).count)
        case "auto_retry_start": self = .autoRetryStart(at: c.value(.at, default: 0), error: c.value(.errorMessage, default: ""))
        case "auto_retry_end": self = .autoRetryEnd
        case "task_failed": self = .taskFailed(c.value(.message, default: "Something went wrong"))
        default: self = .other(type)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .snapshot(let snapshot):
            try snapshot.encode(to: encoder)
            try c.encode("snapshot", forKey: .type)
        case .runStart: try c.encode("run_start", forKey: .type)
        case .runEnd: try c.encode("run_end", forKey: .type)
        case .messageStart(let message): try c.encode("message_start", forKey: .type); try c.encode(message, forKey: .message)
        case .messageUpdate(let changes): try c.encode("message_update", forKey: .type); try c.encode(changes, forKey: .changes)
        case .messageEnd(let entry): try c.encode("message_end", forKey: .type); try c.encode(entry, forKey: .entry)
        case .entryAppended(let entry): try c.encode("entry_appended", forKey: .type); try c.encode(entry, forKey: .entry)
        case .toolStart(let callId, let name, let args, let parent):
            try c.encode("tool_execution_start", forKey: .type); try c.encode(callId, forKey: .toolCallId); try c.encode(name, forKey: .toolName)
            try c.encode(args, forKey: .args); try c.encodeIfPresent(parent, forKey: .parentToolCallId)
        case .toolUpdate(let callId, let name, let output, let details, let parent):
            try c.encode("tool_execution_update", forKey: .type); try c.encode(callId, forKey: .toolCallId); try c.encode(name, forKey: .toolName)
            switch output {
            case .set(let text): var o = c.nestedContainer(keyedBy: OutputKeys.self, forKey: .output); try o.encode(text, forKey: .set)
            case .window(let trim, let append):
                var o = c.nestedContainer(keyedBy: OutputKeys.self, forKey: .output); try o.encode(trim, forKey: .trimStart); try o.encode(append, forKey: .append)
            case nil: break
            }
            try c.encodeIfPresent(details, forKey: .details); try c.encodeIfPresent(parent, forKey: .parentToolCallId)
        case .toolEnd(let callId, let name, let entry, let parent):
            try c.encode("tool_execution_end", forKey: .type); try c.encode(callId, forKey: .toolCallId); try c.encode(name, forKey: .toolName)
            try c.encodeIfPresent(entry, forKey: .entry); try c.encodeIfPresent(parent, forKey: .parentToolCallId)
        case .inboxUpdate(let count): try c.encode("inbox_update", forKey: .type); try c.encode(Array(repeating: JSONValue.object([:]), count: count), forKey: .items)
        case .autoRetryStart(let at, let error): try c.encode("auto_retry_start", forKey: .type); try c.encode(at, forKey: .at); try c.encode(error, forKey: .errorMessage)
        case .autoRetryEnd: try c.encode("auto_retry_end", forKey: .type)
        case .taskFailed(let message): try c.encode("task_failed", forKey: .type); try c.encode(message, forKey: .message)
        case .other(let type): try c.encode(type, forKey: .type)
        }
    }
}
