import Foundation

/// A tool call running in the current round.
public struct LiveTool: Sendable, Hashable, Codable {
    public var callId: String
    public var name: String
    /// pending, running, done
    public var status: String
    public var args: JSONValue?
    public var output: String
    public var details: JSONValue?
    public init(callId: String, name: String, status: String = "running", args: JSONValue? = nil, output: String = "", details: JSONValue? = nil) {
        self.callId = callId; self.name = name; self.status = status; self.args = args; self.output = output; self.details = details
    }
}

/// One chat as the app sees it, folded from Pi's snapshot and event batches (a port of client/lib/transcript.ts).
public struct TranscriptState: Sendable, Hashable, Codable {
    public var entries: [EntryRecord] = []
    /// The assistant message being streamed, if any.
    public var streaming: AssistantMessage?
    public var tools: [String: LiveTool] = [:]
    public var running = false
    public var queued = 0
    public var retry: SnapshotEvent.Generation.Retry?
    public var error: String?
    /// The agent has sent this chat's snapshot (or it was shown from the device's copy).
    public var loaded = false
    public var artifacts: [ChatArtifact] = []
    public var savingArtifacts: [String] = []
    /// Messages waiting for the chat to finish its run, next first; held after you stopped it.
    public var queue: [QueuedMessage] = []
    public var queueHeld = false

    public init() {}

    public static let empty = TranscriptState()

    public static func from(snapshot: SnapshotEvent, previous: TranscriptState = .empty) -> TranscriptState {
        var state = TranscriptState()
        state.entries = snapshot.entries
        state.streaming = snapshot.generation?.message
        state.tools = Dictionary(snapshot.tools.map { slot in
            (slot.callId, LiveTool(callId: slot.callId, name: slot.name, status: slot.status, output: slot.output ?? "", details: slot.details))
        }, uniquingKeysWith: { _, last in last })
        state.running = snapshot.run != nil
        state.queued = snapshot.inbox.count
        state.retry = snapshot.generation?.retry
        state.loaded = true
        // Sent right after the snapshot; keep what's known until then.
        state.artifacts = previous.artifacts
        state.savingArtifacts = previous.savingArtifacts
        state.queue = previous.queue
        state.queueHeld = previous.queueHeld
        return state
    }

    private mutating func appendEntry(_ entry: EntryRecord) {
        if !entries.contains(where: { $0.id == entry.id }) { entries.append(entry) }
    }

    private mutating func updateTool(_ callId: String, name: String, _ update: (inout LiveTool) -> Void) {
        var tool = tools[callId] ?? LiveTool(callId: callId, name: name)
        update(&tool)
        tools[callId] = tool
    }

    /// Applies one agent event.
    public mutating func apply(_ event: AgentEvent) {
        switch event {
        case .snapshot(let snapshot):
            self = .from(snapshot: snapshot)
        case .runStart:
            running = true; error = nil
        case .runEnd:
            running = false; streaming = nil; tools = [:]; retry = nil
        case .messageStart(let message):
            if case .assistant(let assistant) = message { streaming = assistant }
        case .messageUpdate(let changes):
            if let current = streaming { streaming = Self.applying(changes, to: current) }
        case .messageEnd(let entry):
            streaming = nil; appendEntry(entry)
        case .entryAppended(let entry):
            appendEntry(entry)
        case .toolStart(let callId, let name, let args, let parent):
            guard parent == nil else { return }
            updateTool(callId, name: name) { $0.name = name; $0.status = "running"; $0.args = args }
        case .toolUpdate(let callId, let name, let output, let details, let parent):
            guard parent == nil else { return }
            updateTool(callId, name: name) { tool in
                switch output {
                case .set(let text): tool.output = text
                case .window(let trim, let append):
                    let dropped = min(max(trim, 0), tool.output.utf16.count)
                    tool.output = String(tool.output.utf16.dropFirst(dropped)).map { $0 + append } ?? append
                case nil: break
                }
                if let details { tool.details = details }
            }
        case .toolEnd(let callId, let name, let entry, let parent):
            guard parent == nil else { return }
            updateTool(callId, name: name) { $0.status = "done" }
            if let entry { appendEntry(entry) }
        case .inboxUpdate(let count):
            queued = count
        case .autoRetryStart(let at, let error):
            retry = .init(at: at, error: error)
        case .autoRetryEnd:
            retry = nil
        case .taskFailed(let message):
            error = message
        case .other:
            break
        }
    }

