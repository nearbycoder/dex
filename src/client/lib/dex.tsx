import { useAgent } from "agents/react"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react"
import type { DexAgent } from "~/agent/dex-agent"
import type { Viewer } from "~/server/viewer"
import { AGENT_CLASS, type ClientMessage, type DexState, isServerMessage, type ServerMessage } from "~/shared/protocol"
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

/** One WebSocket to this user's DexAgent: synced state, RPC, and chat event streams. */
export function DexProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>())
  const agent = useAgent<DexAgent, DexState>({
    agent: AGENT_CLASS,
    name: viewer.id,
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

  const value = useMemo<DexContextValue>(
    () => ({ viewer, state: agent.state, connected: agent.identified, stub: agent.stub, send, listen }),
    [viewer, agent.state, agent.identified, agent.stub, send, listen]
  )
  return <DexContext.Provider value={value}>{children}</DexContext.Provider>
}

export function useDex() {
  const context = useContext(DexContext)
  if (!context) throw new Error("useDex must be used inside DexProvider")
  return context
}

type Action = { type: "reset" } | { type: "message"; message: ServerMessage }

const reduce = (state: TranscriptState, action: Action): TranscriptState => {
  if (action.type === "reset") return emptyTranscript
  const { message } = action
  switch (message.type) {
    case "dex.snapshot":
      return fromSnapshot(message.snapshot)
    case "dex.events":
      return message.events.reduce(applyEvent, state)
    case "dex.error":
      return { ...state, error: message.message }
    default:
      return state
  }
}

const PING_MS = 20_000

/** Live transcript of one chat. Re-subscribes on reconnect and pings so an evicted object resumes the stream. */
export function useTranscript(sessionId: string) {
  const { send, listen, connected } = useDex()
  const [state, dispatch] = useReducer(reduce, emptyTranscript)

  useEffect(() => {
    dispatch({ type: "reset" })
    return listen((message) => {
      if (message.sessionId === sessionId) dispatch({ type: "message", message })
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

  return state
}
