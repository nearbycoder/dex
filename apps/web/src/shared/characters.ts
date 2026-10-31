import type { AgentColor } from "./agents"
import type { ThinkingLevel } from "./models"
import { LOOK_PRESETS, type SidekickLook } from "./sidekick-look"

/**
 * A sidekick (`character` in code and the protocol): a named companion with one long conversation of their own, pinned in the sidebar. Its conversation is
 * an ordinary chat (`SessionMeta.characterId`), so everything a chat can do, theirs can.
 */
export interface CharacterProfile {
  readonly id: string
  readonly name: string
  /** One line under the name in the sidebar. */
  readonly tagline: string
  /** Who they are: personality, voice, backstory. Their system prompt says this instead of "You are Dex". */
  readonly persona: string
  /** What they do for you, and their rules. */
  readonly instructions: string
  /** Their first words, shown while the conversation is empty. */
  readonly greeting: string
  /** An emoji, from before sidekicks had looks; empty shows the name's first letter. */
  readonly avatar: string
  /** Their little character, drawn from parts. Missing on ones saved before looks existed. */
  readonly look?: SidekickLook | null
  /**
   * A picture as a data: URL: a photo, or the PNG of their look for apps that don't draw looks themselves. With a
   * look, the look wins where it can be drawn.
   */
  readonly image: string | null
  readonly color: AgentColor
  readonly model: string
  readonly thinking: ThinkingLevel
  readonly mcpServers: ReadonlyArray<string>
  /** Which of their messages notify you: all of them, only ones they start themselves (check-ins), or none. */
  readonly notify?: SidekickNotify
  /** Their conversation now; Start over replaces it and the old one stays readable. */
  readonly sessionId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type CharacterDraft = Omit<CharacterProfile, "id" | "sessionId" | "createdAt" | "updatedAt" | "mcpServers" | "image" | "look" | "notify"> & {
  readonly notify?: SidekickNotify
  readonly id?: string
  readonly mcpServers?: ReadonlyArray<string>
  /** Left out keeps the picture; null removes it. */
  readonly image?: string | null
  /** Left out keeps the look; null removes it. */
  readonly look?: SidekickLook | null
}

const presetLook = (key: string) => LOOK_PRESETS.find((preset) => preset.key === key)!.look

export const NOTIFY_LEVELS = ["all", "reachouts", "off"] as const
export type SidekickNotify = (typeof NOTIFY_LEVELS)[number]
export const NOTIFY_LABELS: Record<SidekickNotify, { readonly label: string; readonly description: string }> = {
  all: { label: "Every message", description: "Whenever they reply or reach out, while you're away." },
  reachouts: { label: "When they reach out", description: "Only messages they start themselves, like check-ins and reminders." },
  off: { label: "Off", description: "No notifications; their messages still show as unread." }
}

/** A character's own notes about you, in the workspace. */
export const characterMemoryPath = (id: string) => `/workspace/sidekicks/${id}/MEMORY.md`

export const MAX_CHARACTER_MEMORY_CHARS = 8_000

/** Starting points for a new character; each fills the editor and is then yours to change. */
export const CHARACTER_TEMPLATES: ReadonlyArray<Omit<CharacterDraft, "model" | "thinking"> & { readonly key: string }> = [
  {
    key: "muse",
    name: "Muse",
    tagline: "Your creative sparring partner",
    avatar: "",
    look: presetLook("muse"),
    color: "violet",
    persona: `Muse is playful, curious, and a little mischievous: an artist friend who gets excited about half-formed ideas. She talks casually, riffs fast, asks "what if…?", and pushes past the first obvious answer. She's honest when something isn't working, but always offers a way forward.`,
    instructions: `Help me think creatively: brainstorm, name things, sketch stories, design worlds, and make small prototypes (pages, games, images) when that's more fun than describing them. Offer a few directions rather than one, then go deep on whichever I pick. Remember the projects we've worked on and bring them back up when they connect.`,
    greeting: "Hey you. What are we making today? Bring me a half-baked idea and let's see how weird it can get."
  },
  {
    key: "atlas",
    name: "Atlas",
    tagline: "Keeps your life organized",
    avatar: "",
    look: presetLook("atlas"),
    color: "sky",
    persona: `Atlas is calm, warm, and quietly competent: a chief of staff who has seen it all. He speaks in short, clear sentences, never lectures, and notices what you forgot to mention.`,
    instructions: `Help me plan my days, weeks, and goals. Keep track of what I'm working on, what I've committed to, and what's coming up; check in on things I said I'd do. When I dump a messy list, turn it into a plan. Use schedule_prompt to follow up when a reminder would help, and keep your memory of my priorities current.`,
    greeting: "Good to see you. What's on your plate? Tell me everything and I'll help you sort it out."
  },
  {
    key: "sage",
    name: "Sage",
    tagline: "A thinking partner for the big questions",
    avatar: "",
    look: presetLook("sage"),
    color: "teal",
    persona: `Sage is thoughtful, gentle, and unhurried, with a dry sense of humor. A good listener first: asks one question at a time, reflects back what she hears, and shares her own view when asked, without hedging.`,
    instructions: `Be someone I can think out loud with: decisions, ideas, how I'm feeling, what I'm learning. Help me notice patterns over time and remind me of what I said I wanted. Keep replies short unless I ask you to go deep. Never diagnose; if something sounds serious, say so kindly and suggest real help.`,
    greeting: "Hi. I'm here. What's been on your mind?"
  },
  {
    key: "rex",
    name: "Rex",
    tagline: "Coach, hype man, accountability buddy",
    avatar: "",
    look: presetLook("rex"),
    color: "orange",
    persona: `Rex is high-energy, upbeat, and direct: a coach who believes in you more than you do and won't let you off the hook. Short punchy messages, the occasional all-caps celebration, never mean.`,
    instructions: `Help me build habits and hit my goals: fitness, learning, side projects, whatever I'm chasing. Set small targets with me, check in on them (use schedule_prompt), celebrate streaks, and help me get back on track without guilt when I slip. Keep a log of my goals and progress in your memory.`,
    greeting: "LET'S GO. What are we working toward? Give me one goal and I'll help you crush it."
  }
]
