package dev.trydex.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.util.Base64

/**
 * A sidekick (`character` in code and on the wire): a named companion with one long conversation of their own, pinned
 * above the chats (CharacterProfile in apps/web/src/shared/characters.ts). Their conversation is an ordinary chat
 * (`SessionMeta.characterId`).
 */
@Serializable
data class CharacterProfile(
    val id: String,
    val name: String = "",
    /** One line under the name in the chat list. */
    val tagline: String = "",
    /** Who they are: personality, voice, backstory ("Character profile" in the editor). */
    val persona: String = "",
    /** What they do for you, and their rules ("Prompt" in the editor). */
    val instructions: String = "",
    /** Their first words, shown at the top of the conversation. */
    val greeting: String = "",
    /** An emoji, from before sidekicks had looks; empty shows the name's first letter. */
    val avatar: String = "",
    /** Their little character, drawn from parts (the web draws it; the app shows [image]). Missing on older ones. */
    val look: SidekickLook? = null,
    /** A picture as a data: URL: a photo, or the PNG of their look. Shown instead of the emoji. */
    val image: String? = null,
    /** One of the agent colors (Catalogs.AGENT_COLORS). */
    val color: String = "violet",
    val model: String = DEFAULT_MODEL_ID,
    val thinking: ThinkingLevel = DEFAULT_THINKING,
    val mcpServers: List<String> = emptyList(),
    /** Which of their messages notify you: "all", "reachouts" (only ones they start themselves), or "off". */
    val notify: String = SidekickNotify.All.id,
    /** Their conversation now; Start over replaces it and the old one stays readable. */
    val sessionId: String = "",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
) {
    /** What their avatar shows without a picture: the emoji, else the name's initial. */
    val face: String get() = avatar.ifEmpty { Characters.initial(name) }

    /** [notify] as a level (anything unknown, from a newer agent, reads as every message). */
    val notifyLevel: SidekickNotify get() = SidekickNotify.fromId(notify)
}

/** Which of a sidekick's messages notify you (NOTIFY_LEVELS and NOTIFY_LABELS in apps/web/src/shared/characters.ts). */
enum class SidekickNotify(val id: String, val label: String, val description: String) {
    All("all", "Every message", "Whenever they reply or reach out, while you're away."),
    Reachouts("reachouts", "When they reach out", "Only messages they start themselves, like check-ins and reminders."),
    Off("off", "Off", "No notifications; their messages still show as unread.");

    companion object {
        fun fromId(id: String?): SidekickNotify = entries.firstOrNull { it.id == id } ?: All
    }
}

/** A sidekick's look: one of each part (SidekickLook in apps/web/src/shared/sidekick-look.ts). */
@Serializable
data class SidekickLook(
    val body: String = "blob",
    val skin: String = "",
    val eyes: String = "",
    val mouth: String = "",
    val extra: String = "",
    val blush: Boolean = false,
)

/**
 * One of the ready-made looks (assets/sidekicks, bundled here): its name, background color, parts, and the PNG of it,
 * which is what a sidekick saves as its `image`.
 */
@Serializable
data class SidekickPreset(val key: String, val name: String = "", val color: String = "violet", val look: SidekickLook = SidekickLook(), val image: String = "") {
    /** The PNG as the data: URL a sidekick's `image` takes. */
    val dataUrl: String by lazy {
        val bytes = SidekickPreset::class.java.getResourceAsStream("/dev/trydex/core/model/sidekicks/$image")!!.use { it.readBytes() }
        "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes)
    }

    /** This look on a draft: its color, parts, and picture. */
    fun applyTo(draft: CharacterProfile) = draft.copy(color = color, look = look, image = dataUrl, avatar = "")
}

/** A starting point for a new sidekick; it fills the editor (look included) and is then yours to change. */
data class CharacterTemplate(
    val key: String,
    val name: String,
    val tagline: String,
    val persona: String,
    val instructions: String,
    val greeting: String,
) {
    /** The ready-made look of the same name. */
    val preset: SidekickPreset get() = Characters.preset(key)!!

    /** This template applied to a draft, keeping the draft's model, thinking, and MCP servers. */
    fun applyTo(draft: CharacterProfile) = preset.applyTo(
        draft.copy(name = name, tagline = tagline, persona = persona, instructions = instructions, greeting = greeting),
    )
}

