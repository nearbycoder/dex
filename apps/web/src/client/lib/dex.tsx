import { useLocation } from "@tanstack/react-router"
import { useAgent } from "agents/react"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createStore, type StoreApi } from "zustand/vanilla"
import type { DexAgent } from "~/agent/dex-agent"
import type { Viewer } from "~/server/viewer"
import { type ModelCatalog, setModelCatalog } from "~/shared/models"
import { AGENT_CLASS, type ClientMessage, type DexState, isServerMessage, type ServerMessage, withStateDefaults } from "~/shared/protocol"
import { clearPageCache } from "./cache"
import { reconcileDexState } from "./reconcile-state"
import { skeletonPreview } from "./skeleton-preview"
import { clearNotifications } from "./push"
import type { EntryRecord } from "@earendil-works/pi-durable"
import { applyEvent, emptyTranscript, fromSnapshot, type TranscriptState, withEarlier, withNewer } from "./transcript"
import { clearCachedPages } from "./updates"
import { clearTranscripts, loadTranscript, saveTranscript, setTranscriptStoreUser } from "./transcript-store"

type Listener = (message: ServerMessage) => void

interface DexStoreSlice {
  readonly state: DexState | undefined
  readonly connected: boolean
  readonly models: string | null
}

interface DexActionsContextValue {
  readonly viewer: Viewer
  readonly stub: ReturnType<typeof useAgent<DexAgent, DexState>>["stub"]
  readonly send: (message: ClientMessage) => void
  readonly listen: (listener: Listener) => () => void
  readonly store: StoreApi<DexStoreSlice>
}

interface DexContextValue {
  readonly viewer: Viewer
  readonly state: DexState | undefined
  readonly connected: boolean
  readonly stub: ReturnType<typeof useAgent<DexAgent, DexState>>["stub"]
  readonly send: (message: ClientMessage) => void
  readonly listen: (listener: Listener) => () => void
  /** The model list's version, so pages that list models redraw when it changes. */
  readonly models: string | null
}

const DexActionsContext = createContext<DexActionsContextValue | null>(null)

/** Shallow equality for arrays and plain objects, for `useDexSelector`. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    if (!Object.prototype.hasOwnProperty.call(bo, key) || !Object.is(ao[key], bo[key])) return false
  }
  return true
}

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

/**
 * The model list the agent last sent (the same for everyone, so it stays on sign out). Installed at launch so a
 * renamed or new model shows before the socket connects; without it the app starts on the built-in list.
 */
const MODELS_KEY = "dex-models"

const installSavedModels = (): string | null => {
  try {
    const saved = localStorage.getItem(MODELS_KEY)
    if (!saved) return null
    const catalog = JSON.parse(saved) as ModelCatalog
    return setModelCatalog(catalog) ? catalog.version : null
  } catch {
    return null
  }
}

/** Forgets what this device kept for a quick start (signing out). */
export async function forgetSavedState(): Promise<void> {
  try {
    if (typeof localStorage !== "undefined") {
      for (const key of Object.keys(localStorage)) if (key.startsWith("dex-state:")) localStorage.removeItem(key)
    }
  } catch {}
  transcripts.clear()
  clearPageCache()
  await Promise.all([clearTranscripts(), clearCachedPages()])
}

/** Isolated presence reporter so route navigation doesn't re-render DexProvider and every subscriber. */
function DexPresence({ connected, send }: { connected: boolean; send: (message: ClientMessage) => void }) {
  const { pathname } = useLocation()
  const sessionId = /^\/chat\/([^/]+)/.exec(pathname)?.[1] ?? null
  useEffect(() => {
    if (!connected) return
    const report = () => {
      const visible = document.visibilityState === "visible"
      send({ type: "dex.presence", visible, sessionId })
      if (visible) void clearNotifications(sessionId)
    }
    report()
    document.addEventListener("visibilitychange", report)
    return () => document.removeEventListener("visibilitychange", report)
  }, [connected, send, sessionId])
  return null
}

