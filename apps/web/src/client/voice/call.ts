import { type PhonemesResponse, sentenceStream, type Voice, VOICE_SAMPLE_RATE } from "~/shared/voice"
import type { TtsReply, TtsRequest } from "./tts.worker"

/**
 * One voice call with a sidekick, in the browser: speech recognition hears you, what you say goes to their
 * conversation (`send`), and their reply, fed in with `reply()` as it streams, is spoken a sentence at a time by
 * tiny-voca in a worker. Talking over them stops them. See shared/voice.ts for the whole picture.
 */
export type CallPhase = "starting" | "listening" | "thinking" | "speaking" | "ended" | "failed"

export interface CallSnapshot {
  readonly phase: CallPhase
  /** What you're saying now (recognition's running guess), or just said. */
  readonly heard: string
  /** The sentence they're saying. */
  readonly saying: string
  readonly muted: boolean
  /** The voice's first download, 0 to 1, while it's under way. */
  readonly downloading: number | null
  readonly error: string | null
}

/** The reply after your latest words, as the chat has it now. `key` changes when a new reply starts. */
export interface CallReply {
  readonly key: string
  readonly text: string
  readonly done: boolean
}

// The Web Speech API's recognition, which TypeScript's DOM types leave out (Chrome and Safari prefix it).
interface Recognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onspeechstart: (() => void) | null
}
type RecognitionClass = new () => Recognition

