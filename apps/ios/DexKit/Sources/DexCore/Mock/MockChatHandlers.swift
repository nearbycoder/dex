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
        installChatFixtures()
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
            let files = (args.value(2).array ?? []).map(ChatAttachment.init(json:))
            guard let id = args.string(0), let text = args.string(1)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty || !files.isEmpty else { return .null }
            guard let index = self.state.sessions.firstIndex(where: { $0.id == id }) else { throw AgentError.remote("Chat not found") }
            connection.subscribed = id
            if self.running.contains(id) || !(self.queues[id]?.isEmpty ?? true), !self.heldQueues.contains(id) {
                let item = QueuedMessage(id: UUID().uuidString, text: text, createdAt: .nowMs, attachments: files.map { AttachedFile(name: $0.name, mimeType: $0.mimeType) })
                self.queues[id, default: []].append(item)
                if !files.isEmpty { self.queuedFiles[item.id] = files }
                self.publishQueue(id)
                return .null
            }
            self.heldQueues.remove(id)
            let title = text.isEmpty ? attachmentSummary(files.map(\.name)) : text
            if self.state.sessions[index].title == "New chat" { self.state.sessions[index].title = String(title.prefix(60)) }
            self.state.sessions[index].settledAt = nil
            self.state.sessions[index].snoozedUntil = nil
            self.deliver(text, files: files, to: id)
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
            var queue = self.queues[id] ?? []
            queue.insert(message, at: min(max(0, to), queue.count))
            self.queues[id] = queue
            self.publishQueue(id)
            return .null
        }
        register("steerQueued") { [unowned self] args, _ in
            guard let id = args.string(0), let item = args.string(1), let message = self.queues[id]?.first(where: { $0.id == item }) else { return .null }
            self.queues[id]?.removeAll { $0.id == item }
            self.heldQueues.remove(id)
            self.publishQueue(id)
            if self.running.contains(id) { self.stopRun(id, stopReason: "stop") }
            self.deliver(message.text, files: self.queuedFiles.removeValue(forKey: message.id) ?? [], to: id)
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
            ["data": .string(Self.desktopPNG), "mimeType": "image/png"]
        }
        register("storeChatSecret") { args, _ in .string(args.string(1) ?? "secret") }
        register("listArtifacts") { [unowned self] args, _ in try JSONValue(encoding: self.artifacts[args.string(0) ?? ""] ?? []) }
        register("saveArtifact") { [unowned self] args, _ in
            guard let id = args.string(0), let url = args.string(1) else { return .null }
            let source = ChatMedia.vmSource(url)?.source ?? url
            self.broadcast(["type": "dex.artifacts", "sessionId": .string(id), "artifacts": (try? JSONValue(encoding: self.artifacts[id] ?? [])) ?? [], "saving": [.string(source)]], sessionId: id)
            try? await Task.sleep(for: self.chunkDelay * 8)
            if url.contains("fail-save") {
                self.broadcast(self.artifactsMessage(id), sessionId: id)
                throw AgentError.remote("The VM didn't answer. Is it running?")
            }
            let name = ChatMedia.fileName(url)
            let artifact = ChatArtifact(key: "\(id)/\(name)", url: "/api/media/\(id)/\(name)", name: name, kind: ChatMedia.kind(of: name)?.rawValue ?? "image", size: 2048, source: source, createdAt: .nowMs)
            self.artifacts[id, default: []].append(artifact)
            self.broadcast(self.artifactsMessage(id), sessionId: id)
            return ["url": .string(artifact.url), "name": .string(name), "kind": .string(artifact.kind), "size": 2048]
        }
    }

    // skills.sh, installs, and pending-action answers are the Library and Settings mocks' (they install later).

    public static let toolsChatId = "s-tools"
    public static let mediaChatId = "s-media"
    public static let confirmChatId = "s-confirm"

    /// Chats that show every kind of step: tools with readable output, a screenshot loaded on demand, a failed
    /// tool, a memory edit, media (stored, on the VM, elsewhere), and an admin operation waiting for you. They're
    /// a day old, so they sit below the main sample chats.
    private func installChatFixtures() {
        let now = Double.nowMs
        let hour = 3_600_000.0
        func assistant(_ blocks: [ContentBlock], at: Double, stop: String = "toolUse", duration: Double = 2_000) -> PiMessage {
            .assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", usage: Usage(input: 900, output: 200, totalTokens: 1100), stopReason: stop, timestamp: at, durationMs: duration))
        }
        func result(_ id: String, _ name: String, _ content: [ContentBlock], error: Bool = false, details: JSONValue? = nil, at: Double) -> EntryRecord {
            EntryRecord(id: "\(id)r", kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: id, toolName: name, content: content, details: details, isError: error, timestamp: at, durationMs: 300))])
        }

        let t = now - 30 * hour
        state.sessions.append(SessionMeta(id: Self.toolsChatId, title: "Check the build server", model: "cline-pass/kimi-k3", thinking: "high", createdAt: t, updatedAt: t + 60_000))
        entries[Self.toolsChatId] = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Is the build server healthy? Remember that I prefer short answers.", timestamp: t))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                .thinking("Check the disk first, then the dashboard.", redacted: false),
                .toolCall(.init(id: "t-bash", name: "bash", arguments: ["command": "df -h /"])),
                .toolCall(.init(id: "t-search", name: "web_search", arguments: ["query": "build server disk full fix"])),
                .toolCall(.init(id: "t-read", name: "read_file", arguments: ["path": "notes/build.md"])),
                .toolCall(.init(id: "t-shot", name: "vm_screenshot", arguments: .object([:]))),
                .toolCall(.init(id: "t-fail", name: "bash", arguments: ["command": "systemctl status buildd"])),
                .toolCall(.init(id: "t-mem", name: "edit_file", arguments: ["path": "MEMORY.md", "old_string": "- Likes detail", "new_string": "- Prefers short answers"]))
            ], at: t + 1_000)]),
            result("t-bash", "bash", [.text("Filesystem  Size  Used Avail Use%\n/dev/sda1    80G   41G   39G  52%")], at: t + 3_000),
            result("t-search", "web_search", [.text("1. Fixing a full disk — https://docs.example.com/disk\nClear old artifacts first.\n2. Build server tips — https://blog.example.com/tips\nKeep 20% free.")], at: t + 5_000),
            result("t-read", "read_file", [.text("# Build server\nRuns on box-12. Restart with `make restart`.")], at: t + 6_000),
            result("t-shot", "vm_screenshot", [.text("Screenshot of the VM's screen."), .image(data: "", mimeType: "image/png", ref: "t-shotr:0:1")], at: t + 8_000),
            result("t-fail", "bash", [.text("systemctl: command not found\nexit code: 127")], error: true, at: t + 9_000),
            result("t-mem", "edit_file", [.text("Edited MEMORY.md")], at: t + 10_000),
            EntryRecord(id: "3", kind: "pi.assistant", model: [assistant([.text("Healthy: the disk is half full and the dashboard is green.")], at: t + 11_000, stop: "stop")])
        ]

        let m = now - 32 * hour
        let vmLink = "https://box-5678-8080.on.boat.dev/out/clip.mp4?token=abc"
        state.sessions.append(SessionMeta(id: Self.mediaChatId, title: "Make a demo video", model: "cline-pass/glm-5.3", thinking: "low", createdAt: m, updatedAt: m + 60_000))
        entries[Self.mediaChatId] = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Record a short demo and chart the results.", timestamp: m))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                .toolCall(.init(id: "m-share", name: "share_media", arguments: ["path": "~/work/demo.mp4"]))
            ], at: m + 1_000)]),
            result("m-share", "share_media", [.text("Shared demo.mp4")], details: ["media": ["url": .string("/api/media/\(Self.mediaChatId)/demo.mp4"), "name": "demo.mp4", "kind": "video"]], at: m + 2_000),
            EntryRecord(id: "3", kind: "pi.assistant", model: [assistant([.text("""
            Here's the chart:

            ![Results chart](/api/media/\(Self.mediaChatId)/chart.png)

            The raw clip is on the VM: [clip.mp4](\(vmLink))

            And the talk it's based on: https://www.youtube.com/watch?v=dQw4w9WgXcQ
            """)], at: m + 3_000, stop: "stop")])
        ]
        artifacts[Self.mediaChatId] = [
            ChatArtifact(key: "\(Self.mediaChatId)/demo.mp4", url: "/api/media/\(Self.mediaChatId)/demo.mp4", name: "demo.mp4", kind: "video", size: 4_200_000, createdAt: m + 2_000),
            ChatArtifact(key: "\(Self.mediaChatId)/chart.png", url: "/api/media/\(Self.mediaChatId)/chart.png", name: "chart.png", kind: "image", size: 40_000, createdAt: m + 2_500)
        ]

        let c = now - 34 * hour
        state.sessions.append(SessionMeta(id: Self.confirmChatId, title: "Clean up old chats", model: "cline-pass/glm-5.3", thinking: "low", createdAt: c, updatedAt: c + 60_000))
        entries[Self.confirmChatId] = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Delete my chats about the domain.", timestamp: c))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [assistant([
                .toolCall(.init(id: "c-call", name: "app_call", arguments: ["operation": "app_delete_sessions", "arguments": ["ids": ["s-snoozed"]]]))
            ], at: c + 1_000)]),
            result("c-call", "app_call", [.text("Waiting for the user to confirm.")], details: ["confirmation": ["id": "p-confirm", "summary": "Delete 1 chat: “Renew the domain”"]], at: c + 2_000),
            EntryRecord(id: "3", kind: "pi.assistant", model: [assistant([.text("I've asked you to confirm deleting it.")], at: c + 3_000, stop: "stop")])
        ]
        state.access.pending.append(PendingAction(id: "p-confirm", sessionId: Self.confirmChatId, operation: "app_delete_sessions", summary: "Delete 1 chat: “Renew the domain”", createdAt: now - 10 * 60_000, status: "pending"))
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

    /// Plays a reply to `text`: thinking, then (by keyword) a tool step or a generated UI, then text. Attachments are
    /// written into the message as the agent writes them (messageContent in apps/web/src/agent/attachments.ts).
    func deliver(_ text: String, files: [ChatAttachment] = [], to id: String) {
        let tags = files.map { file -> String in
            let attributes = "name=\"\(Self.escape(file.name))\" type=\"\(Self.escape(file.mimeType))\""
            return file.kind == "image" ? "<attachment \(attributes) />" : "<attachment \(attributes)>\n\(file.json["text"]?.string ?? "")\n</attachment>"
        }
        let images = files.compactMap { file in file.kind == "image" ? ImagePart(data: file.data ?? "", mimeType: file.mimeType) : nil }
        let message = UserMessage(text: ([text].filter { !$0.isEmpty } + tags).joined(separator: "\n"), imageParts: images, timestamp: .nowMs)
        let userEntry = EntryRecord(id: entryId(), kind: "pi.user", model: [.user(message)])
        entries[id, default: []].append(userEntry)
        running.insert(id)
        setBusy(id, true)
        let run = store["run:\(id)"]?.number ?? 0
        events(id, [["type": "run_start", "inputs": []], ["type": "entry_appended", "entry": (try? JSONValue(encoding: userEntry)) ?? .null]])
        Task { @MainActor [weak self] in
            await self?.play(reply: text, to: id, run: run)
        }
    }

    /// A 160×100 PNG of a desktop: a menu bar and two windows.
    static let desktopPNG = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAA80lEQVR42u3dsQ2AIBRFUcahtLBkFAZxHIZwOkJBbU1i8HuSO8E7A7yU86HAJRMAFmABFmABFmA9gM/aFDjAgAVYgAVYgAVYgAELsAALsHYH7n38J8CAAQMGDBgwYMCAAQMGDBgwYMCAgwCX+3o/wIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGLDWAwwYMGDAgAEDBgxYgAUYMGDAgOWcUoABC7AAC7AAC7AAA7YCYAEWYAEWYAEWYMACrC80AfLe5gcMT/8QAAAAAElFTkSuQmCC"

    static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    /// The mock's `/api/attachments`: images come back as a small PNG, other files as a line of text; .zip is refused.
    public static func upload(data: Data, name: String, mimeType: String) async throws -> ChatAttachment {
        try await Task.sleep(for: .milliseconds(150))
        if name.lowercased().hasSuffix(".zip") { throw AttachmentError("Dex can't read .zip files yet.", status: 415) }
        if mimeType.hasPrefix("image/") {
            return ChatAttachment(json: ["kind": "image", "name": .string(name), "mimeType": "image/png", "data": .string(Self.desktopPNG)])
        }
        var json: JSONValue = ["kind": "text", "name": .string(name), "mimeType": .string(mimeType), "text": .string("(The contents of \(name).)")]
        if name.lowercased().hasSuffix(".pdf") { json["converted"] = .bool(true) }
        return ChatAttachment(json: json)
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
        if lower.contains("hold") {
            // Runs until it's stopped or steered (about ten minutes at most).
            for _ in 0..<6000 {
                try? await Task.sleep(for: .milliseconds(100))
                guard live() else { return }
            }
        }

        let step = Self.scriptedStep(for: lower, prompt: prompt, sessionId: id)
        let toolName = step?.name
        if let step, let toolName {
            let callId = "call-\(UUID().uuidString.prefix(6))"
            let arguments = step.arguments
            let index = blocks.count
            events(id, [["type": "message_update", "usage": [:], "changes": [["type": "toolcall_start", "contentIndex": .number(Double(index)), "block": ["type": "toolCall", "id": .string(callId), "name": .string(toolName), "arguments": arguments]]]]])
            blocks.append(.toolCall(.init(id: callId, name: toolName, arguments: arguments)))
            let assistantEntry = EntryRecord(id: entryId(), kind: "pi.assistant", model: [.assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", usage: Usage(input: 900, output: 120, totalTokens: 1020), stopReason: "toolUse", timestamp: start, durationMs: Double.nowMs - start))])
            entries[id, default: []].append(assistantEntry)
            events(id, [["type": "message_end", "entry": (try? JSONValue(encoding: assistantEntry)) ?? .null],
                        ["type": "tool_execution_start", "toolCallId": .string(callId), "toolName": .string(toolName), "args": arguments]])
            var output = ""
            for line in step.lines {
                await pause(2)
                guard live() else { return }
                output += line + "\n"
                events(id, [["type": "tool_execution_update", "toolCallId": .string(callId), "toolName": .string(toolName), "output": ["trimStart": 0, "append": .string(line + "\n")]]])
            }
            let resultId = entryId()
            var content: [ContentBlock] = [.text(output)]
            if step.screenshot { content.append(.image(data: "", mimeType: "image/png", ref: "\(resultId):0:1")) }
            let details = step.details
            if toolName == "app_call", let pendingId = details?["confirmation"]?["id"]?.string {
                state.access.pending.append(PendingAction(id: pendingId, sessionId: id, operation: "app_delete_sessions", summary: details?["confirmation"]?["summary"]?.string ?? "", createdAt: .nowMs, status: "pending"))
                publish()
            }
            if toolName == "share_media", let url = details?["media"]?["url"]?.string {
                let name = ChatMedia.fileName(url)
                artifacts[id, default: []].append(ChatArtifact(key: "\(id)/\(name)", url: url, name: name, kind: "video", size: 1_000_000, createdAt: .nowMs))
                broadcast(artifactsMessage(id), sessionId: id)
            }
            let result = EntryRecord(id: resultId, kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: callId, toolName: toolName, content: content, details: details, isError: step.isError, timestamp: .nowMs, durationMs: 400))])
            entries[id, default: []].append(result)
            events(id, [["type": "tool_execution_end", "toolCallId": .string(callId), "toolName": .string(toolName), "entry": (try? JSONValue(encoding: result)) ?? .null]])
            blocks = []
            events(id, [["type": "message_start", "message": ["role": "assistant", "content": [], "model": "cline-pass/glm-5.3", "provider": "clinepass", "stopReason": "pending", "timestamp": .number(Double.nowMs), "usage": [:], "api": "openai-completions"]]])
        }

        if lower.contains("retry") {
            // The model call fails once and is retried.
            events(id, [["type": "auto_retry_start", "attempt": 1, "maxAttempts": 3, "delayMs": 2000, "at": .number(Double.nowMs + 2000), "errorMessage": "429 Too Many Requests"]])
            try? await Task.sleep(for: .seconds(3))
            guard live() else { return }
            events(id, [["type": "auto_retry_end", "success": true, "attempt": 1]])
        }
        if lower.contains("error") {
            let failed = EntryRecord(id: entryId(), kind: "pi.assistant", model: [.assistant(AssistantMessage(content: blocks, model: "cline-pass/glm-5.3", provider: "clinepass", stopReason: "error", errorMessage: "The provider returned 500: upstream overloaded.", timestamp: start, durationMs: Double.nowMs - start))])
            entries[id, default: []].append(failed)
            events(id, [["type": "message_end", "entry": (try? JSONValue(encoding: failed)) ?? .null]])
            stopRun(id, stopReason: "error")
            return
        }
        let answer = step?.answer ?? "Sure. Here's a **short** answer to “\(prompt)”."
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
            deliver(next.text, files: queuedFiles.removeValue(forKey: next.id) ?? [], to: id)
        }
    }

    /// One tool step a scripted reply takes, picked by a word in the message.
    struct ScriptedStep {
        var name: String
        var arguments: JSONValue
        var lines: [String] = ["ok"]
        var isError = false
        var screenshot = false
        var details: JSONValue? = nil
        var answer: String
    }

    static func scriptedStep(for lower: String, prompt: String, sessionId: String) -> ScriptedStep? {
        if lower.contains("chart") || lower.contains("ui") {
            return ScriptedStep(name: "render_ui", arguments: ["title": "Weekly visits", "code": .string(MockData.chartProgram)], answer: "Friday had the most visits.")
        }
        if lower.contains("screenshot") {
            return ScriptedStep(name: "vm_screenshot", arguments: .object([:]), lines: ["Screenshot of the VM's screen."], screenshot: true, answer: "That's the desktop right now.")
        }
        if lower.contains("fail") {
            return ScriptedStep(name: "bash", arguments: ["command": "make deploy"], lines: ["make: *** No rule to make target 'deploy'.", "exit code: 2"], isError: true, answer: "The deploy target doesn't exist yet.")
        }
        if lower.contains("delete") || lower.contains("confirm") {
            let pendingId = "p-\(UUID().uuidString.prefix(6).lowercased())"
            return ScriptedStep(name: "app_call", arguments: ["operation": "app_delete_sessions", "arguments": ["ids": ["s-settled"]]], lines: ["Waiting for the user to confirm."],
                                details: ["confirmation": ["id": .string(pendingId), "summary": "Delete 1 chat: “Compare note-taking apps”"]], answer: "Confirm it above and I'll delete it.")
        }
        if lower.contains("video") || lower.contains("share") {
            return ScriptedStep(name: "share_media", arguments: ["path": "~/work/recording.mp4"], lines: ["Shared recording.mp4"],
                                details: ["media": ["url": .string("/api/media/\(sessionId)/recording.mp4"), "name": "recording.mp4", "kind": "video"]], answer: "Here's the recording.")
        }
        if lower.contains("memory") || lower.contains("remember") {
            return ScriptedStep(name: "edit_file", arguments: ["path": "MEMORY.md", "old_string": "", "new_string": .string("- " + prompt)], lines: ["Edited MEMORY.md"], answer: "Noted for next time.")
        }
        if lower.contains("vm") || lower.contains("test") {
            return ScriptedStep(name: "vm_exec", arguments: ["command": "npm test"], lines: ["> dex@1.0.0 test", "PASS src/dates.test.ts", "Tests: 42 passed"], answer: "All 42 tests pass now.")
        }
        if lower.contains("search") {
            return ScriptedStep(name: "web_search", arguments: ["query": .string(prompt)], lines: ["1. Result one — https://example.com/one", "The first result.", "2. Result two — https://example.com/two"], answer: "Two good sources.")
        }
        return nil
    }
}
