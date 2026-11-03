import Foundation

/// A long chat for measuring the transcript (`-DexLongChat`): many exchanges, each with thinking, a tool step, and a
/// Markdown answer with a list, a table, and code. "essay" in a message gets a long streamed answer.
public enum MockLongChat {
    public static let id = "s-long"

    @MainActor
    public static func seed(_ agent: MockAgent, exchanges: Int = 120, now: Double = .nowMs) {
        let start = now - Double(exchanges) * 60_000
        var entries: [EntryRecord] = []
        for index in 0..<exchanges {
            let t = start + Double(index) * 60_000
            let call = "call-long-\(index)"
            entries.append(EntryRecord(id: "long-\(index)-u", kind: "pi.user", model: [.user(UserMessage(text: "Step \(index + 1): look at module \(index) and tidy it up.", timestamp: t))]))
            entries.append(EntryRecord(id: "long-\(index)-a", kind: "pi.assistant", model: [.assistant(AssistantMessage(
                content: [.thinking("Reading module \(index) before changing anything.", redacted: false),
                          .toolCall(.init(id: call, name: "bash", arguments: ["command": .string("rg -n 'sync' src/module\(index) | head -20")]))],
                model: "cline-pass/glm-5.3", provider: "clinepass", stopReason: "toolUse", timestamp: t + 1_000, durationMs: 2_000))]))
            entries.append(EntryRecord(id: "long-\(index)-r", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(
                toolCallId: call, toolName: "bash", content: [.text((0..<12).map { "src/module\(index)/file\($0).ts:\($0 * 7): sync(state, \($0))" }.joined(separator: "\n"))],
                timestamp: t + 3_500, durationMs: 400))]))
            entries.append(EntryRecord(id: "long-\(index)-b", kind: "pi.assistant", model: [.assistant(AssistantMessage(
                content: [.text(answer(index))], model: "cline-pass/glm-5.3", provider: "clinepass", stopReason: "stop", timestamp: t + 4_000, durationMs: 5_000))]))
        }
        agent.entries[id] = entries
        agent.state.sessions.insert(SessionMeta(id: id, title: "Refactor the sync engine", model: "cline-pass/glm-5.3", thinking: "medium",
                                                createdAt: start, updatedAt: now - 30_000), at: 0)
    }

    static func answer(_ index: Int) -> String {
        """
        Module \(index) is tidy now. What changed:

        - **Renamed** `syncState` to `reconcile`, which says what it does.
        - Pulled the retry loop out into `withBackoff`, shared with module \(index + 1).
        - Removed a dead branch that handled the *old* wire format.

        | File | Lines | Change |
        | --- | --- | --- |
        | `file0.ts` | 42 | rename |
        | `file3.ts` | 17 | extract |

        ```ts
        export async function reconcile(state: State, attempt = 0): Promise<State> {
          const next = await withBackoff(() => fetchRemote(state.id), attempt)
          return merge(state, next)
        }
        ```
        """
    }

    /// A long answer, streamed word by word.
    public static let essay: String = (1...12).map { section in
        "## Part \(section)\n\nThe sync engine keeps every device's copy in step with the agent. It sends a snapshot when a socket connects, then small batches of changes, and each client folds them into what it has. **Batches** are ordered, and a gap asks for a fresh snapshot. This part looks at `reconcile` and how it handles a conflict: the newer write wins, and the older one is kept in history so nothing is lost.\n\n- One: the snapshot.\n- Two: the batches.\n- Three: the gaps."
    }.joined(separator: "\n\n")
}