const recognitionClass = (): RecognitionClass | undefined => {
  if (typeof window === "undefined") return undefined
  const scope = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

/** Whether this browser can hear you (Chrome, Edge, and Safari can; Firefox can't). */
export const canCall = () => Boolean(recognitionClass()) && typeof Worker !== "undefined" && typeof AudioContext !== "undefined"

/** How long after your last words a pause counts as the end of what you're saying. */
const END_OF_TURN_MS = 900
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

let worker: Worker | undefined
let ready: Promise<void> | undefined
const listeners = new Set<(reply: TtsReply) => void>()

/** The speech worker, shared by every call on the page and kept between calls (the model stays loaded). */
const speechWorker = (onProgress: (fraction: number) => void) => {
  if (!worker) {
    worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = ({ data }: MessageEvent<TtsReply>) => {
      for (const listener of listeners) listener(data)
    }
  }
  ready ??= new Promise<void>((resolve, reject) => {
    const listener = (reply: TtsReply) => {
      if (reply.type === "progress" && reply.total) onProgress(reply.loaded / reply.total)
      if (reply.type === "ready") resolve()
      if (reply.type === "error" && reply.id === undefined) reject(new Error(reply.message))
      if (reply.type === "ready" || (reply.type === "error" && reply.id === undefined)) listeners.delete(listener)
    }
    listeners.add(listener)
    worker!.postMessage({ type: "load" } satisfies TtsRequest)
  }).catch((error: unknown) => {
    ready = undefined
    throw error
  })
  return { worker, ready }
}

let nextRequest = 1

export class VoiceCall {
  private snapshot: CallSnapshot = { phase: "starting", heard: "", saying: "", muted: false, downloading: null, error: null }
  private readonly audio = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
  private readonly output: AnalyserNode
  private readonly playing = new Set<AudioBufferSourceNode>()
  private playAt = 0
  private recognition: Recognition | null = null
  private finalText = ""
  private interim = ""
  private turnTimer: ReturnType<typeof setTimeout> | undefined
  /** Bumped when they're cut off: work for an older reply is dropped. */
  private generation = 0
  private speech = Promise.resolve()
  private pending = 0
  private stream = sentenceStream()
  private replyKey: string | null = null
  private unsaid: string | null = null
  private seenChat = false
  private replyDone = true
  private waitingForReply = false
  /** What they said in the last while, so the microphone hearing the speaker isn't taken for you. */
  private recentlySaid: Array<{ words: string[]; at: number }> = []

  private readonly listeners = new Set<(snapshot: CallSnapshot) => void>()

  constructor(
    private readonly options: {
      readonly voice: Voice
      readonly send: (text: string) => Promise<void>
    }
  ) {
    this.output = this.audio.createAnalyser()
    this.output.fftSize = 512
    this.output.connect(this.audio.destination)
  }

  get state() {
    return this.snapshot
  }

  /** Calls `listener` whenever the call's state changes; returns the way to stop. */
  subscribe(listener: (snapshot: CallSnapshot) => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Starts the call. Call it from a tap or click: browsers allow sound and the microphone only then. */
  async start() {
    void this.audio.resume()
    this.listen()
    try {
      const { ready } = speechWorker((fraction) => this.update({ downloading: fraction }))
      await ready
      if (this.snapshot.phase === "ended") return
      this.update({ downloading: null, phase: this.waitingForReply ? "thinking" : "listening" })
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** The reply after your latest words; call it whenever the chat changes. */
  reply(reply: CallReply | null) {
    if (this.snapshot.phase === "ended" || this.snapshot.phase === "failed") return
    const first = !this.seenChat
    this.seenChat = true
    if (!reply) return
    // One you cut off (or the one there when the call began) stays unsaid, however much more of it streams in.
    if (reply.key === this.unsaid) return
    if (reply.key !== this.replyKey) {
      this.replyKey = reply.key
      this.stream = sentenceStream()
      if (first) {
        this.unsaid = reply.key
        return
      }
    }
    this.replyDone = reply.done
    const sentences = reply.done ? [...this.stream.take(reply.text), ...this.stream.rest(reply.text)] : this.stream.take(reply.text)
    if (sentences.length || reply.done) this.waitingForReply = false
    if (sentences.length) this.say(sentences.join(" "))
    this.settle()
  }

  setMuted(muted: boolean) {
    this.update({ muted })
    if (muted) this.recognition?.abort()
    else this.listen()
  }

  /** Stops everything. */
  end() {
    this.update({ phase: "ended" })
    this.generation++
    clearTimeout(this.turnTimer)
    this.silence()
    const recognition = this.recognition
    this.recognition = null
    recognition?.abort()
    void this.audio.close().catch(() => undefined)
  }

  /** How loud they are right now, 0 to 1, for the face. */
  level() {
    if (!this.playing.size) return 0
    const data = new Uint8Array(this.output.fftSize)
    this.output.getByteTimeDomainData(data)
    let sum = 0
    for (const value of data) sum += ((value - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / data.length) * 4)
  }

  private update(patch: Partial<CallSnapshot>) {
    // An ended call can still say why it failed, but never starts again.
    if ((this.snapshot.phase === "ended" || this.snapshot.phase === "failed") && patch.phase !== undefined && patch.phase !== "failed") return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private fail(message: string) {
    this.end()
    this.update({ phase: "failed", error: message })
  }

  // ── Hearing you ─────────────────────────────────────────────────────────────

  private listen() {
    if (this.recognition || this.snapshot.muted || this.snapshot.phase === "ended") return
    const Recognition = recognitionClass()
    if (!Recognition) return this.fail("This browser can't do speech recognition. Calls work in Chrome, Edge, and Safari.")
    const recognition = new Recognition()
    recognition.lang = "en-US"
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return
      let interim = ""
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]!
        const text = result[0]?.transcript ?? ""
        if (result.isFinal) {
          if (!this.isEcho(text)) this.finalText = `${this.finalText} ${text}`.trim()
        } else interim += text
      }
      this.interim = this.isEcho(interim) ? "" : interim.trim()
      const heard = `${this.finalText} ${this.interim}`.trim()
      if (!heard) return
      // You talking over them: they stop.
      if (this.speaking() && words(heard).length >= 2) this.cutOff()
      this.update({ heard })
      clearTimeout(this.turnTimer)
      this.turnTimer = setTimeout(() => this.endTurn(), END_OF_TURN_MS)
    }
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") this.fail("Dex needs the microphone for calls. Allow it in the browser's site settings.")
      else if (event.error === "audio-capture") this.fail("No microphone was found.")
      // "no-speech", "aborted", "network": recognition ends and starts again below.
    }
    // Recognition stops on its own now and then (after a silence, or a minute); keep it going for the whole call.
    recognition.onend = () => {
      if (this.recognition !== recognition) return
      this.recognition = null
      if (this.finalText || this.interim) this.endTurn()
      setTimeout(() => this.listen(), 250)
    }
    this.recognition = recognition
    try {
      recognition.start()
    } catch {
      this.recognition = null
    }
  }

  /** Whether recognized words are mostly what they've just been saying (the speaker heard through the microphone). */
  private isEcho(text: string) {
    const heard = words(text)
    if (!heard.length) return false
    const now = Date.now()
    this.recentlySaid = this.recentlySaid.filter((said) => now - said.at < 15_000)
    if (!this.speaking() && !this.recentlySaid.some((said) => now - said.at < 2_000)) return false
    const said = new Set(this.recentlySaid.flatMap((entry) => entry.words))
    return heard.filter((word) => said.has(word)).length / heard.length >= 0.6
  }

  /** You've stopped talking: what you said goes to them. */
  private endTurn() {
    clearTimeout(this.turnTimer)
    const text = `${this.finalText} ${this.interim}`.trim()
    this.finalText = ""
    this.interim = ""
    if (!text || this.snapshot.phase === "ended") return
    // Recognition may still deliver these words as a final result; a fresh session keeps them from being sent twice.
    const recognition = this.recognition
    this.recognition = null
    recognition?.abort()
    setTimeout(() => this.listen(), 250)
    this.cutOff()
    this.waitingForReply = true
    this.replyDone = false
    this.update({ heard: text, saying: "", phase: this.snapshot.downloading !== null ? "starting" : "thinking" })
    this.options.send(text).catch((error: unknown) => {
      this.waitingForReply = false
      this.update({ error: error instanceof Error ? error.message : "That didn't send.", phase: "listening" })
    })
  }

  // ── Their voice ─────────────────────────────────────────────────────────────

  private speaking() {
    return this.playing.size > 0 || this.pending > 0
  }

  /** Reads text out after whatever is already queued. */
  private say(text: string) {
    const generation = this.generation
    this.pending++
    this.update({ phase: "speaking" })
    this.speech = this.speech
      .then(async () => {
        if (generation !== this.generation) return
        const response = await fetch("/api/voice/phonemes", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text })
        })
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to use calls." : "Their voice isn't available right now.")
        const { sentences } = (await response.json()) as PhonemesResponse
        for (const sentence of sentences) {
          if (generation !== this.generation) return
          if (!sentence.utterances.length) continue
          await this.speak(sentence.text, sentence.utterances, generation)
        }
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        this.pending--
        this.settle()
      })
  }

  /** One sentence through the model, each piece played as it's made. */
  private speak(text: string, utterances: PhonemesResponse["sentences"][number]["utterances"], generation: number) {
    const { worker } = speechWorker(() => undefined)
    const id = nextRequest++
    return new Promise<void>((resolve) => {
      const listener = (reply: TtsReply) => {
        if (!("id" in reply) || reply.id !== id) return
        if (reply.type === "audio" && generation === this.generation) {
          this.recentlySaid.push({ words: words(text), at: Date.now() })
          // The caption changes when the sentence starts playing, not when it's made (synthesis runs ahead).
          const delay = this.play(reply.samples)
          setTimeout(() => generation === this.generation && this.update({ saying: text }), delay)
        }
        if (reply.type === "done" || reply.type === "error") {
          listeners.delete(listener)
          if (reply.type === "error") this.update({ error: reply.message })
          resolve()
        }
      }
      listeners.add(listener)
      worker.postMessage({ type: "speak", id, utterances, voice: this.options.voice } satisfies TtsRequest)
    })
  }

  /** Plays a piece right where the one before it ends, so sentences run on without gaps. */
  private play(samples: Float32Array): number {
    if (!samples.length || this.snapshot.phase === "ended") return 0
    const buffer = this.audio.createBuffer(1, samples.length, VOICE_SAMPLE_RATE)
    buffer.getChannelData(0).set(samples)
    const source = this.audio.createBufferSource()
    source.buffer = buffer
    source.connect(this.output)
    source.onended = () => {
      this.playing.delete(source)
      this.settle()
    }
    // A little lead, so a piece with nothing before it doesn't start late and overlap the next.
    const when = Math.max(this.playAt, this.audio.currentTime + 0.05)
    source.start(when)
    this.playAt = when + buffer.duration
    this.playing.add(source)
    // Milliseconds until it starts.
    return Math.max(0, (when - this.audio.currentTime) * 1000)
  }

  private silence() {
    for (const source of this.playing) {
      source.onended = null
      try {
        source.stop()
      } catch {}
    }
    this.playing.clear()
    this.playAt = 0
  }

  /** You spoke over them: the rest of their reply goes unsaid. */
  private cutOff() {
    if (!this.speaking()) return
    this.generation++
    this.silence()
    this.unsaid = this.replyKey
    this.replyDone = true
    this.update({ saying: "", phase: "listening" })
  }

  /** Back to listening once they've said everything and the reply is over. */
  private settle() {
    if (this.snapshot.phase === "ended" || this.snapshot.phase === "failed") return
    if (this.speaking()) return
    if (this.waitingForReply || !this.replyDone) {
      if (this.snapshot.phase !== "starting") this.update({ phase: "thinking", saying: "" })
      return
    }
    if (this.snapshot.phase !== "listening" && this.snapshot.phase !== "starting") this.update({ phase: "listening", saying: "" })
  }
}

