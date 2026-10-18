import { Link } from "@tanstack/react-router"
import { Download, LoaderCircle, Plus, Sparkles } from "lucide-react"
import { forwardRef, type KeyboardEvent, type ReactNode, useEffect, useImperativeHandle, useState } from "react"
import { useDex } from "~/client/lib/dex"
import { useSkillSearch } from "~/client/lib/skills"
import { type DirectorySkill, formatInstalls, type SkillInfo } from "~/shared/skills"

export interface SkillMenuHandle {
  /** Arrow keys, Enter, Tab, and Escape while the menu is open; true when it used the key. */
  handleKey(event: KeyboardEvent): boolean
}

type Item = { readonly kind: "installed"; readonly skill: SkillInfo } | { readonly kind: "directory"; readonly skill: DirectorySkill }

function Heading({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{children}</div>
}

/**
 * The quick lookup that opens when a message starts with `/`: your skills first, then matches on skills.sh, which
 * install in place. Picking one puts `/<name> ` in the message box.
 */
export const SkillMenu = forwardRef<SkillMenuHandle, { query: string; onPick: (name: string) => void; onClose: () => void }>(function SkillMenu(
  { query, onPick, onClose },
  ref
) {
  const { state, stub } = useDex()
  const q = query.toLowerCase()
  const skills = state?.skills ?? []
  const installed = skills
    .filter((skill) => skill.id.includes(q))
    .sort((a, b) => Number(b.id.startsWith(q)) - Number(a.id.startsWith(q)) || a.id.localeCompare(b.id))
    .slice(0, 6)
  const search = useSkillSearch(q)
  const have = new Set(skills.map((skill) => `${skill.source}/${skill.path?.split("/").pop() ?? skill.id}`))
  const directory = q.length >= 2 ? search.results.filter((skill) => !have.has(skill.id)).slice(0, 5) : []
  const items: Item[] = [...installed.map((skill) => ({ kind: "installed" as const, skill })), ...directory.map((skill) => ({ kind: "directory" as const, skill }))]
  const [active, setActive] = useState(0)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setActive(0)
    setError(null)
  }, [q])

  const pick = async (item: Item | undefined) => {
    if (!item || installing) return
    if (item.kind === "installed") return onPick(item.skill.id)
    setInstalling(item.skill.id)
    setError(null)
    try {
      const skill = await stub.installSkill(item.skill.source, item.skill.skillId)
      onPick(skill.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setInstalling(null)
    }
  }

  useImperativeHandle(ref, () => ({
    handleKey(event) {
      if (event.key === "Escape") {
        onClose()
        return true
      }
      if (!items.length) return false
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length)
        return true
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        void pick(items[Math.min(active, items.length - 1)])
        return true
      }
      return false
    }
  }))

  const row = (index: number, content: ReactNode, trailing?: ReactNode) => (
    <button
      key={index}
      type="button"
      role="option"
      aria-selected={index === active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setActive(index)}
      onClick={() => void pick(items[index])}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${index === active ? "bg-zinc-800" : ""}`}
    >
      {content}
      {trailing}
    </button>
  )

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 animate-pop overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-xl shadow-black/50">
      <div role="listbox" aria-label="Skills" className="scrollbar-thin max-h-72 overflow-y-auto p-1">
        {installed.length > 0 && <Heading>Your skills</Heading>}
        {installed.map((skill, index) =>
          row(
            index,
            <>
              <Sparkles className="size-4 shrink-0 text-emerald-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm text-zinc-100">/{skill.id}</span>
                <span className="block truncate text-xs text-zinc-500">{skill.description}</span>
              </span>
            </>
          )
        )}
        {q.length >= 2 && (
          <Heading>
            skills.sh {search.loading && <LoaderCircle className="size-3 animate-spin" />}
          </Heading>
        )}
        {directory.map((skill, offset) => {
          const index = installed.length + offset
          return row(
            index,
            <>
              <Download className="size-4 shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-100">{skill.name}</span>
                <span className="block truncate font-mono text-xs text-zinc-500">
                  {skill.source} · {formatInstalls(skill.installs)}
                </span>
              </span>
            </>,
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
              {installing === skill.id ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />} Install
            </span>
          )
        })}
        {q.length >= 2 && !search.loading && search.query === q && directory.length === 0 && installed.length === 0 && !search.error && (
          <p className="px-2.5 py-2 text-xs text-zinc-500">No skills match “{q}”.</p>
        )}
        {q.length < 2 && installed.length === 0 && <p className="px-2.5 py-2 text-xs text-zinc-500">Type to search skills.sh.</p>}
        {(error ?? search.error) && <p className="px-2.5 py-2 text-xs break-words text-red-400">{error ?? search.error}</p>}
      </div>
      <Link
        to="/skills"
        onMouseDown={(event) => event.preventDefault()}
        className="block border-t border-zinc-800 px-3.5 py-2 text-xs text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
      >
        Manage skills
      </Link>
    </div>
  )
})
