import Foundation

/// The mock agent's spaces: "Launch the new site", whose coordinator started four threads in the Dex project (one done,
/// one working, one waiting on your confirmation, one failed) and has heard back from two of them; and its methods, as
/// DexAgent has them (apps/web/src/agent/dex-agent.ts). In a space's chat, a message with "thread" in it starts one.
extension MockAgent {
    public static let spaceId = "launch"
    public static let spaceChatId = "s-space-launch"
    public static let spaceThreadIds = (done: "s-thread-speed", working: "s-thread-post", needsYou: "s-thread-redirects", failed: "s-thread-sitemap")
    public static let spaceNotes = """
    # Launch the new site

    ## Decisions
    - Ship Friday; the blog post goes out the same morning.
    - Images move to WebP.

    ## Ledger
    - **Audit page speed**: done (94 on mobile)
    - **Write the launch post**: drafting
    - **Set up redirects**: waiting on your confirmation
    - **Fix the sitemap build**: failed once, retrying after the redirects land
    """

    func installSpaceHandlers() {
        installSpaceFixtures()

        register("saveSpace") { [unowned self] args, _ in
            let draft = try args.value(0).decode(SpaceDraft.self)
            let name = String(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Spaces.maxName))
            guard !name.isEmpty else { throw AgentError.remote("Give the space a name.") }
            let existing = self.state.space(draft.id)
            if draft.id != nil, existing == nil { throw AgentError.remote("That space no longer exists.") }
            let projectId = draft.projectId.flatMap { self.state.project($0)?.id }
            let now = Double.nowMs
            var space = SpaceProfile(
                id: existing?.id ?? "\(Skills.slug(name).prefix(32))-\(UUID().uuidString.prefix(6).lowercased())", name: name,
                goal: String(draft.goal.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Spaces.maxGoal)), projectId: projectId,
                sessionId: existing?.sessionId ?? "", createdAt: existing?.createdAt ?? now, updatedAt: now
            )
            if let index = self.state.sessions.firstIndex(where: { $0.id == space.sessionId }) {
                self.state.sessions[index].title = name
            } else {
                // The coordinator's chat, titled with the space's name.
                let session = SessionMeta(id: "s-\(UUID().uuidString.prefix(8).lowercased())", title: name, model: self.state.settings.defaultModel,
                                          thinking: self.state.settings.defaultThinking, createdAt: now, updatedAt: now, projectId: projectId, spaceId: space.id)
                self.state.sessions.insert(session, at: 0)
                self.entries[session.id] = []
                space.sessionId = session.id
            }
            if let index = self.state.spaces.firstIndex(where: { $0.id == space.id }) { self.state.spaces[index] = space } else { self.state.spaces.append(space) }
            self.publish()
            return try JSONValue(encoding: space)
        }

        register("deleteSpace") { [unowned self] args, _ in
            guard let id = args.string(0) else { return .null }
            let gone = Set(self.state.sessions.filter { $0.spaceId == id }.map(\.id))
            self.state.spaces.removeAll { $0.id == id }
            self.state.sessions.removeAll { gone.contains($0.id) }
            self.state.vms.removeAll { gone.contains($0.key) }
            self.state.access.pending.removeAll { gone.contains($0.sessionId) }
            for session in gone {
                self.entries[session] = nil
                self.running.remove(session)
            }
            self.store["notes:\(id)"] = nil
            self.publish()
            return .null
        }

        register("spaceNotes") { [unowned self] args, _ in
            guard let id = args.string(0), self.state.space(id) != nil else { throw AgentError.remote("That space no longer exists.") }
            return .string(self.store["notes:\(id)"]?.string ?? "")
        }
    }

    /// A thread the coordinator starts (space_start_thread): an ordinary chat in the space and its project, muted.
    func startThread(in spaceId: String, title: String) -> SessionMeta {
        let space = state.space(spaceId)
        let now = Double.nowMs
        let session = SessionMeta(id: "s-\(UUID().uuidString.prefix(8).lowercased())", title: title, model: state.settings.defaultModel,
                                  thinking: state.settings.defaultThinking, createdAt: now, updatedAt: now, projectId: space?.projectId,
                                  spaceId: spaceId, muted: true)
        state.sessions.insert(session, at: 0)
        entries[session.id] = []
        publish()
        return session
    }

    private func installSpaceFixtures() {
        let now = Double.nowMs
        let minute = 60_000.0
        let hour = 60 * minute
        let ids = Self.spaceThreadIds
        let t = now - 3 * hour
        state.spaces.append(SpaceProfile(id: Self.spaceId, name: "Launch the new site", goal: "Get the redesigned site live by Friday: fast, no broken links, announced.",
                                         projectId: "p-dex", sessionId: Self.spaceChatId, createdAt: t, updatedAt: t))
        let threads: [(id: String, title: String, prompt: String)] = [
            (ids.done, "Audit page speed", "Audit the site's page speed on mobile and fix the biggest costs."),
            (ids.working, "Write the launch post", "Draft the launch blog post: what's new, with screenshots."),
            (ids.needsYou, "Set up redirects", "Redirect every old URL to its new page."),
            (ids.failed, "Fix the sitemap build", "The sitemap build fails on the new routes. Fix it.")
        ]
        let speedReply = "Lighthouse is **94** on mobile now (was 61). The hero image was most of it: it's WebP and lazy-loaded."
        let sitemapProblem = "The provider returned 500: upstream overloaded."
        state.sessions.append(contentsOf: [
            SessionMeta(id: Self.spaceChatId, title: "Launch the new site", model: "cline-pass/kimi-k3", thinking: "high", createdAt: t, updatedAt: now - 20 * minute,
                        projectId: "p-dex", spaceId: Self.spaceId, lastReply: "Page speed is done; the sitemap thread failed and I'll retry it once the redirects land.", repliedAt: now - 20 * minute),
            SessionMeta(id: ids.done, title: threads[0].title, model: "cline-pass/glm-5.3", thinking: "low", createdAt: t + 1_000, updatedAt: now - 40 * minute,
                        projectId: "p-dex", spaceId: Self.spaceId, lastReply: ChatAlerts.summarize(speedReply), repliedAt: now - 40 * minute, muted: true),
            SessionMeta(id: ids.working, title: threads[1].title, model: "cline-pass/glm-5.3", thinking: "low", createdAt: t + 2_000, updatedAt: now - 2 * minute,
                        busy: true, projectId: "p-dex", spaceId: Self.spaceId, muted: true),
            SessionMeta(id: ids.needsYou, title: threads[2].title, model: "cline-pass/glm-5.3", thinking: "low", createdAt: t + 3_000, updatedAt: now - 10 * minute,
                        projectId: "p-dex", spaceId: Self.spaceId, lastReply: "Confirm the redirects above and I'll add them.", repliedAt: now - 10 * minute, muted: true),
            SessionMeta(id: ids.failed, title: threads[3].title, model: "cline-pass/glm-5.3", thinking: "low", createdAt: t + 4_000, updatedAt: now - 25 * minute,
                        projectId: "p-dex", spaceId: Self.spaceId, failed: true, lastReply: "Problem: \(sitemapProblem)", repliedAt: now - 25 * minute, muted: true)
        ])
        running.insert(ids.working)
        state.access.pending.append(PendingAction(id: "p-space-redirects", sessionId: ids.needsYou, operation: "app_update_settings",
                                                  summary: "Add 12 redirects to the site's settings", createdAt: now - 10 * minute, status: "pending"))

        func assistant(_ blocks: [ContentBlock], at: Double, stop: String = "stop", error: String? = nil) -> EntryRecord {
            EntryRecord(id: entryId(), kind: "pi.assistant", model: [.assistant(AssistantMessage(content: blocks, model: "cline-pass/kimi-k3", provider: "clinepass",
                usage: Usage(input: 1200, output: 160, totalTokens: 1360), stopReason: stop, errorMessage: error, timestamp: at, durationMs: 3_000))])
        }
        func result(_ callId: String, _ name: String, _ text: String, details: JSONValue? = nil, at: Double) -> EntryRecord {
            EntryRecord(id: entryId(), kind: "pi.toolResult", model: [.toolResult(ToolResultMessage(toolCallId: callId, toolName: name, content: [.text(text)], details: details, isError: false, timestamp: at, durationMs: 300))])
        }
        func user(_ text: String, at: Double) -> EntryRecord {
            EntryRecord(id: entryId(), kind: "pi.user", model: [.user(UserMessage(text: text, timestamp: at))])
        }

        // The coordinator: your ask, the four threads it started, and two of them reporting back.
        var coordinator = [user("Get the new site ready to launch Friday: speed, redirects, the sitemap, and a launch post.", at: t)]
        coordinator.append(assistant([.thinking("Four independent pieces: one thread each.", redacted: false)] + threads.map { thread in
            .toolCall(.init(id: "start-\(thread.id)", name: Spaces.startThreadTool, arguments: ["title": .string(thread.title), "prompt": .string(thread.prompt)]))
        }, at: t + 500, stop: "toolUse"))
        for (index, thread) in threads.enumerated() {
            coordinator.append(result("start-\(thread.id)", Spaces.startThreadTool, "Started “\(thread.title)” (\(thread.id)).",
                                      details: ["thread": ["id": .string(thread.id), "title": .string(thread.title)]], at: t + 1_000 + Double(index) * 1_000))
        }
        coordinator.append(assistant([.text("I've started four threads, one for each piece. I'll keep track of them here and tell you when each one reports back.")], at: t + 5_000))
        let updates = [
            Spaces.update(thread: (ids.done, threads[0].title), outcome: .finished, body: speedReply),
            Spaces.update(thread: (ids.failed, threads[3].title), outcome: .failed, body: "Problem: \(sitemapProblem)")
        ].joined(separator: Spaces.updateSeparator)
        coordinator.append(user(updates, at: now - 21 * minute))
        coordinator.append(assistant([.text("**Page speed is done:** 94 on mobile, up from 61.\n\nThe sitemap thread failed on a model error. I'll retry it once the redirects land, since they change the routes it lists. The redirects are waiting on your confirmation in their thread.")], at: now - 20 * minute))
        entries[Self.spaceChatId] = coordinator

        entries[ids.done] = [user(threads[0].prompt, at: t + 1_000), assistant([.text(speedReply)], at: now - 40 * minute)]
        entries[ids.working] = [user(threads[1].prompt, at: t + 2_000)]
        entries[ids.needsYou] = [
            user(threads[2].prompt, at: t + 3_000),
            assistant([.toolCall(.init(id: "redirects-call", name: "app_call", arguments: ["operation": "app_update_settings", "arguments": ["redirects": 12]]))], at: now - 11 * minute, stop: "toolUse"),
            result("redirects-call", "app_call", "Waiting for the user to confirm.", details: ["confirmation": ["id": "p-space-redirects", "summary": "Add 12 redirects to the site's settings"]], at: now - 11 * minute + 500),
            assistant([.text("Confirm the redirects above and I'll add them.")], at: now - 10 * minute)
        ]
        entries[ids.failed] = [user(threads[3].prompt, at: t + 4_000), assistant([], at: now - 25 * minute, stop: "error", error: sitemapProblem)]
        store["notes:\(Self.spaceId)"] = .string(Self.spaceNotes)
    }
}
