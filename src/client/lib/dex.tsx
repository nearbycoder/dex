import { useLocation } from "@tanstack/react-router"
import { useAgent } from "agents/react"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { DexAgent } from "~/agent/dex-agent"
import type { Viewer } from "~/server/viewer"
import { AGENT_CLASS, type ClientMessage, type DexState, isServerMessage, type ServerMessage, withStateDefaults } from "~/shared/protocol"
import { clearPageCache } from "./cache"
import { skeletonPreview } from "./skeleton-preview"
import { clearNotifications } from "./push"
import { applyEvent, emptyTranscript, fromSnapshot, type TranscriptState } from "./transcript"

type Listener = (message: ServerMessage) => void

interface DexContextValue {
  readonly viewer: Viewer
  readonly state: DexState | undefined
  readonly connected: boolean
  readonly stub: ReturnType<typeof useAgent<DexAgent, DexState>>["stub"]
  readonly send: (message: ClientMessage) => void
  readonly listen: (listener: Listener) => () => void
}

const DexContext = createContext<DexContextValue | null>(null)

/**
 * The last state the agent synced, kept on this device so a launch shows your chats and settings at once while the
 * socket connects (`connected` stays false until it has). Nothing secret is in it; signing out clears it.
 */
const STATE_KEY = (userId: string) => `dex-state:${userId}`

const readSavedState = (userId: string): DexState | undefined => {
  try {
    const saved = localStorage.getItem(STATE_KEY(userId))
    return saved ? withStateDefaults(JSON.parse(saved) as DexState) : undefined
  } catch {
    return undefined
  }
}

/** Forgets what this device kept for a quick start (signing out). */
export function forgetSavedState() {
  if (typeof localStorage === "undefined") return
  for (const key of Object.keys(localStorage)) if (key.startsWith("dex-state:")) localStorage.removeItem(key)
  transcripts.clear()
  clearPageCache()
}

/** One WebSocket to this user's DexAgent: synced state, RPC, and chat event streams. */
export function DexProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>())
  const agent = useAgent<DexAgent, DexState>({
    agent: AGENT_CLASS,
    name: viewer.id,
    // Signed out everywhere (from another device): this session no longer works, so go sign in again.
    onClose: (event) => {
      if (event.code !== 4001) return
      forgetSavedState()
      window.location.assign("/login")
    },
    onMessage: (event) => {
      if (typeof event.data !== "string" || !event.data.startsWith('{"type":"dex.')) return
      const message: unknown = JSON.parse(event.data)
      if (isServerMessage(message)) for (const listener of listeners.current) listener(message)
    }
  })

  const send = useCallback((message: ClientMessage) => agent.send(JSON.stringify(message)), [agent])
  const listen = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])

  const [saved] = useState(() => readSavedState(viewer.id))
  const live = useMemo(() => agent.state && withStateDefaults(agent.state), [agent.state])
  const state = skeletonPreview() ? undefined : (live ?? saved)

  // Saved a moment after it settles, not on every streamed change.
  useEffect(() => {
    if (!live) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STATE_KEY(viewer.id), JSON.stringify(live))
      } catch {
        // Storage full or blocked: launches just wait for the socket.
      }
    }, 1_000)
    return () => clearTimeout(timer)
  }, [live, viewer.id])

  // Tells the agent whether Dex is visible here and which chat it shows, so notifications skip what you're
  // looking at; and clears the badge and that chat's notifications whenever Dex comes into view.
  const { pathname } = useLocation()
  const sessionId = /^\/chat\/([^/]+)/.exec(pathname)?.[1] ?? null
  useEffect(() => {
    if (!agent.identified) return
    const report = () => {
      const visible = document.visibilityState === "visible"
      send({ type: "dex.presence", visible, sessionId })
      if (visible) void clearNotifications(sessionId)
    }
    report()
    document.addEventListener("visibilitychange", report)
    return () => document.removeEventListener("visibilitychange", report)
  }, [agent.identified, send, sessionId])
  const value = useMemo<DexContextValue>(
    () => ({ viewer, state, connected: agent.identified && !skeletonPreview(), stub: agent.stub, send, listen }),
    [viewer, state, agent.identified, agent.stub, send, listen]
  )
  return <DexContext.Provider value={value}>{children}</DexContext.Provider>
}

export function useDex() {
  const context = useContext(DexContext)
  if (!context) throw new Error("useDex must be used inside DexProvider")
  return context
}

type Action = { type: "reset"; to: TranscriptState } | { type: "message"; message: ServerMessage }

/** Recently opened chats as last seen, so going back to one shows it at once; the fresh snapshot replaces it. */
const transcripts = new Map<string, TranscriptState>()
const MAX_CACHED_TRANSCRIPTS = 12

const remember = (sessionId: string, transcript: TranscriptState) => {
  if (!transcript.loaded) return
  transcripts.delete(sessionId)
  transcripts.set(sessionId, transcript)
  for (const oldest of transcripts.keys()) {
    if (transcripts.size <= MAX_CACHED_TRANSCRIPTS) break
    transcripts.delete(oldest)
  }
}

const reduce = (state: TranscriptState, action: Action): TranscriptState => {
  if (action.type === "reset") return action.to
  const { message } = action
  switch (message.type) {
    case "dex.snapshot":
      return fromSnapshot(message.snapshot, state)
    case "dex.events":
      return message.events.reduce(applyEvent, state)
    case "dex.error":
      return { ...state, error: message.message, loaded: true }
    case "dex.artifacts":
      return { ...state, artifacts: message.artifacts, savingArtifacts: message.saving }
    default:
      return state
  }
}

const PING_MS = 20_000

/** Live transcript of one chat. Re-subscribes on reconnect and pings so an evicted object resumes the stream. */
export function useTranscript(sessionId: string) {
  const { send, listen, connected } = useDex()
  const cachedOr = (id: string) => transcripts.get(id) ?? emptyTranscript
  // Tagged with its chat: right after switching, the reducer still holds the previous chat until the reset lands.
  const [tagged, dispatch] = useReducer(
    (current: { id: string; transcript: TranscriptState }, action: Action & { id: string }) => ({
      id: action.id,
      transcript: reduce(action.id === current.id ? current.transcript : cachedOr(action.id), action)
    }),
    sessionId,
    (id) => ({ id, transcript: cachedOr(id) })
  )
  const state = skeletonPreview() ? emptyTranscript : tagged.id === sessionId ? tagged.transcript : cachedOr(sessionId)

  useEffect(() => {
    dispatch({ type: "reset", to: cachedOr(sessionId), id: sessionId })
    return listen((message) => {
      if (message.sessionId === sessionId) dispatch({ type: "message", message, id: sessionId })
    })
  }, [listen, sessionId])

  useEffect(() => {
    if (!connected) return
    send({ type: "dex.subscribe", sessionId })
    const ping = setInterval(() => send({ type: "dex.ping", sessionId }), PING_MS)
    return () => {
      clearInterval(ping)
      send({ type: "dex.unsubscribe" })
    }
  }, [connected, send, sessionId])

  useEffect(() => {
    if (tagged.id === sessionId) remember(sessionId, tagged.transcript)
  }, [sessionId, tagged])

  return state
}
