/**
 * Skills: instructions for a kind of task (a SKILL.md, plus any files beside it), installed from skills.sh or written
 * by hand. A chat uses one when you start a message with `/<name>`, or on its own when the skill is set to auto and
 * a request matches its description.
 */

export interface SkillInfo {
  /** Its name, also what you type after `/`. */
  readonly id: string
  readonly description: string
  /** GitHub `owner/repo` it was installed from; null for one written in Dex. */
  readonly source: string | null
  /** Its folder in that repo. */
  readonly path: string | null
  /** Whether chats may load it on their own when a request matches; otherwise only `/<name>` uses it. */
  readonly auto: boolean
  /** Files beside SKILL.md (references, scripts, examples). */
  readonly files: number
  readonly size: number
  readonly installedAt: number
  readonly updatedAt: number
}

export interface SkillFile {
  readonly path: string
  readonly content: string
}

/** A skill with its instructions, for viewing or editing. */
export interface SkillDetail extends SkillInfo {
  readonly instructions: string
  readonly fileList: ReadonlyArray<{ readonly path: string; readonly size: number }>
}

/** A search result from skills.sh. */
export interface DirectorySkill {
  /** `owner/repo/skill`. */
  readonly id: string
  readonly source: string
  readonly skillId: string
  readonly name: string
  readonly installs: number
}

/** What installing a skill would add, read from its repo before you install it. */
export interface SkillPreview {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly source: string
  readonly path: string
  readonly url: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly size: number }>
  readonly size: number
}

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/** A message that starts with `/<name>` asks for that skill. */
export const invokedSkill = (text: string): string | null => /^\/([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/.exec(text.trimStart())?.[1] ?? null

export const skillSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

const unquote = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.startsWith('"') ? trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n") : trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

/**
 * Splits a SKILL.md into its frontmatter's top-level text fields (plain, quoted, and `|` / `>` blocks: enough for
 * `name` and `description`) and the instructions after it.
 */
export function parseSkillMarkdown(markdown: string): { readonly fields: Readonly<Record<string, string>>; readonly body: string } {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (!match) return { fields: {}, body: text.trim() }
  const fields: Record<string, string> = {}
  const lines = match[1]!.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const field = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[index]!)
    if (!field) continue
    const [, key, raw] = field as unknown as [string, string, string]
    const block = /^([|>])[+-]?\s*$/.exec(raw)
    if (block || raw === "") {
      const collected: string[] = []
      while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]!) || lines[index + 1] === "")) collected.push(lines[++index]!)
      const indent = Math.min(...collected.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length))
      const content = collected.map((line) => line.slice(Number.isFinite(indent) ? indent : 0))
      // Nested maps (metadata:) aren't text fields.
      if (!block && content.some((line) => /^[\w-]+:/.test(line))) continue
      fields[key] = (block?.[1] === "|" ? content.join("\n") : content.join(" ").replace(/\s+/g, " ")).trim()
    } else {
      fields[key] = unquote(raw)
    }
  }
  return { fields, body: text.slice(match[0].length).trim() }
}

export const formatInstalls = (count: number) =>
  count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1_000 ? `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K` : String(count)
