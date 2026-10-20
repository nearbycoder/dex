import Foundation

extension MockAgent {
    func installCoreHandlers() {
        register("modelCatalog") { [unowned self] _, _ in try JSONValue(encoding: self.catalog) }
        register("refreshModelList") { [unowned self] _, _ in ["added": [], "retired": [], "count": .number(Double(self.catalog.models.count))] }
        register("updateSettings") { [unowned self] args, _ in
            let patch = args.value(0)
            if let model = patch["defaultModel"]?.string { self.state.settings.defaultModel = model }
            if let thinking = patch["defaultThinking"]?.string { self.state.settings.defaultThinking = thinking }
            if let instructions = patch["instructions"]?.string { self.state.settings.instructions = instructions }
            if let size = patch["vmSize"]?.string { self.state.settings.vmSize = size }
            if let minutes = patch["vmMinutes"]?.int { self.state.settings.vmMinutes = minutes }
            self.publish()
            return .null
        }
    }

    func installChatHandlers() {
        register("createSession") { [unowned self] args, _ in
            let options = args.value(0)
            let agent = self.state.agent(options["agentId"]?.string)
            let now = Double.nowMs
            let session = SessionMeta(
                id: "s-\(UUID().uuidString.prefix(8).lowercased())", title: options["title"]?.string ?? "New chat",
                model: options["model"]?.string ?? agent?.model ?? self.state.settings.defaultModel,
                thinking: options["thinking"]?.string ?? agent?.thinking ?? self.state.settings.defaultThinking,
                createdAt: now, updatedAt: now, agentId: agent?.id, mcpServers: options["mcpServers"]?.array?.compactMap(\.string) ?? agent?.mcpServers ?? [],
                projectId: options["projectId"]?.string
            )
            self.state.sessions.insert(session, at: 0)
            self.entries[session.id] = []
            self.publish()
            return try JSONValue(encoding: session)
        }

        register("sendMessage") { [unowned self] args, connection in
            guard let id = args.string(0), let text = args.string(1)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return .null }
            guard let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { throw AgentError.remote("Chat not found") }
            connection.subscribed = id
            if self.running.contains(id) || !(self.queues[id]?.isEmpty ?? true), !self.heldQueues.contains(id) {
                self.queues[id, default: []].append(QueuedMessage(id: UUID().uuidString, text: text, createdAt: .nowMs))
                self.publishQueue(id)
                return .null
            }
            self.heldQueues.remove(id)
            if self.state.sessions[index].title == "New chat" { self.state.sessions[index].title = String(text.prefix(60)) }
            self.state.sessions[index].settledAt = nil
            self.state.sessions[index].snoozedUntil = nil
            self.deliver(text, to: id)
            return .null
        }