/** One WebSocket to this user's DexAgent: synced state, RPC, and chat event streams. */
export function DexProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  setTranscriptStoreUser(viewer.id)
  const listeners = useRef(new Set<Listener>())
  const agent = useAgent<DexAgent, DexState>({
    agent: AGENT_CLASS,
    name: viewer.id,
    // Signed out everywhere (from another device): this session no longer works, so go sign in again.
    onClose: (event) => {
      if (event.code !== 4001) return
      void forgetSavedState().finally(() => window.location.assign("/login"))
    },
    onMessage: (event) => {
      if (typeof event.data !== "string" || !event.data.startsWith('{"type":"dex.')) return
      let message: unknown
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (isServerMessage(message)) for (const listener of listeners.current) listener(message)
    }
  })

  const agentRef = useRef(agent)
  agentRef.current = agent
  const send = useCallback((message: ClientMessage) => agentRef.current.send(JSON.stringify(message)), [])
  const listen = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])

  const [saved] = useState(() => readSavedState(viewer.id))
  const prevStateRef = useRef<DexState | undefined>(saved)
  const live = useMemo(() => {
    if (!agent.state) return undefined
    const next = reconcileDexState(prevStateRef.current, withStateDefaults(agent.state))
    prevStateRef.current = next
    return next
  }, [agent.state])
  const state = skeletonPreview() ? undefined : (live ?? saved)
  const connected = agent.identified && !skeletonPreview()

  // The agent refreshes the model list from the providers; when its version changes, fetch and install it.
  const [models, setModels] = useState(installSavedModels)
  const latest = live?.models?.version
  useEffect(() => {
    if (!agent.identified || !latest || latest === models) return
    let cancelled = false
    agent.stub
      .modelCatalog()
      .then((catalog) => {
        if (cancelled || !setModelCatalog(catalog)) return
        try {
          localStorage.setItem(MODELS_KEY, JSON.stringify(catalog))
        } catch {
          // Storage full or blocked: the next launch starts on the built-in list until this arrives again.
        }
        setModels(catalog.version)
      })
      // An agent still on an older build has no list to give; it restarts on the new one.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [agent.identified, agent.stub, latest, models])

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

  // Zustand store holds the rapidly changing state/connected/models slices so DexActionsContext stays stable
  // and consumers subscribed via `useDexSelector` / `useDexActions` skip unrelated renders.
  const [store] = useState(() => createStore<DexStoreSlice>(() => ({ state, connected, models })))
  useLayoutEffect(() => {
    const prev = store.getState()
    if (prev.state !== state || prev.connected !== connected || prev.models !== models) {
      store.setState({ state, connected, models })
    }
  }, [store, state, connected, models])

  const actions = useMemo<DexActionsContextValue>(
    () => ({ viewer, stub: agent.stub, send, listen, store }),
    [viewer, agent.stub, send, listen, store]
  )
  return (
    <DexActionsContext.Provider value={actions}>
      <DexPresence connected={agent.identified} send={send} />
      {children}
    </DexActionsContext.Provider>
  )
}

/** Stable agent handles (`viewer`, `stub`, `send`, `listen`) — never re-renders when `DexState` updates. */
export function useDexActions(): DexActionsContextValue {
  const context = useContext(DexActionsContext)
  if (!context) throw new Error("useDex must be used inside DexProvider")
  return context
}

/** Subscribes to a slice of `DexState`; re-renders only when the selected value changes according to `equals`. */
export function useDexSelector<T>(selector: (state: DexState | undefined) => T, equals: (a: T, b: T) => boolean = Object.is): T {
  const { store } = useDexActions()
  const cacheRef = useRef<{ has: boolean; value: T }>({ has: false, value: undefined as T })
  const getSnapshot = () => {
    const next = selector(store.getState().state)
    if (cacheRef.current.has && equals(cacheRef.current.value, next)) return cacheRef.current.value
    cacheRef.current.has = true
    cacheRef.current.value = next
    return next
  }
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Live WebSocket connection status — re-renders only when connectivity flips. */
export function useDexConnected(): boolean {
  const { store } = useDexActions()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().connected,
    () => store.getState().connected
  )
}

/** Installed model catalog version — re-renders only when the model list changes. */
export function useDexModels(): string | null {
  const { store } = useDexActions()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().models,
    () => store.getState().models
  )
}

/** Full Dex context (backward-compatible). Prefer `useDexSelector` / `useDexActions` in hot components. */
export function useDex(): DexContextValue {
  const { viewer, stub, send, listen, store } = useDexActions()
  const slice = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  return useMemo(
    () => ({ viewer, state: slice.state, connected: slice.connected, stub, send, listen, models: slice.models }),
    [viewer, slice.state, slice.connected, stub, send, listen, slice.models]
  )
}

type Action =
  | { type: "reset"; to: TranscriptState }
  | { type: "message"; message: ServerMessage }
  | { type: "earlier"; entries: ReadonlyArray<EntryRecord>; more: boolean }
  | { type: "newer"; entries: ReadonlyArray<EntryRecord> }

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
  if (action.type === "earlier") return withEarlier(state, action.entries, action.more)
  if (action.type === "newer") return withNewer(state, action.entries)
  const { message } = action
  switch (message.type) {
    case "dex.snapshot":
      return fromSnapshot(message.snapshot, state, message.earlier ?? false)
    case "dex.events":
      return message.events.reduce(applyEvent, state)
    case "dex.error":
      return { ...state, error: message.message, loaded: true }
    case "dex.queue":
      return { ...state, queue: message.items, queueHeld: message.held }
    case "dex.artifacts":
      return { ...state, artifacts: message.artifacts, savingArtifacts: message.saving }
    default:
      return state
  }
}