object Characters {
    /** A sidekick's own notes about you, in the workspace. */
    fun memoryPath(id: String) = "/workspace/sidekicks/$id/MEMORY.md"

    const val MAX_MEMORY_CHARS = 8_000

    /** The name's first letter, uppercased ("?" for no name). */
    fun initial(name: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return "?"
        return String(Character.toChars(trimmed.codePointAt(0))).uppercase()
    }

    /** The twelve ready-made looks, in the web's order (assets/sidekicks/presets.json). */
    val PRESETS: List<SidekickPreset> by lazy {
        val text = SidekickPreset::class.java.getResourceAsStream("/dev/trydex/core/model/sidekicks/presets.json")!!.bufferedReader().use { it.readText() }
        DexJson.decodeFromString(ListSerializer(SidekickPreset.serializer()), text)
    }

    fun preset(key: String): SidekickPreset? = PRESETS.firstOrNull { it.key == key }

    /** The ready-made look a sidekick has, if it's one of them (custom looks and photos aren't). */
    fun presetOf(character: CharacterProfile): SidekickPreset? = character.look?.let { look -> PRESETS.firstOrNull { it.look == look } }

    /** CHARACTER_TEMPLATES in apps/web/src/shared/characters.ts, word for word; each wears the preset of its name. */
    val TEMPLATES = listOf(
        CharacterTemplate(
            key = "muse",
            name = "Muse",
            tagline = "Your creative sparring partner",
            persona = "Muse is playful, curious, and a little mischievous: an artist friend who gets excited about half-formed ideas. She talks casually, riffs fast, asks \"what if…?\", and pushes past the first obvious answer. She's honest when something isn't working, but always offers a way forward.",
            instructions = "Help me think creatively: brainstorm, name things, sketch stories, design worlds, and make small prototypes (pages, games, images) when that's more fun than describing them. Offer a few directions rather than one, then go deep on whichever I pick. Remember the projects we've worked on and bring them back up when they connect.",
            greeting = "Hey you. What are we making today? Bring me a half-baked idea and let's see how weird it can get.",
        ),
        CharacterTemplate(
            key = "atlas",
            name = "Atlas",
            tagline = "Keeps your life organized",
            persona = "Atlas is calm, warm, and quietly competent: a chief of staff who has seen it all. He speaks in short, clear sentences, never lectures, and notices what you forgot to mention.",
            instructions = "Help me plan my days, weeks, and goals. Keep track of what I'm working on, what I've committed to, and what's coming up; check in on things I said I'd do. When I dump a messy list, turn it into a plan. Use schedule_prompt to follow up when a reminder would help, and keep your memory of my priorities current.",
            greeting = "Good to see you. What's on your plate? Tell me everything and I'll help you sort it out.",
        ),
        CharacterTemplate(
            key = "sage",
            name = "Sage",
            tagline = "A thinking partner for the big questions",
            persona = "Sage is thoughtful, gentle, and unhurried, with a dry sense of humor. A good listener first: asks one question at a time, reflects back what she hears, and shares her own view when asked, without hedging.",
            instructions = "Be someone I can think out loud with: decisions, ideas, how I'm feeling, what I'm learning. Help me notice patterns over time and remind me of what I said I wanted. Keep replies short unless I ask you to go deep. Never diagnose; if something sounds serious, say so kindly and suggest real help.",
            greeting = "Hi. I'm here. What's been on your mind?",
        ),
        CharacterTemplate(
            key = "rex",
            name = "Rex",
            tagline = "Coach, hype man, accountability buddy",
            persona = "Rex is high-energy, upbeat, and direct: a coach who believes in you more than you do and won't let you off the hook. Short punchy messages, the occasional all-caps celebration, never mean.",
            instructions = "Help me build habits and hit my goals: fitness, learning, side projects, whatever I'm chasing. Set small targets with me, check in on them (use schedule_prompt), celebrate streaks, and help me get back on track without guilt when I slip. Keep a log of my goals and progress in your memory.",
            greeting = "LET'S GO. What are we working toward? Give me one goal and I'll help you crush it.",
        ),
    )

    /** Their conversations, newest first: the current one and any from before Start over. */
    fun conversations(state: DexState, character: CharacterProfile): List<SessionMeta> =
        state.sessions.filter { it.characterId == character.id }.sortedByDescending { it.createdAt }
}
