/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm"
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url"
import glueUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url"
import { modelUrl, type Utterance, VOICES, type Voice } from "~/shared/voice"

/**
 * Runs tiny-voca off the page's thread: loads the model once (kept in the browser's cache storage, so later calls
 * start without the download) and turns utterances into audio. Messages in: load, speak. Out: progress, ready,
 * audio (one per utterance, as soon as it's made), done, error.
 */
export type TtsRequest = { type: "load" } | { type: "speak"; id: number; utterances: ReadonlyArray<Utterance>; voice: Voice; speed?: number }
export type TtsReply =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "audio"; id: number; samples: Float32Array }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string }

declare const self: DedicatedWorkerGlobalScope
const post = (reply: TtsReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer)

const CACHE = "dex-voice"

/** The model's bytes, from cache storage when this browser has them. */
async function modelBytes(): Promise<Uint8Array> {
  const url = modelUrl("model.onnx")
  let cache: Cache | undefined
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) return new Uint8Array(await hit.arrayBuffer())
  } catch {
    cache = undefined
  }
  const response = await fetch(url, { credentials: "same-origin" })
  if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Sign in again to use calls." : `Couldn't download the voice (${response.status}).`)
  const total = Number(response.headers.get("content-length")) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    post({ type: "progress", loaded, total })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  // Older versions of the model go: only this revision's address is kept.
  if (cache) {
    for (const request of await cache.keys().catch(() => [])) if (request.url !== new URL(url, self.location.href).href) void cache.delete(request)
    void cache.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => undefined)
  }
  return bytes
}

let session: Promise<ort.InferenceSession> | undefined

const load = () => {
  session ??= (async () => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: glueUrl }
    // Threads need a cross-origin isolated page, which Dex isn't; one thread runs the model many times faster than speech.
    ort.env.wasm.numThreads = 1
    return ort.InferenceSession.create(await modelBytes(), { executionProviders: ["wasm"] })
  })().catch((error: unknown) => {
    session = undefined
    throw error
  })
  return session
}

/** The model can peak a little above 1.0; scaled down then, so it never clips. */
const PEAK = 0.99
const limitPeak = (samples: Float32Array) => {
  let loudest = 0
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample))
  if (loudest > PEAK) for (let index = 0; index < samples.length; index++) samples[index]! *= PEAK / loudest
}

async function synthesize(model: ort.InferenceSession, utterance: Utterance, voice: Voice, speed: number) {
  const count = utterance.ids.length
  const integers = (values: readonly number[]) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, count])
  const scalar = (value: number) => new ort.Tensor("float32", Float32Array.of(value), [1])
  const output = await model.run({
    tokens: integers(utterance.ids),
    stress: integers(utterance.stress),
    voice: new ort.Tensor("int64", BigInt64Array.of(BigInt(Math.max(0, VOICES.indexOf(voice)))), [1]),
    speed: scalar(speed),
    pitch_shift: scalar(0),
    pitch_range: scalar(1)
  })
  const samples = new Float32Array(output.audio!.data as Float32Array)
  limitPeak(samples)
  return samples
}

self.onmessage = async ({ data }: MessageEvent<TtsRequest>) => {
  const id = data.type === "speak" ? data.id : undefined
  try {
    const model = await load()
    if (data.type === "load") return post({ type: "ready" })
    for (const utterance of data.utterances) {
      const samples = await synthesize(model, utterance, data.voice, data.speed ?? 1)
      post({ type: "audio", id: data.id, samples }, [samples.buffer])
    }
    post({ type: "done", id: data.id })
  } catch (error) {
    post({ type: "error", id, message: error instanceof Error ? error.message : String(error) })
  }
}