const PING_MS = 20_000

/**
 * Live transcript of one chat. Re-subscribes on reconnect and pings so an evicted object resumes the stream.
 * `loadEarlier` puts the chat's older messages in front (while `transcript.earlier`).
 */
export function useTranscript(sessionId: string) {
  const { send, listen, stub } = useDexActions()
  const connected = useDexConnected()
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

  // Whether the shown copy is live (or from memory), so the device's kept copy never replaces a fresher one.
  const shownLoaded = useRef(false)
  shownLoaded.current = state.loaded
  const latestEntryId = useRef(0)
  latestEntryId.current = state.entries.reduce((max, entry) => Math.max(max, entry.id), 0)
  const activeSession = useRef(sessionId)
  activeSession.current = sessionId

  useEffect(() => {
    let cancelled = false
    dispatch({ type: "reset", to: cachedOr(sessionId), id: sessionId })
    // Not in memory (a fresh launch): show the copy kept on this device until the agent's snapshot arrives.
    if (!transcripts.has(sessionId)) {
      void loadTranscript(sessionId).then((kept) => {
        if (!cancelled && kept && !shownLoaded.current && !transcripts.has(sessionId)) {
          dispatch({ type: "reset", to: kept, id: sessionId })
        }
      })
    }
    // Coalesce bursty streaming `dex.events` frames into one reducer dispatch per animation frame (60fps cap).
    let pendingEvents: Array<Extract<ServerMessage, { type: "dex.events" }>["events"][number]> = []
    let rafId: number | null = null
    const flushEvents = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (!pendingEvents.length) return
      const batch = pendingEvents
      pendingEvents = []
      dispatch({ type: "message", message: { type: "dex.events", sessionId, events: batch }, id: sessionId })
    }
    const off = listen((message) => {
      if (message.sessionId !== sessionId) return
      if (message.type === "dex.events") {
        for (let i = 0; i < message.events.length; i++) pendingEvents.push(message.events[i]!)
        if (rafId === null) {
          if (typeof requestAnimationFrame === "function") {
            rafId = requestAnimationFrame(flushEvents)
          } else {
            flushEvents()
          }
        }
        return
      }
      // Preserve ordering: flush any buffered events before snapshot/queue/error/artifacts messages.
      flushEvents()
      dispatch({ type: "message", message, id: sessionId })
    })
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      pendingEvents = []
      off()
    }
  }, [listen, sessionId])

  useEffect(() => {
    if (!connected) return
    const cursor = latestEntryId.current
    if (shownLoaded.current && cursor > 0) {
      // Fast incremental catch-up on reconnect before the full subscribe snapshot settles.
      const requestedSession = sessionId
      void stub
        .chatEntriesSince(requestedSession, cursor)
        .then(({ entries }) => {
          if (entries.length > 0 && activeSession.current === requestedSession) {
            dispatch({ type: "newer", entries, id: requestedSession })
          }
        })
        .catch(() => undefined)
    }
    send({ type: "dex.subscribe", sessionId })
    const ping = setInterval(() => send({ type: "dex.ping", sessionId }), PING_MS)
    return () => {
      clearInterval(ping)
      send({ type: "dex.unsubscribe" })
    }
  }, [connected, send, sessionId, stub])

  useEffect(() => {
    if (tagged.id === sessionId) remember(sessionId, tagged.transcript)
  }, [sessionId, tagged])

  // IndexedDB only stores committed entries and artifacts; skip scheduling writes on every streamed token.
  useEffect(() => {
    if (tagged.id === sessionId && tagged.transcript.loaded) saveTranscript(sessionId, tagged.transcript)
  }, [sessionId, tagged.id, tagged.transcript.loaded, tagged.transcript.entries, tagged.transcript.artifacts])

  const oldest = useMemo(
    () => state.entries.reduce((min, entry) => Math.min(min, entry.id), Number.POSITIVE_INFINITY),
    [state.entries]
  )
  const loadEarlier = useCallback(async () => {
    if (!Number.isFinite(oldest)) return
    const requestedSession = sessionId
    const { entries, more } = await stub.chatHistory(requestedSession, oldest)
    if (activeSession.current === requestedSession) {
      dispatch({ type: "earlier", entries, more, id: requestedSession })
    }
  }, [oldest, sessionId, stub])

  return { transcript: state, loadEarlier }
}
