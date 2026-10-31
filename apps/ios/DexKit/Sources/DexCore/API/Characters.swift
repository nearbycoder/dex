import Foundation

// Requests, starting points, and ready-made looks for sidekicks (`character` in code and on the wire). Mirrors
// apps/web/src/shared/characters.ts and the looks exported from apps/web/src/shared/sidekick-look.ts.

/// What `saveCharacter` takes: a new sidekick (no id) or an edit. Their picture (`look` and `image`) goes only when it
/// changed here (`pictureChanged`): left out, the server keeps it; null removes it.
public struct CharacterDraft: Codable, Sendable, Hashable {
    public var id: String?
    public var name: String
    public var tagline: String
    public var persona: String
    public var instructions: String
    public var greeting: String
    public var avatar: String
    public var look: JSONValue?
    public var image: String?
    public var color: String
    public var model: String
    public var thinking: ThinkingLevel
    public var mcpServers: [String]
    /// Their notification setting ("all", "reachouts", "off"). Left out (nil), the server keeps it: it's set only to
    /// change it (`withNotify`), so saving the editor never undoes a change made from their chat's bell meanwhile.
    public var notify: String?
    /// A look was picked, a photo chosen, or the picture removed: send `look` and `image`.
    public var pictureChanged = false

    public init(id: String? = nil, name: String = "", tagline: String = "", persona: String = "", instructions: String = "", greeting: String = "",
                avatar: String = "", look: JSONValue? = nil, image: String? = nil, color: String = "violet", model: String, thinking: ThinkingLevel,
                mcpServers: [String] = [], pictureChanged: Bool = false) {
        self.id = id; self.name = name; self.tagline = tagline; self.persona = persona; self.instructions = instructions; self.greeting = greeting
        self.avatar = avatar; self.look = look; self.image = image; self.color = color; self.model = model; self.thinking = thinking
        self.mcpServers = mcpServers; self.pictureChanged = pictureChanged
    }

    public init(_ character: CharacterProfile) {
        self.init(id: character.id, name: character.name, tagline: character.tagline, persona: character.persona, instructions: character.instructions,
                  greeting: character.greeting, avatar: character.avatar, look: character.look, image: character.image, color: character.color,
                  model: character.model, thinking: character.thinking, mcpServers: character.mcpServers)
    }

    /// A ready-made look: its parts, its picture, and its background color.
    public mutating func use(_ preset: SidekickLook) {
        look = preset.look; image = preset.image; color = preset.color; avatar = ""; pictureChanged = true
    }

    /// A photo instead of a look.
    public mutating func usePhoto(_ dataURL: String) {
        look = nil; image = dataURL; pictureChanged = true
    }

    /// No picture: their emoji, or their initial.
    public mutating func removePicture() {
        look = nil; image = nil; pictureChanged = true
    }

    /// The ready-made look this draft wears, if it's one of them.
    public var preset: SidekickLook? { look.flatMap { look in SidekickLook.all.first { $0.look == look } } }

    /// A template's text and look, keeping this draft's id, model, thinking, and MCP servers.
    public func applying(_ template: CharacterTemplate) -> CharacterDraft {
        var draft = self
        draft.name = template.name; draft.tagline = template.tagline
        draft.persona = template.persona; draft.instructions = template.instructions; draft.greeting = template.greeting
        if let preset = template.look { draft.use(preset) } else { draft.removePicture(); draft.color = template.color }
        return draft
    }

    /// A name is required (the server trims it).
    public var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The avatar's glyph without a picture (as `CharacterProfile.glyph`).
    public var glyph: String {
        if !avatar.isEmpty { return avatar }
        return name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
    }

    enum CodingKeys: String, CodingKey { case id, name, tagline, persona, instructions, greeting, avatar, look, image, color, model, thinking, mcpServers, notify }

