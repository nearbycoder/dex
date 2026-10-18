import { emptyTranscript, type TranscriptState } from "./transcript"

/**
 * The last few chats you opened, kept on this device (IndexedDB) so opening one shows it at once, even while a cold
 * agent is still waking up, which can take seconds. The live snapshot replaces it as soon as it arrives. Only what a
 * finished chat shows is kept (entries and saved files; snapshots already leave images out). Signing out deletes it.
 */

const DB = "dex-transcripts"
const STORE = "chats"
const MAX_CHATS = 8
const MAX_BYTES = 1_500_000

type Saved = { readonly key: string; readonly savedAt: number; readonly entries: TranscriptState["entries"]; readonly artifacts: TranscriptState["artifacts"] }

let userId: string | null = null
/** Keys are per user, so another account on this device never sees these. */
export const setTranscriptStoreUser = (id: string) => {
  userId = id
}

let opened: Promise<IDBDatabase | null> | null = null
const open = () =>
  (opened ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null)
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  }))

const done = (request: IDBRequest | IDBTransaction) =>
  new Promise<void>((resolve) => {
    if ("oncomplete" in request) request.oncomplete = () => resolve()
    else request.onsuccess = () => resolve()
    request.onerror = () => resolve()
  })

/** The kept copy of a chat, shown until its live snapshot arrives. */
export async function loadTranscript(sessionId: string): Promise<TranscriptState | undefined> {
  const db = await open()
  if (!db || !userId) return undefined
  const request = db.transaction(STORE).objectStore(STORE).get(`${userId}:${sessionId}`)
  await done(request)
  const saved = request.result as Saved | undefined
  return saved ? { ...emptyTranscript, entries: saved.entries, artifacts: saved.artifacts, loaded: true } : undefined
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

/** Keeps a chat (debounced: a streaming reply changes it many times a second), then the newest MAX_CHATS only. */
export function saveTranscript(sessionId: string, transcript: TranscriptState) {
  if (!transcript.loaded || !userId) return
  const key = `${userId}:${sessionId}`
  clearTimeout(pending.get(key))
  pending.set(
    key,
    setTimeout(async () => {
      pending.delete(key)
      const record: Saved = { key, savedAt: Date.now(), entries: transcript.entries, artifacts: transcript.artifacts }
      if (JSON.stringify(record).length > MAX_BYTES) return
      const db = await open()
      if (!db) return
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      store.put(record)
      // Oldest first: delete all but the newest MAX_CHATS.
      const keys = store.index("savedAt").getAllKeys()
      keys.onsuccess = () => {
        for (const old of keys.result.slice(0, Math.max(0, keys.result.length - MAX_CHATS))) store.delete(old)
      }
      await done(tx)
    }, 1_500)
  )
}

/** Forgets every kept chat (signing out). */
export function clearTranscripts() {
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  const closing = opened
  opened = null
  void closing?.then((db) => db?.close())
  if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB)
}
