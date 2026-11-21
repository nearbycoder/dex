import { useCallback, useEffect, useRef, useState } from "react"
import { skeletonPreview } from "./skeleton-preview"

/**
 * Data a page fetches from the agent (usage, files, schedules, VM activity), remembered for this page load: going
 * back to a page shows what it had at once and refreshes it in the background.
 */
const cache = new Map<string, unknown>()

export const clearPageCache = () => cache.clear()

type Updater<T> = T | ((current: T | undefined) => T)

/**
 * `load` must be stable (wrap it in useCallback); it runs whenever `enabled` turns true or `key` changes.
 * `data` is undefined until the first load for this key, which is when a page shows its skeleton.
 */
export function useCachedFetch<T>(key: string | null, load: () => Promise<T>, enabled: boolean) {
  const [data, setState] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(key)
  // Monotonic sequence so an older overlapping fetch never overwrites a newer response or optimistic update.
  const seq = useRef(0)

  useEffect(() => {
    current.current = key
    seq.current++
    setLoading(false)
    setState(key ? (cache.get(key) as T | undefined) : undefined)
    setError(null)
  }, [key])

  const setData = useCallback(
    (next: Updater<T>) => {
      if (!key) return
      const value = typeof next === "function" ? (next as (current: T | undefined) => T)(cache.get(key) as T | undefined) : next
      cache.set(key, value)
      if (current.current === key) {
        seq.current++
        setLoading(false)
        setState(value)
      }
    },
    [key]
  )

  const refresh = useCallback(async () => {
    if (!key || current.current !== key) return
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const value = await load()
      if (id !== seq.current) return
      cache.set(key, value)
      if (current.current === key) setState(value)
    } catch (cause) {
      if (id === seq.current && current.current === key) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (id === seq.current && current.current === key) setLoading(false)
    }
  }, [key, load])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  return { data: skeletonPreview() ? undefined : data, loading, error, refresh, setData }
}