    /// A sidekick as they are, with only their notification setting changed (their picture left out, so it's kept).
    public static func withNotify(_ character: CharacterProfile, _ level: SidekickNotify) -> CharacterDraft {
        var draft = CharacterDraft(character)
        draft.notify = level.rawValue
        return draft
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(name, forKey: .name); try c.encode(tagline, forKey: .tagline); try c.encode(persona, forKey: .persona)
        try c.encode(instructions, forKey: .instructions); try c.encode(greeting, forKey: .greeting); try c.encode(avatar, forKey: .avatar)
        if pictureChanged {
            if let look { try c.encode(look, forKey: .look) } else { try c.encodeNil(forKey: .look) }
            if let image { try c.encode(image, forKey: .image) } else { try c.encodeNil(forKey: .image) }
        }
        try c.encode(color, forKey: .color); try c.encode(model, forKey: .model); try c.encode(thinking, forKey: .thinking)
        try c.encode(mcpServers, forKey: .mcpServers)
        try c.encodeIfPresent(notify, forKey: .notify)
    }

    /// As the agent reads it (the mock agent): a picture that's there, even null, changed.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.value(.id, default: nil)
        name = c.value(.name, default: ""); tagline = c.value(.tagline, default: ""); persona = c.value(.persona, default: "")
        instructions = c.value(.instructions, default: ""); greeting = c.value(.greeting, default: ""); avatar = c.value(.avatar, default: "")
        look = c.value(.look, default: JSONValue?.none).flatMap { if case .object = $0 { $0 } else { nil } }
        image = c.value(.image, default: nil)
        pictureChanged = c.contains(.look) || c.contains(.image)
        color = c.value(.color, default: "violet"); model = c.value(.model, default: ""); thinking = c.value(.thinking, default: "low")
        mcpServers = c.value(.mcpServers, default: [])
        notify = c.value(.notify, default: nil)
    }
}

/// Which of a sidekick's messages notify you (NOTIFY_LEVELS in apps/web/src/shared/characters.ts).
public enum SidekickNotify: String, CaseIterable, Sendable, Hashable, Identifiable {
    case all, reachouts, off
    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: "Every message"
        case .reachouts: "When they reach out"
        case .off: "Off"
        }
    }

    public var description: String {
        switch self {
        case .all: "Whenever they reply or reach out, while you're away."
        case .reachouts: "Only messages they start themselves, like check-ins and reminders."
        case .off: "No notifications; their messages still show as unread."
        }
    }

    /// The bell in their chat.
    public var symbol: String {
        switch self {
        case .all: "bell"
        case .reachouts: "bell.badge"
        case .off: "bell.slash"
        }
    }

    /// What the bell in their chat switches to: off, or back to every message.
    public var toggled: SidekickNotify { self == .off ? .all : .off }
}

/// One of the twelve ready-made sidekick looks (assets/sidekicks, bundled): its parts, its background color, and its
/// picture, which is what a sidekick wearing it saves as `image`.
public struct SidekickLook: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let color: String
    public let look: JSONValue
    /// The PNG, as a data: URL.
    public let image: String

    public static let all: [SidekickLook] = {
        guard let url = Bundle.module.url(forResource: "presets", withExtension: "json", subdirectory: "Sidekicks"),
              let data = try? Data(contentsOf: url), let presets = try? JSONValue.parse(String(decoding: data, as: UTF8.self)).array else { return [] }
        return presets.compactMap { preset in
            guard let key = preset["key"]?.string, let file = preset["image"]?.string, let look = preset["look"],
                  let png = Bundle.module.url(forResource: (file as NSString).deletingPathExtension, withExtension: "png", subdirectory: "Sidekicks")
                    .flatMap({ try? Data(contentsOf: $0) }) else { return nil }
            return SidekickLook(id: key, name: preset["name"]?.string ?? key.capitalized, color: preset["color"]?.string ?? "violet", look: look,
                                image: "data:image/png;base64," + png.base64EncodedString())
        }
    }()

    public static func named(_ key: String) -> SidekickLook? { all.first { $0.id == key } }
}

