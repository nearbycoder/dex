import { useEffect, useMemo, useRef, useState } from "react"
import { useDexActions, useDexConnected } from "~/client/lib/dex"

/** The latest thing done on each of these VMs ("browse: await page.goto(…)"), kept live from the agent's broadcasts. */
export function useLatestActivity(keys: ReadonlyArray<string>) {
  const { stub, listen } = useDexActions()
  const connected = useDexConnected()
  const [latest, setLatest] = useState<Record<string, string>>({})
  const joined = keys.join("\n")
  const watched = useMemo(() => new Set(joined ? joined.split("\n") : []), [joined])
  const fetched = useRef(new Set<string>())

  useEffect(() => {
    if (!connected) {
      fetched.current.clear()
      return
    }
    let cancelled = false
    for (const key of watched) {
      if (fetched.current.has(key)) continue
      fetched.current.add(key)
      void stub
        .vmActivity(key, 1)
        .then((items) => {
          if (cancelled) return
          const last = items.at(-1)
          if (last) setLatest((current) => (current[key] ? current : { ...current, [key]: last.title }))
        })
        .catch(() => {
          fetched.current.delete(key)
        })
    }
    return () => {
      cancelled = true
    }
  }, [connected, stub, watched])

  useEffect(
    () =>
      listen((message) => {
        if (message.type !== "dex.vm.activity" || !watched.has(message.vmKey)) return
        setLatest((current) => (current[message.vmKey] === message.activity.title ? current : { ...current, [message.vmKey]: message.activity.title }))
      }),
    [listen, watched]
  )
  return latest
}
