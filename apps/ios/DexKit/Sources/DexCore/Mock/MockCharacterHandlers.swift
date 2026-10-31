import Foundation

/// The mock agent's sidekicks: Muse (a conversation going, and an earlier one from before Start over) and Atlas (just
/// made: only his greeting so far), each wearing their ready-made look, and their methods, as DexAgent has them
/// (apps/web/src/agent/dex-agent.ts).
extension MockAgent {
    public static let museId = "muse"
    public static let museChatId = "s-muse"
    public static let museEarlierChatId = "s-muse-earlier"
    public static let atlasId = "atlas"
    public static let atlasChatId = "s-atlas"

    func installCharacterHandlers() {
        installCharacterFixtures()

        register("saveCharacter") { [unowned self] args, _ in
            let draft = try args.value(0).decode(CharacterDraft.self)
            let name = String(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
            guard !name.isEmpty else { throw AgentError.remote("Give the character a name.") }
            let existing = self.state.character(draft.id)
            if draft.id != nil, existing == nil { throw AgentError.remote("That character no longer exists.") }
            if draft.pictureChanged, let image = draft.image, !image.hasPrefix("data:image/") || image.count > Characters.maxImageURLLength {
                throw AgentError.remote("Pick a smaller picture (PNG, JPEG, WebP, GIF, or SVG under 48 KB).")
            }
            let model = self.catalog.model(draft.model) != nil ? draft.model : (existing?.model ?? self.state.settings.defaultModel)
            let now = Double.nowMs
            var character = CharacterProfile(
                id: existing?.id ?? "\(Skills.slug(name).prefix(32))-\(UUID().uuidString.prefix(6).lowercased())", name: name,
                tagline: String(draft.tagline.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)), persona: draft.persona,
                instructions: draft.instructions, greeting: String(draft.greeting.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2_000)),
                avatar: draft.avatar.trimmingCharacters(in: .whitespacesAndNewlines).first.map(String.init) ?? "",
                // Left out, the picture stays.
                look: draft.pictureChanged ? draft.look : existing?.look, image: draft.pictureChanged ? draft.image : existing?.image,
                color: AgentColorNames.contains(draft.color) ? draft.color : "violet", model: model,
                thinking: self.catalog.model(model)?.clampThinking(draft.thinking) ?? draft.thinking,
                mcpServers: draft.mcpServers.filter { id in self.state.mcp.contains { $0.id == id } }, sessionId: existing?.sessionId ?? "",
                createdAt: existing?.createdAt ?? now, updatedAt: now
            )
            if let index = self.state.sessions.firstIndex(where: { $0.id == character.sessionId }) {
                // Their conversation takes the new name, model, and MCP servers.
                self.state.sessions[index].title = name
                self.state.sessions[index].model = character.model
                self.state.sessions[index].thinking = character.thinking
                self.state.sessions[index].mcpServers = character.mcpServers
            } else {
                character.sessionId = self.openCharacterSession(character)
            }
            if let index = self.state.characters.firstIndex(where: { $0.id == character.id }) { self.state.characters[index] = character } else { self.state.characters.append(character) }
            self.publish()
            return try JSONValue(encoding: character)
        }

        register("deleteCharacter") { [unowned self] args, _ in
            let id = args.string(0)
            self.state.characters.removeAll { $0.id == id }
            // Their conversations become ordinary chats; ones that never got a message go.
            self.state.sessions.removeAll { $0.characterId == id && $0.updatedAt == $0.createdAt }
            for index in self.state.sessions.indices where self.state.sessions[index].characterId == id { self.state.sessions[index].characterId = nil }
            self.publish()
            return .null
        }

        register("restartCharacter") { [unowned self] args, _ in
            guard let character = self.state.character(args.string(0)) else { throw AgentError.remote("That character no longer exists.") }
            return try JSONValue(encoding: self.restart(character))
        }

        register("characterMemory") { [unowned self] args, _ in
            guard let id = args.string(0), self.state.character(id) != nil else { throw AgentError.remote("That character no longer exists.") }
            return .string(self.store["memory:\(id)"]?.string ?? "")
        }

