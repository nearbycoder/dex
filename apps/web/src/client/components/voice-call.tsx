import { Mic, MicOff, PhoneOff } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { CharacterAvatar } from "~/client/components/agent-avatar"
import { type TranscriptState, displayItems } from "~/client/lib/transcript"
import { type CallReply, type CallSnapshot, VoiceCall } from "~/client/voice/call"
import type { CharacterProfile } from "~/shared/characters"
import { voiceOf } from "~/shared/voice"

export { canCall } from "~/client/voice/call"

/** Starts a call with a sidekick. Call it from the tap on Call: the browser allows the microphone and sound only then. */
export function startCall(character: CharacterProfile, send: (text: string) => Promise<void>) {
  const call = new VoiceCall({ voice: voiceOf(character), send })
  void call.start()
  return call
}

/** The reply after your latest message, as the call reads it: its text so far, and whether it's over. */
const latestReply = (transcript: TranscriptState): CallReply | null => {
  const items = displayItems(transcript)
  const lastUser = items.findLastIndex((item) => item.kind === "user")
  const reply = items.slice(lastUser + 1).find((item) => item.kind === "assistant")
  if (!reply || reply.kind !== "assistant") return null
  const text = reply.messages
    .map((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""))
    .filter(Boolean)
    .join("\n\n")
  return { key: String(reply.messages[0]?.timestamp ?? reply.id), text, done: !transcript.running && !reply.streaming }
}

const PHASE_LABELS: Record<CallSnapshot["phase"], string> = {
  starting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
  failed: "Call ended"
}

/** A call in progress, over the chat: their face (it moves with their voice), what you said, and what they're saying. */
export function VoiceCallPanel({ call, character, transcript, onEnd }: { call: VoiceCall; character: CharacterProfile; transcript: TranscriptState; onEnd: () => void }) {
  const [snapshot, setSnapshot] = useState(call.state)
  useEffect(() => call.subscribe(setSnapshot), [call])

  const reply = useMemo(() => latestReply(transcript), [transcript])
  useEffect(() => call.reply(reply), [call, reply])

  // Their face grows a little with their voice.
  const face = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const tick = () => {
      if (face.current) face.current.style.transform = `scale(${1 + call.level() * 0.12})`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [call])

  // Leaving the chat ends the call.
  useEffect(() => () => call.end(), [call])

  const { phase } = snapshot
  const over = phase === "ended" || phase === "failed"
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center bg-zinc-950/95 px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
      <div className="flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center gap-6 text-center">
        <div ref={face} className="transition-transform duration-75 will-change-transform">
          <CharacterAvatar character={character} size={160} mood={phase === "thinking" || phase === "starting" ? "working" : "idle"} failed={phase === "failed"} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">{character.name}</h2>
          <p className={`mt-1 text-sm ${phase === "listening" ? "text-emerald-400" : "text-zinc-500"}`} aria-live="polite">
            {snapshot.downloading !== null ? `Getting their voice ready… ${Math.round(snapshot.downloading * 100)}%` : snapshot.muted && !over ? "Muted" : PHASE_LABELS[phase]}
          </p>
        </div>
        <div className="min-h-24 w-full space-y-3 text-sm">
          {snapshot.saying && <p className="text-base leading-relaxed text-zinc-100">{snapshot.saying}</p>}
          {snapshot.heard && !snapshot.saying && <p className="leading-relaxed text-zinc-400">“{snapshot.heard}”</p>}
          {snapshot.error && <p className="text-red-400">{snapshot.error}</p>}
        </div>
      </div>
      <div className="flex items-center gap-6">
        {!over && (
          <button
            type="button"
            onClick={() => call.setMuted(!snapshot.muted)}
            aria-pressed={snapshot.muted}
            aria-label={snapshot.muted ? "Unmute" : "Mute"}
            title={snapshot.muted ? "Unmute" : "Mute"}
            className={`flex size-14 items-center justify-center rounded-full ${snapshot.muted ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"}`}
          >
            {snapshot.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            call.end()
            onEnd()
          }}
          aria-label={over ? "Close" : "End call"}
          title={over ? "Close" : "End call"}
          className="flex size-14 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
        >
          <PhoneOff className="size-6" />
        </button>
      </div>
    </div>
  )
}