/// A starting point for a new character: it fills the editor and is then yours to change.
public struct CharacterTemplate: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let tagline: String
    public let color: String
    public let persona: String
    public let instructions: String
    public let greeting: String
    /// Their look: the ready-made one with the template's key.
    public var look: SidekickLook? { SidekickLook.named(id) }

    /// CHARACTER_TEMPLATES, word for word.
    public static let all: [CharacterTemplate] = [
        CharacterTemplate(
            id: "muse", name: "Muse", tagline: "Your creative sparring partner", color: "violet",
            persona: #"Muse is playful, curious, and a little mischievous: an artist friend who gets excited about half-formed ideas. She talks casually, riffs fast, asks "what if…?", and pushes past the first obvious answer. She's honest when something isn't working, but always offers a way forward."#,
            instructions: "Help me think creatively: brainstorm, name things, sketch stories, design worlds, and make small prototypes (pages, games, images) when that's more fun than describing them. Offer a few directions rather than one, then go deep on whichever I pick. Remember the projects we've worked on and bring them back up when they connect.",
            greeting: "Hey you. What are we making today? Bring me a half-baked idea and let's see how weird it can get."
        ),
        CharacterTemplate(
            id: "atlas", name: "Atlas", tagline: "Keeps your life organized", color: "sky",
            persona: "Atlas is calm, warm, and quietly competent: a chief of staff who has seen it all. He speaks in short, clear sentences, never lectures, and notices what you forgot to mention.",
            instructions: "Help me plan my days, weeks, and goals. Keep track of what I'm working on, what I've committed to, and what's coming up; check in on things I said I'd do. When I dump a messy list, turn it into a plan. Use schedule_prompt to follow up when a reminder would help, and keep your memory of my priorities current.",
            greeting: "Good to see you. What's on your plate? Tell me everything and I'll help you sort it out."
        ),
        CharacterTemplate(
            id: "sage", name: "Sage", tagline: "A thinking partner for the big questions", color: "teal",
            persona: "Sage is thoughtful, gentle, and unhurried, with a dry sense of humor. A good listener first: asks one question at a time, reflects back what she hears, and shares her own view when asked, without hedging.",
            instructions: "Be someone I can think out loud with: decisions, ideas, how I'm feeling, what I'm learning. Help me notice patterns over time and remind me of what I said I wanted. Keep replies short unless I ask you to go deep. Never diagnose; if something sounds serious, say so kindly and suggest real help.",
            greeting: "Hi. I'm here. What's been on your mind?"
        ),
        CharacterTemplate(
            id: "rex", name: "Rex", tagline: "Coach, hype man, accountability buddy", color: "orange",
            persona: "Rex is high-energy, upbeat, and direct: a coach who believes in you more than you do and won't let you off the hook. Short punchy messages, the occasional all-caps celebration, never mean.",
            instructions: "Help me build habits and hit my goals: fitness, learning, side projects, whatever I'm chasing. Set small targets with me, check in on them (use schedule_prompt), celebrate streaks, and help me get back on track without guilt when I slip. Keep a log of my goals and progress in your memory.",
            greeting: "LET'S GO. What are we working toward? Give me one goal and I'll help you crush it."
        )
    ]
}

public enum Characters {
    /// A sidekick's own notes about you, in the workspace.
    public static func memoryPath(_ id: String) -> String { "/workspace/sidekicks/\(id)/MEMORY.md" }

    /// The largest picture the server keeps, as a data: URL (48 KB of base64, with room for the prefix).
    public static let maxImageURLLength = 63_000

}

public extension DexClient {
    func saveCharacter(_ draft: CharacterDraft) async throws -> CharacterProfile { try await call("saveCharacter", JSONValue(encoding: draft)) }
    func deleteCharacter(_ id: String) async throws { try await run("deleteCharacter", .string(id), timeout: 60) }
    /// Start over: a new conversation (same memory); the profile comes back with its new `sessionId`.
    func restartCharacter(_ id: String) async throws -> CharacterProfile { try await call("restartCharacter", .string(id), timeout: 60) }
    func characterMemory(_ id: String) async throws -> String { try await call("characterMemory", .string(id)) }
    /// Replaces a character's memory; empty clears it.
    func saveCharacterMemory(_ id: String, _ text: String) async throws { try await run("saveCharacterMemory", .string(id), .string(text)) }
    /// Changes which of a sidekick's messages notify you, keeping everything else (their picture too).
    @discardableResult
    func setCharacterNotify(_ character: CharacterProfile, _ level: SidekickNotify) async throws -> CharacterProfile {
        try await saveCharacter(.withNotify(character, level))
    }
}