/**
 * Says one line in a voice, for trying voices out (a sidekick's page). Resolves when it's done; `stop` cuts it
 * short. Call it from a tap.
 */
export function sayOnce(text: string, voice: Voice, onProgress: (fraction: number) => void = () => undefined) {
  const audio = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
  void audio.resume()
  let stopped = false
  const sources: AudioBufferSourceNode[] = []
  const done = (async () => {
    const { worker, ready } = speechWorker(onProgress)
    const [response] = await Promise.all([
      fetch("/api/voice/phonemes", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }),
      ready
    ])
    if (!response.ok) throw new Error("Their voice isn't available right now.")
    const utterances = ((await response.json()) as PhonemesResponse).sentences.flatMap((sentence) => sentence.utterances)
    if (stopped || !utterances.length) return
    const id = nextRequest++
    let at = audio.currentTime + 0.05
    await new Promise<void>((resolve, reject) => {
      const listener = (reply: TtsReply) => {
        if (!("id" in reply) || reply.id !== id) return
        if (reply.type === "audio" && !stopped) {
          const buffer = audio.createBuffer(1, reply.samples.length, VOICE_SAMPLE_RATE)
          buffer.getChannelData(0).set(reply.samples)
          const source = audio.createBufferSource()
          source.buffer = buffer
          source.connect(audio.destination)
          source.start(at)
          at += buffer.duration
          sources.push(source)
        }
        if (reply.type === "done" || reply.type === "error") {
          listeners.delete(listener)
          if (reply.type === "error") reject(new Error(reply.message))
          else resolve()
        }
      }
      listeners.add(listener)
      worker.postMessage({ type: "speak", id, utterances, voice } satisfies TtsRequest)
    })
    // Until the last piece has played.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, (at - audio.currentTime) * 1000)))
  })().finally(() => void audio.close().catch(() => undefined))
  return {
    done,
    stop() {
      stopped = true
      for (const source of sources) {
        try {
          source.stop()
        } catch {}
      }
    }
  }
}
