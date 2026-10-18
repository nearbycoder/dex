import { useEffect, useState } from "react"
import { useDex } from "~/client/lib/dex"
import type { DirectorySkill } from "~/shared/skills"

/** skills.sh results for `query` (2+ characters), debounced; stale answers never replace newer ones. */
export function useSkillSearch(query: string, delay = 250) {
  const { stub } = useDex()
  const [state, setState] = useState<{ query: string; results: DirectorySkill[]; loading: boolean; error: string | null }>({
    query: "",
    results: [],
    loading: false,
    error: null
  })
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) {
      setState({ query: q, results: [], loading: false, error: null })
      return
    }
    let current = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const timer = setTimeout(() => {
      stub
        .searchSkills(q)
        .then((results) => current && setState({ query: q, results, loading: false, error: null }))
        .catch((error: unknown) => current && setState({ query: q, results: [], loading: false, error: error instanceof Error ? error.message : String(error) }))
    }, delay)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q, stub, delay])

  return state
}
