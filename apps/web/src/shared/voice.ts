/**
 * Voice calls with sidekicks. Each app speaks with tiny-voca (https://huggingface.co/n4ze3m/tiny-voca), a 4.5M-parameter
 * English text-to-speech model, run on the device: Dex serves its files (/api/voice/model/<file>) and turns text
 * into the phoneme ids it reads (/api/voice/phonemes, with dizione ported in src/server/voice). Listening is the
 * device's own speech recognition. What you say goes into the sidekick's conversation like a typed message, marked
 * as spoken, and the reply is read aloud a sentence at a time as it streams in.
 */

/** tiny-voca's two voices: its `voice` input is the index. */
export const VOICES = ["F2", "M2"] as const
export type Voice = (typeof VOICES)[number]

export const VOICE_LABELS: Record<Voice, string> = { F2: "Bright (female)", M2: "Warm (male)" }

/** A sidekick without a voice of their own gets one from their name, so it stays the same from call to call. */
export const voiceOf = (character: { readonly id: string; readonly voice?: Voice | null }): Voice => {
  if (character.voice && VOICES.includes(character.voice)) return character.voice
  let hash = 0
  for (const char of character.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return VOICES[hash % VOICES.length]!
}

/**
 * The Hugging Face revision of tiny-voca Dex uses: the model and its phonemizer data must stay a matched pair. Apps
 * put it in the model's address, so a new revision is a new file to their caches.
 */
export const TINY_VOCA_REVISION = "e5f9b11651a4db525fb207a56a91e4df2d1dd387"

/** Where an app downloads one of tiny-voca's files (signed in). */
export const modelUrl = (file: "model.onnx" | "config.json") => `/api/voice/model/${file}?v=${TINY_VOCA_REVISION.slice(0, 12)}`

/** The model's sample rate (config.json `sample_rate`). */
export const VOICE_SAMPLE_RATE = 24_000

/** The longest text one phonemes request takes. */
export const MAX_SPOKEN_CHARS = 4_000

/** One piece the model reads in a call: up to 512 phonemes (config.json `max_tokens`) with their stress. */
export interface Utterance {
  readonly ids: number[]
  readonly stress: number[]
  /** The phonemes as text, for debugging. */
  readonly phonemes: string
}

/** /api/voice/phonemes: `{ text }` in, each sentence's utterances out (none for a sentence with nothing to say). */
export interface PhonemesResponse {
  readonly sentences: ReadonlyArray<{ readonly text: string; readonly utterances: ReadonlyArray<Utterance> }>
}

const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$/i

/**
 * Sentences, without breaking after titles, initials, or inside numbers. The same rule as tiny-voca's own
 * (`tiny_voca.infer.sentences`, and its web demo's worker.js).
 */
export function sentences(text: string): string[] {
  const parts: string[] = []
  let current = ""
  for (const piece of text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…]["')\]]?)\s+(?=["'([]?[A-Z0-9])/)) {
    current = current ? `${current} ${piece}` : piece
    if (!ABBREVIATIONS.test(current)) {
      parts.push(current)
      current = ""
    }
  }
  if (current) parts.push(current)
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part))
}

/**
 * The text with a full stop when it ends without a mark: before one the voice lets the last syllable fall, without
 * one the audio breaks off. A face or sign after the last word ("see you :)") is no mark; a comma or colon is.
 * The same rule as `tiny_voca.infer.finished`.
 */
export function finished(text: string): string {
  const body = text.replace(/\s+$/, "")
  if (!body) return text
  const last = body.split(/\s+/).pop()!
  const marked = /[\p{L}\p{N}]/u.test(last) ? /[.!?…,;:]["'”’)\]»]*$/.test(last) : /[.!?…]/.test(last) || /^[,;:]$/.test(last)
  return marked ? text : `${body}.`
}

/**
 * What of a reply's Markdown can be read aloud: code, tables, images, and UI cards are left out, links read as their
 * text, and the marks around words go.
 */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1.")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/gm, (_, item: string) => finished(item))
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~\n]+?)\1/g, "$2")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

/**
 * Cuts a reply into sentences while it streams: `take` returns the sentences complete so far that haven't been
 * taken (a sentence is complete once text follows it), `rest` what's left once the reply has ended. A sentence can
 * look complete and then not for a moment (a list number arriving reads as one), so what's taken is tracked as text,
 * not as a count.
 */
export function sentenceStream() {
  let said = ""
  let last = ""
  const fresh = (list: string[]) => {
    const joined = list.join(" ")
    if (joined.length <= said.length) return []
    let start = 0
    const next = joined.startsWith(said)
      ? sentences(joined.slice(said.length))
      : // What was said changed shape: the sentences that begin after it.
        list.filter((sentence) => (start += sentence.length + 1) - sentence.length - 1 >= said.length)
    said = joined
    return next
  }
  return {
    take(text: string): string[] {
      last = text
      // The last sentence may still be growing.
      return fresh(sentences(speakable(text)).slice(0, -1))
    },
    rest(text = last): string[] {
      return fresh(sentences(speakable(text)))
    }
  }
}