    /// Applies a Dex message about this chat.
    public mutating func apply(_ message: ServerMessage) {
        switch message {
        case .snapshot(_, let snapshot): self = .from(snapshot: snapshot, previous: self)
        case .events(_, let events): for event in events { apply(event) }
        case .error(_, let message): error = message; loaded = true
        case .queue(_, let items, let held): queue = items; queueHeld = held
        case .artifacts(_, let artifacts, let saving): self.artifacts = artifacts; savingArtifacts = saving
        default: break
        }
    }

    static func applying(_ changes: [MessageChange], to message: AssistantMessage) -> AssistantMessage {
        var next = message
        func ensure(_ index: Int) {
            while next.content.count <= index { next.content.append(.text("")) }
        }
        for change in changes {
            switch change {
            case .message(let replacement):
                return replacement
            case .start(let index, let block), .block(let index, let block):
                ensure(index); next.content[index] = block
            case .textDelta(let index, let delta):
                if next.content.indices.contains(index), case .text(let text) = next.content[index] { next.content[index] = .text(text + delta) }
            case .thinkingDelta(let index, let delta):
                if next.content.indices.contains(index), case .thinking(let text, let redacted) = next.content[index] {
                    next.content[index] = .thinking(text + delta, redacted: redacted)
                }
            case .toolCallDelta(let index, let path, let delta):
                if next.content.indices.contains(index), case .toolCall(var call) = next.content[index] {
                    if call.arguments.object == nil { call.arguments = .object([:]) }
                    call.arguments.append(delta, at: path[...])
                    next.content[index] = .toolCall(call)
                }
            case .other:
                break
            }
        }
        return next
    }
}

// MARK: - Reading entries

/// What the chat screen shows, in order.
public enum DisplayItem: Sendable, Hashable, Identifiable {
    case user(id: String, text: String, images: Int)
    /// One reply: the assistant messages between two user messages, the last one possibly still streaming.
    case assistant(id: String, messages: [AssistantMessage], streaming: Bool, endedAt: Double?)
    case divider(id: String, label: String)

    public var id: String {
        switch self {
        case .user(let id, _, _), .assistant(let id, _, _, _), .divider(let id, _): id
        }
    }
}

public extension TranscriptState {
    /// Tool results by call id.
    var toolResults: [String: ToolResultMessage] {
        var results: [String: ToolResultMessage] = [:]
        for entry in entries {
            for message in entry.model ?? [] {
                if case .toolResult(let result) = message { results[result.toolCallId] = result }
            }
        }
        return results
    }

    var displayItems: [DisplayItem] {
        var items: [DisplayItem] = []
        // Consecutive assistant messages (tool results don't interrupt them) are one reply.
        func addAssistant(_ id: String, _ message: AssistantMessage, streaming: Bool) {
            let ended: Double? = streaming ? nil : message.timestamp + (message.durationMs ?? 0)
            if case .assistant(let lastId, let messages, _, let lastEnded) = items.last {
                items[items.count - 1] = .assistant(id: lastId, messages: messages + [message], streaming: streaming, endedAt: ended ?? lastEnded)
            } else {
                items.append(.assistant(id: id, messages: [message], streaming: streaming, endedAt: ended))
            }
        }
        for entry in entries {
            if entry.kind == "pi.reset" { items.append(.divider(id: entry.id, label: "Context reset")) }
            else if entry.kind == "pi.compaction" { items.append(.divider(id: entry.id, label: "Earlier messages summarized")) }
            // A compaction's summary (and a reset's handoff) is a user message for the model, not something you said.
            if entry.kind == "pi.compaction" || entry.kind == "pi.reset" { continue }
            for (index, message) in (entry.model ?? []).enumerated() {
                let id = "\(entry.id):\(index)"
                switch message {
                case .user(let user): items.append(.user(id: id, text: user.text, images: user.images))
                case .assistant(let assistant): addAssistant(id, assistant, streaming: false)
                case .toolResult(let result):
                    if case .assistant(let lastId, let messages, let streaming, let ended) = items.last {
                        items[items.count - 1] = .assistant(id: lastId, messages: messages, streaming: streaming, endedAt: max(ended ?? 0, result.timestamp))
                    }
                default: break
                }
            }
        }
        if let streaming { addAssistant("streaming", streaming, streaming: true) }
        return items
    }
}