        register("saveCharacterMemory") { [unowned self] args, _ in
            guard let id = args.string(0), self.state.character(id) != nil else { throw AgentError.remote("That character no longer exists.") }
            let text = String((args.string(1) ?? "").prefix(64_000))
            self.store["memory:\(id)"] = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .string(text)
            return .null
        }
    }

    /// A new conversation with a character, titled with their name.
    private func openCharacterSession(_ character: CharacterProfile) -> String {
        let now = Double.nowMs
        let session = SessionMeta(id: "s-\(UUID().uuidString.prefix(8).lowercased())", title: character.name, model: character.model, thinking: character.thinking,
                                  createdAt: now, updatedAt: now, mcpServers: character.mcpServers, characterId: character.id)
        state.sessions.insert(session, at: 0)
        entries[session.id] = []
        return session.id
    }

    /// Start over: a new conversation; the old one stays (unless it never got a message).
    @discardableResult
    func restart(_ character: CharacterProfile) -> CharacterProfile {
        var character = character
        let old = character.sessionId
        character.sessionId = openCharacterSession(character)
        character.updatedAt = .nowMs
        if let index = state.characters.firstIndex(where: { $0.id == character.id }) { state.characters[index] = character }
        if let session = state.session(old), session.updatedAt == session.createdAt, !running.contains(old) {
            state.sessions.removeAll { $0.id == old }
            entries[old] = nil
        }
        publish()
        return character
    }

    private func installCharacterFixtures() {
        let now = Double.nowMs
        let minute = 60_000.0
        let day = 86_400_000.0
        let muse = CharacterTemplate.all[0]
        let atlas = CharacterTemplate.all[1]
        state.characters.append(contentsOf: [
            CharacterProfile(id: Self.museId, name: muse.name, tagline: muse.tagline, persona: muse.persona, instructions: muse.instructions, greeting: muse.greeting,
                             look: muse.look?.look, image: muse.look?.image, color: muse.color, model: "cline-pass/kimi-k3", thinking: "high", sessionId: Self.museChatId,
                             createdAt: now - 20 * day, updatedAt: now - 6 * day),
            CharacterProfile(id: Self.atlasId, name: atlas.name, tagline: atlas.tagline, persona: atlas.persona, instructions: atlas.instructions, greeting: atlas.greeting,
                             look: atlas.look?.look, image: atlas.look?.image, color: atlas.color, model: "cline-pass/glm-5.3", thinking: "low", sessionId: Self.atlasChatId,
                             createdAt: now - 2 * day, updatedAt: now - 2 * day)
        ])
        state.sessions.append(contentsOf: [
            SessionMeta(id: Self.museChatId, title: "Muse", model: "cline-pass/kimi-k3", thinking: "high", createdAt: now - 6 * day, updatedAt: now - 40 * minute, characterId: Self.museId),
            SessionMeta(id: Self.museEarlierChatId, title: "Muse", model: "cline-pass/kimi-k3", thinking: "high", createdAt: now - 20 * day, updatedAt: now - 7 * day, characterId: Self.museId),
            SessionMeta(id: Self.atlasChatId, title: "Atlas", model: "cline-pass/glm-5.3", thinking: "low", createdAt: now - 2 * day, updatedAt: now - 2 * day, characterId: Self.atlasId)
        ])
        func assistant(_ text: String, at: Double) -> PiMessage {
            .assistant(AssistantMessage(content: [.text(text)], model: "cline-pass/kimi-k3", provider: "clinepass", usage: Usage(input: 900, output: 120, totalTokens: 1020), stopReason: "stop", timestamp: at, durationMs: 2_500))
        }
        let t = now - 50 * minute
        entries[Self.museChatId] = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "I'm opening a tiny pottery studio. Help me name it?", timestamp: t))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [assistant("""
            Ooh, yes. Three directions to riff on:

            - **Earthy:** Kiln & Kin, Slow Clay, Wet Hands
            - **Playful:** Mud Club, Pot Luck, The Wobbly Bowl
            - **Quiet:** Wheel House, Glaze Room

            Which one makes you grin? We'll go deep on that one.
            """, at: t + 2_000)]),
            EntryRecord(id: "3", kind: "pi.user", model: [.user(UserMessage(text: "Mud Club, obviously.", timestamp: t + 5 * minute))]),
            EntryRecord(id: "4", kind: "pi.assistant", model: [assistant("Knew it. Mud Club has a secret-society feel: members' nights, a little stamp on every pot. Want me to sketch a logo next?", at: t + 5 * minute + 2_000)])
        ]
        let e = now - 20 * day
        entries[Self.museEarlierChatId] = [
            EntryRecord(id: "1", kind: "pi.user", model: [.user(UserMessage(text: "Give me a story prompt about a lighthouse.", timestamp: e))]),
            EntryRecord(id: "2", kind: "pi.assistant", model: [assistant("A lighthouse keeper starts getting letters from the ships she guides. One of them is dated next year.", at: e + 2_000)])
        ]
        entries[Self.atlasChatId] = []
        store["memory:\(Self.museId)"] = "# About you\n- Opening a pottery studio: Mud Club\n- Likes playful names\n"
    }
}
