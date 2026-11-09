import { useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"

/** The latest thing done on each of these VMs ("browse: await page.goto(…)"), kept live from the agent's broadcasts. */
export function useLatestActivity(keys: ReadonlyArray<string>) {
  const { stub, listen, connected } = useDex()
  const [latest, setLatest] = useState<Record<string, string>>({})
  const joined = keys.join("\n")
  useEffect(() => {
    if (!connected) return
    for (const key of joined ? joined.split("\n") : []) {
      void stub
        .vmActivity(key, 1)
        .then((items) => {
          const last = items.at(-1)
          if (last) setLatest((current) => (current[key] ? current : { ...current, [key]: last.title }))
        })
        .catch(() => undefined)
    }
  }, [connected, stub, joined])
  useEffect(
    () =>
      listen((message) => {
        if (message.type !== "dex.vm.activity") return
        setLatest((current) => (current[message.vmKey] === message.activity.title ? current : { ...current, [message.vmKey]: message.activity.title }))
      }),
    [listen]
  )
  return latest
}
