import Foundation
import Testing
@testable import DexCore

@Suite struct CharacterModelTests {
    @Test func olderStateHasNoCharacters() throws {
        // An agent from before characters: no `characters`, no `characterId` on its sessions.
        let json = #"{"settings":{"defaultModel":"m","defaultThinking":"low","instructions":""},"sessions":[{"id":"a","title":"Hi","model":"m","thinking":"low","createdAt":1,"updatedAt":2,"busy":false}]}"#
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(json.utf8))
        #expect(state.characters.isEmpty)
        #expect(state.sessions[0].characterId == nil)
        #expect(state.chats.map(\.id) == ["a"])
    }

    @Test func decodesCharactersAndTheirConversations() throws {
        let json = #"""
        {"characters":[{"id":"muse-1a2b3c","name":"Muse","tagline":"Your creative sparring partner","persona":"Playful.","instructions":"Brainstorm.","greeting":"Hey you.","avatar":"🎨","look":{"body":"blob","skin":"pink","eyes":"sparkle","mouth":"grin","extra":"beret","blush":true},"image":"data:image/png;base64,AA","color":"violet","model":"cline-pass/glm-5.3","thinking":"low","mcpServers":["m1"],"sessionId":"s2","createdAt":1,"updatedAt":5},
          {"id":"bare","name":"  zed","sessionId":"s3","look":null}],
         "sessions":[{"id":"s1","title":"Plain","model":"m","thinking":"low","createdAt":1,"updatedAt":2,"busy":false,"characterId":null},
          {"id":"s2","title":"Muse","model":"m","thinking":"low","createdAt":3,"updatedAt":4,"busy":true,"characterId":"muse-1a2b3c"},
          {"id":"s0","title":"Muse","model":"m","thinking":"low","createdAt":2,"updatedAt":2,"busy":false,"characterId":"muse-1a2b3c"}]}
        """#
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(json.utf8))
        let muse = try #require(state.character("muse-1a2b3c"))
        #expect(muse.avatar == "🎨" && muse.image == "data:image/png;base64,AA" && muse.mcpServers == ["m1"] && muse.sessionId == "s2" && muse.greeting == "Hey you.")
        #expect(muse.look?["extra"] == "beret" && muse.look?["blush"] == true)
        #expect(muse.glyph == "🎨")
        // Missing fields get the server's defaults; no emoji shows the initial.
        let bare = try #require(state.character("bare"))
        #expect(bare.color == "violet" && bare.tagline.isEmpty && bare.mcpServers.isEmpty && bare.image == nil && bare.look == nil)
        #expect(bare.glyph == "Z")
        // Their conversations live under them, not with the chats.
        #expect(state.chats.map(\.id) == ["s1"])
        #expect(state.conversations(of: "muse-1a2b3c").map(\.id) == ["s2", "s0"])
        // And go back the same way (the device cache).
        #expect(try JSONDecoder.dex.decode(DexState.self, from: JSONEncoder.dex.encode(state)) == state)
    }

    @Test func draftsEncodeLikeTheServerExpects() throws {
        let new = CharacterDraft(name: "Muse", model: "cline-pass/glm-5.3", thinking: "low")
        let json = try JSONValue(encoding: new)
        // No id: a new sidekick. No picture picked: none sent.
        #expect(json["id"] == nil && json["image"] == nil && json["look"] == nil && json["mcpServers"] == [] && json["color"] == "violet")
        // An edit that leaves the picture alone leaves it out, so the server keeps it.
        let muse = try #require(SidekickLook.named("muse"))
        var edit = CharacterDraft(CharacterProfile(id: "muse", name: "Muse", look: muse.look, image: muse.image, sessionId: "s1"))
        #expect(try JSONValue(encoding: edit)["id"] == "muse" && JSONValue(encoding: edit)["image"] == nil && JSONValue(encoding: edit)["look"] == nil)
        #expect(try JSONValue(encoding: edit)["sessionId"] == nil)
        #expect(edit.preset?.id == "muse")
        // Another look: its parts, picture, and color.
        let mochi = try #require(SidekickLook.named("mochi"))
        edit.use(mochi)
        var sent = try JSONValue(encoding: edit)
        #expect(sent["look"] == mochi.look && sent["image"]?.string == mochi.image && sent["color"] == "rose" && edit.preset?.id == "mochi")
        // A photo: the look goes (null, not left out).
        edit.usePhoto("data:image/jpeg;base64,AA")
        sent = try JSONValue(encoding: edit)
        #expect(sent["look"] == .null && sent["image"] == "data:image/jpeg;base64,AA" && edit.preset == nil)
        // Read back as the agent reads it.
        let read = try sent.decode(CharacterDraft.self)
        #expect(read.pictureChanged && read.look == nil && read.image == "data:image/jpeg;base64,AA")
        #expect(try !JSONValue(encoding: CharacterDraft(CharacterProfile(id: "x", name: "X", sessionId: "s"))).decode(CharacterDraft.self).pictureChanged)
    }

    @Test func readyMadeLooks() throws {
        // assets/sidekicks: twelve, each a small PNG the server keeps.
        #expect(SidekickLook.all.count == 12)
        #expect(Set(SidekickLook.all.map(\.id)).count == 12)
        for look in SidekickLook.all {
            #expect(look.image.hasPrefix("data:image/png;base64,") && look.image.count < Characters.maxImageURLLength, "\(look.id)")
            #expect(AgentColorNames.contains(look.color) && look.look["body"]?.string != nil, "\(look.id)")
        }
    }

    @Test func templates() throws {
        #expect(CharacterTemplate.all.map(\.id) == ["muse", "atlas", "sage", "rex"])
        #expect(CharacterTemplate.all.allSatisfy { AgentColorNames.contains($0.color) && !$0.greeting.isEmpty && $0.look?.color == $0.color })
        let draft = CharacterDraft(id: "x", name: "Old", avatar: "🦊", image: "data:image/png;base64,AA", model: "m", thinking: "high", mcpServers: ["m1"]).applying(CharacterTemplate.all[3])
        let rex = try #require(SidekickLook.named("rex"))
        #expect(draft.name == "Rex" && draft.avatar.isEmpty && draft.color == "orange" && draft.image == rex.image && draft.look == rex.look && draft.pictureChanged)
        // Keeps what isn't the template's.
        #expect(draft.id == "x" && draft.model == "m" && draft.thinking == "high" && draft.mcpServers == ["m1"])
        #expect(Characters.memoryPath("muse") == "/workspace/sidekicks/muse/MEMORY.md")
    }
}

@MainActor
@Suite struct CharacterMockTests {
    func connected() async -> (MockAgent, DexClient) {
        let agent = MockAgent()
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        await eventually { client.isConnected }
        return (agent, client)
    }

    @Test func seedsMuseAndAtlas() async {
        let (_, client) = await connected()
        await eventually { client.state?.characters.count == 2 }
        #expect(client.state?.character(MockAgent.museId)?.sessionId == MockAgent.museChatId)
        #expect(client.state?.character(MockAgent.museId)?.image == SidekickLook.named("muse")?.image)
        #expect(client.state?.conversations(of: MockAgent.museId).map(\.id) == [MockAgent.museChatId, MockAgent.museEarlierChatId])
        #expect(client.state?.chats.contains { $0.characterId != nil } == false)
    }

    @Test func createEditAndDelete() async throws {
        let (agent, client) = await connected()
        let rex = try await client.saveCharacter(CharacterDraft(model: "cline-pass/glm-5.3", thinking: "low", mcpServers: ["m-linear", "gone"]).applying(CharacterTemplate.all[3]))
        #expect(rex.name == "Rex" && rex.mcpServers == ["m-linear"] && !rex.sessionId.isEmpty && rex.look == SidekickLook.named("rex")?.look && rex.image != nil)
        await eventually { client.state?.session(rex.sessionId)?.characterId == rex.id }
        #expect(client.state?.session(rex.sessionId)?.title == "Rex")

        // An edit renames their conversation and moves it to the new model.
        var draft = CharacterDraft(rex)
        draft.name = "Coach Rex"
        draft.model = "cline-pass/kimi-k3"
        draft.avatar = "🏋️‍♀️🔥"
        let edited = try await client.saveCharacter(draft)
        #expect(edited.id == rex.id && edited.sessionId == rex.sessionId && edited.avatar == "🏋️‍♀️")
        // The picture wasn't sent: it stays.
        #expect(edited.look == rex.look && edited.image == rex.image)
        await eventually { client.state?.session(rex.sessionId)?.title == "Coach Rex" && client.state?.session(rex.sessionId)?.model == "cline-pass/kimi-k3" }

        await #expect(throws: AgentError.self) { _ = try await client.saveCharacter(CharacterDraft(model: "m", thinking: "low")) }
        await #expect(throws: AgentError.self) {
            var big = CharacterDraft(name: "Big", model: "m", thinking: "low")
            big.usePhoto("data:image/jpeg;base64," + String(repeating: "A", count: 70_000))
            _ = try await client.saveCharacter(big)
        }

        // Deleting Muse keeps her conversations, as ordinary chats; Rex's never got a message, so it goes.
        try await client.deleteCharacter(MockAgent.museId)
        await eventually { client.state?.character(MockAgent.museId) == nil }
        #expect(client.state?.session(MockAgent.museChatId)?.characterId == nil)
        #expect(client.state?.chats.contains { $0.id == MockAgent.museEarlierChatId } == true)
        try await client.deleteCharacter(rex.id)
        await eventually { client.state?.session(rex.sessionId) == nil }
        #expect(agent.calls.map(\.method).filter { $0.hasSuffix("Character") } == ["saveCharacter", "saveCharacter", "saveCharacter", "saveCharacter", "deleteCharacter", "deleteCharacter"])
    }

    @Test func startOverAndMemory() async throws {
        let (_, client) = await connected()
        await eventually { client.state?.character(MockAgent.museId) != nil }
        let muse = try await client.restartCharacter(MockAgent.museId)
        #expect(muse.sessionId != MockAgent.museChatId)
        await eventually { client.state?.character(MockAgent.museId)?.sessionId == muse.sessionId }
        // The old conversation stays, listed with hers.
        #expect(client.state?.conversations(of: MockAgent.museId).map(\.id) == [muse.sessionId, MockAgent.museChatId, MockAgent.museEarlierChatId])
        // Starting over again drops the one that never got a message.
        let again = try await client.restartCharacter(MockAgent.museId)
        await eventually { client.state?.session(muse.sessionId) == nil && client.state?.character(MockAgent.museId)?.sessionId == again.sessionId }

        // Deleting her current conversation starts a new one.
        try await client.run("deleteSession", .string(again.sessionId))
        await eventually { client.state?.character(MockAgent.museId).map { $0.sessionId != again.sessionId && client.state?.session($0.sessionId) != nil } == true }

        #expect(try await client.characterMemory(MockAgent.museId).contains("Mud Club"))
        try await client.saveCharacterMemory(MockAgent.museId, "- Likes tea")
        #expect(try await client.characterMemory(MockAgent.museId) == "- Likes tea")
        try await client.saveCharacterMemory(MockAgent.museId, "  ")
        #expect(try await client.characterMemory(MockAgent.museId) == "")
        await #expect(throws: AgentError.self) { _ = try await client.characterMemory("nobody") }
    }
}
