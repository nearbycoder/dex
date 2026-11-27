import { finished, sentences, type PhonemesResponse, TINY_VOCA_REVISION, type Utterance } from "~/shared/voice"
import { type Dizione, loadDizione } from "./dizione"

/** tiny-voca's files at the pinned revision (config.json there records the dizione build src/server/voice/dizione ports). */
const BASE = `https://huggingface.co/n4ze3m/tiny-voca/resolve/${TINY_VOCA_REVISION}`

/** The files the apps download, by the name they ask for. */
export const MODEL_FILES: Readonly<Record<string, { readonly path: string; readonly type: string }>> = {
  "model.onnx": { path: "onnx/model.onnx", type: "application/octet-stream" },
  "config.json": { path: "config.json", type: "application/json" }
}

/** At most this many phonemes per utterance: the model's 512, less room for the start and end tokens. */
const MAX_TOKENS = 512 - 12

/** A file from the pinned revision. It never changes, so Cloudflare's cache keeps it. */
export const fetchModelFile = (path: string) =>
  fetch(`${BASE}/${path}`, {
    headers: { "user-agent": "dex/1.0" },
    signal: AbortSignal.timeout(30_000),
    cf: { cacheTtl: 365 * 86_400, cacheEverything: true }
  })

let dizione: Promise<Dizione> | undefined

/** The phonemizer, loaded once per isolate (a failed load is tried again on the next request). */
const phonemizer = () => {
  dizione ??= loadDizione(async (name) => {
    const response = await fetchModelFile(`phonemizer/${name}`)
    if (!response.ok) {
      void response.body?.cancel()
      throw new Error(`tiny-voca phonemizer/${name}: ${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }).catch((error: unknown) => {
    dizione = undefined
    throw error
  })
  return dizione
}

/**
 * One sentence as utterances the model can read: cut at commas, then between words, when it has more phonemes than
 * one utterance holds (tiny-voca's web demo does the same). A sentence with nothing to pronounce gives none.
 */
const fit = (phonemes: Dizione, sentence: string): Utterance[] => {
  const result = phonemes.phonemize(sentence)
  if (!result) return []
  if (result.ids.length <= MAX_TOKENS) return [{ ids: result.ids, stress: result.stress, phonemes: result.text }]
  const pieces = sentence.split(/(?<=[,;:—])\s+/)
  if (pieces.length > 1) return pieces.flatMap((piece) => fit(phonemes, piece))
  const words = sentence.split(" ")
  if (words.length < 2) return []
  const half = Math.ceil(words.length / 2)
  return [...fit(phonemes, words.slice(0, half).join(" ")), ...fit(phonemes, words.slice(half).join(" "))]
}

/** Text as the model's input, a sentence at a time. */
export async function phonemesFor(text: string): Promise<PhonemesResponse> {
  const phonemes = await phonemizer()
  return {
    sentences: sentences(finished(text)).map((sentence) => {
      try {
        return { text: sentence, utterances: fit(phonemes, finished(sentence)) }
      } catch (error) {
        // One sentence the phonemizer can't read shouldn't silence the rest.
        console.error("Phonemizer:", error)
        return { text: sentence, utterances: [] }
      }
    })
  }
}