        register("abort") { [unowned self] args, _ in
            guard let id = args.string(0) else { return .null }
            if !(self.queues[id]?.isEmpty ?? true) { self.heldQueues.insert(id) }
            self.stopRun(id, stopReason: "aborted")
            self.publishQueue(id)
            return .null
        }
        register("listQueue") { [unowned self] args, _ in
            let id = args.string(0) ?? ""
            return ["items": try JSONValue(encoding: self.queues[id] ?? []), "held": .bool(self.heldQueues.contains(id))]
        }
        register("editQueued") { [unowned self] args, _ in
            guard let id = args.string(0), let item = args.string(1), let text = args.string(2) else { return .null }
            if text.trimmingCharacters(in: .whitespaces).isEmpty { throw AgentError.remote("A message can't be empty: delete it instead.") }
            if let i = self.queues[id]?.firstIndex(where: { $0.id == item }) { self.queues[id]?[i].text = text }
            self.publishQueue(id)
            return .null
        }
        register("removeQueued") { [unowned self] args, _ in
            guard let id = args.string(0), let item = args.string(1) else { return .null }
            self.queues[id]?.removeAll { $0.id == item }
            if self.queues[id]?.isEmpty ?? true { self.heldQueues.remove(id) }
            self.publishQueue(id)
            return .null
        }
        register("moveQueued") { [unowned self] args, _ in
            guard let id = args.string(0), let item = args.string(1), let to = args.value(2).int,
                  let from = self.queues[id]?.firstIndex(where: { $0.id == item }), let message = self.queues[id]?.remove(at: from) else { return .null }
            self.queues[id]?.insert(message, at: min(max(0, to), self.queues[id]?.count ?? 0))
            self.publishQueue(id)
            return .null
        }
        register("steerQueued") { [unowned self] args, _ in
            guard let id = args.string(0), let item = args.string(1), let message = self.queues[id]?.first(where: { $0.id == item }) else { return .null }
            self.queues[id]?.removeAll { $0.id == item }
            self.heldQueues.remove(id)
            self.publishQueue(id)
            if self.running.contains(id) { self.stopRun(id, stopReason: "stop") }
            self.deliver(message.text, to: id)
            return .null
        }
        register("configureSession") { [unowned self] args, _ in
            guard let id = args.string(0), let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { throw AgentError.remote("Chat not found") }
            let options = args.value(1)
            if let model = options["model"]?.string { self.state.sessions[index].model = model }
            if let thinking = options["thinking"]?.string { self.state.sessions[index].thinking = thinking }
            if let servers = options["mcpServers"]?.array { self.state.sessions[index].mcpServers = servers.compactMap(\.string) }
            self.publish()
            return .null
        }
        register("renameSession") { [unowned self] args, _ in
            guard let id = args.string(0), let title = args.string(1), let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { return .null }
            self.state.sessions[index].title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "New chat" : title
            self.publish()
            return .null
        }
        register("regenerateSessionTitle") { [unowned self] args, _ in
            guard let id = args.string(0), let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { throw AgentError.remote("Chat not found") }
            self.state.sessions[index].title = "Regenerated: " + self.state.sessions[index].title.replacingOccurrences(of: "Regenerated: ", with: "")
            self.publish()
            return .string(self.state.sessions[index].title)
        }
        register("deleteSession") { [unowned self] args, _ in
            guard let id = args.string(0) else { return .null }
            self.state.sessions.removeAll { $0.id == id }
            self.state.vms.removeAll { $0.key == id }
            self.entries[id] = nil
            self.publish()
            return .null
        }
        register("triageSession") { [unowned self] args, _ in
            guard let id = args.string(0), let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { throw AgentError.remote("Chat not found") }
            let change = args.value(1)
            if let settled = change["settled"]?.bool {
                self.state.sessions[index].settledAt = settled ? .nowMs : nil
                if settled { self.state.sessions[index].snoozedUntil = nil }
            }
            if let until = change["snoozedUntil"] {
                self.state.sessions[index].snoozedUntil = until.number
                if until.number != nil { self.state.sessions[index].settledAt = nil }
            }
            self.publish()
            return .null
        }
        register("setSessionMuted") { [unowned self] args, _ in
            guard let id = args.string(0), let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { return .null }
            self.state.sessions[index].muted = args.value(1).bool ?? false
            self.publish()
            return .null
        }
        register("transcriptImage") { _, _ in
            // A 2×2 green PNG.
            ["data": "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNk4P/PwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==", "mimeType": "image/png"]
        }
        register("storeChatSecret") { args, _ in .string(args.string(1) ?? "secret") }
        register("listArtifacts") { [unowned self] args, _ in try JSONValue(encoding: self.artifacts[args.string(0) ?? ""] ?? []) }
        register("saveArtifact") { [unowned self] args, _ in
            guard let id = args.string(0), let url = args.string(1) else { return .null }
            let name = URL(string: url)?.lastPathComponent ?? "file"
            self.artifacts[id, default: []].append(ChatArtifact(key: "\(id)/\(name)", url: "/api/media/\(id)/\(name)", name: name, kind: "image", size: 2048, source: url, createdAt: .nowMs))
            self.broadcast(self.artifactsMessage(id), sessionId: id)
            return .null
        }
    }

    // MARK: Scripted replies

    private func setBusy(_ id: String, _ busy: Bool) {
        if let index = state.sessions.firstIndex(where: { $0.id == id }) {
            state.sessions[index].busy = busy
            state.sessions[index].updatedAt = .nowMs
        }
        publish()
    }

    func stopRun(_ id: String, stopReason: String) {
        guard running.contains(id) else { return }
        running.remove(id)
        store["run:\(id)"] = .number((store["run:\(id)"]?.number ?? 0) + 1)
        events(id, [["type": "run_end", "inputs": []]])
        setBusy(id, false)
    }

    /// Plays a reply to `text`: thinking, then (by keyword) a tool step or a generated UI, then text.
    func deliver(_ text: String, to id: String) {
        let userEntry = EntryRecord(id: entryId(), kind: "pi.user", model: [.user(UserMessage(text: text, timestamp: .nowMs))])
        entries[id, default: []].append(userEntry)
        running.insert(id)
        setBusy(id, true)
        let run = store["run:\(id)"]?.number ?? 0
        events(id, [["type": "run_start", "inputs": []], ["type": "entry_appended", "entry": (try? JSONValue(encoding: userEntry)) ?? .null]])
        Task { @MainActor [weak self] in
            await self?.play(reply: text, to: id, run: run)
        }
    }

    private func play(reply prompt: String, to id: String, run: Double) async {
        func live() -> Bool { running.contains(id) && (store["run:\(id)"]?.number ?? 0) == run }
        func pause(_ steps: Int = 1) async { try? await Task.sleep(for: chunkDelay * steps) }
        let lower = prompt.lowercased()
        let start = Double.nowMs
        var blocks: [ContentBlock] = []

        await pause(4)
        guard live() else { return }
        events(id, [["type": "message_start", "message": ["role": "assistant", "content": [], "model": "cline-pass/glm-5.3", "provider": "clinepass", "stopReason": "pending", "timestamp": .number(start), "usage": [:], "api": "openai-completions"]]])
        events(id, [["type": "message_update", "usage": [:], "changes": [["type": "thinking_start", "contentIndex": 0, "block": ["type": "thinking", "thinking": ""]]]]])
        for word in ["Reading ", "the ", "request ", "and ", "planning ", "the ", "answer."] {
            await pause()
            guard live() else { return }
            events(id, [["type": "message_update", "usage": [:], "changes": [["type": "thinking_delta", "contentIndex": 0, "delta": .string(word)]]]])
        }
        blocks.append(.thinking("Reading the request and planning the answer.", redacted: false))

        if lower.contains("slow") {
            // A long run, for queue and stop tests.
            for _ in 0..<400 {
                await pause()
                guard live() else { return }
            }
        }

        let toolName: String? = lower.contains("chart") || lower.contains("ui") ? "render_ui" : lower.contains("vm") || lower.contains("test") ? "vm_exec" : lower.contains("search") ? "web_search" : nil
        if let toolName {
            let callId = "call-\(UUID().uuidString.prefix(6))"
            let arguments: JSONValue = toolName == "render_ui" ? ["title": "Weekly visits", "code": .string(MockData.chartProgram)] : toolName == "vm_exec" ? ["command": "npm test"] : ["query": .string(prompt)]
            let index = blocks.count
            events(id, [["type": "message_update", "usage": [:], "changes": [["type": "toolcall_start", "contentIndex": .number(Double(index)), "block": ["type": "toolCall", "id": .string(callId), "name": .string(toolName), "arguments": arguments]]]]])
            blocks.append(.toolCall(.init(id: callId, name: toolName, arguments: arguments)))
            let assistantEntry = EntryRecord(id: entryId(), kind: "pi.assistant", model: [.assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", usage: Usage(input: 900, output: 120, totalTokens: 1020), stopReason: "toolUse", timestamp: start, durationMs: Double.nowMs - start))])
            entries[id, default: []].append(assistantEntry)
            events(id, [["type": "message_end", "entry": (try? JSONValue(encoding: assistantEntry)) ?? .null],
                        ["type": "tool_execution_start", "toolCallId": .string(callId), "toolName": .string(toolName), "args": arguments]])
            var output = ""
            for line in (toolName == "vm_exec" ? ["> dex@1.0.0 test", "PASS src/dates.test.ts", "Tests: 42 passed"] : ["ok"]) {
                await pause(2)
                guard live() else { return }
                output += line + "\n"
                events(id, [["type": "tool_execution_update", "toolCallId": .string(callId), "toolName": .string(toolName), "output": ["trimStart": 0, "append": .string(line + "\n")]]])
            }
            let result = EntryRecord(id: entryId(), kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: callId, toolName: toolName, content: [.text(output)], timestamp: .nowMs, durationMs: 400))])
            entries[id, default: []].append(result)
            events(id, [["type": "tool_execution_end", "toolCallId": .string(callId), "toolName": .string(toolName), "entry": (try? JSONValue(encoding: result)) ?? .null]])
            blocks = []
            events(id, [["type": "message_start", "message": ["role": "assistant", "content": [], "model": "cline-pass/glm-5.3", "provider": "clinepass", "stopReason": "pending", "timestamp": .number(Double.nowMs), "usage": [:], "api": "openai-completions"]]])
        }

        let answer = toolName == "render_ui" ? "Friday had the most visits." : toolName == "vm_exec" ? "All 42 tests pass now." : "Sure. Here's a **short** answer to “\(prompt)”."
        let textIndex = blocks.count
        events(id, [["type": "message_update", "usage": [:], "changes": [["type": "text_start", "contentIndex": .number(Double(textIndex)), "block": ["type": "text", "text": ""]]]]])
        for word in answer.split(separator: " ", omittingEmptySubsequences: false) {
            await pause()
            guard live() else { return }
            events(id, [["type": "message_update", "usage": [:], "changes": [["type": "text_delta", "contentIndex": .number(Double(textIndex)), "delta": .string(word + " ")]]]])
        }
        blocks.append(.text(answer + " "))
        let final = EntryRecord(id: entryId(), kind: "pi.assistant", model: [.assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", usage: Usage(input: 1200, output: 80, totalTokens: 1280), stopReason: "stop", timestamp: start, durationMs: Double.nowMs - start))])
        entries[id, default: []].append(final)
        events(id, [["type": "message_end", "entry": (try? JSONValue(encoding: final)) ?? .null]])
        stopRun(id, stopReason: "stop")
        // The next queued message goes once a run ends (unless the queue is held).
        if !heldQueues.contains(id), let next = queues[id]?.first {
            queues[id]?.removeFirst()
            publishQueue(id)
            deliver(next.text, to: id)
        }
    }
}
