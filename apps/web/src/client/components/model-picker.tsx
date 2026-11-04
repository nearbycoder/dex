import { Link } from "@tanstack/react-router"
import { Brain, CalendarClock, Check, ChevronDown, Eye, RefreshCw, Search } from "lucide-react"
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import {
  clampThinking,
  daysSinceRelease,
  type DexModel,
  findModel,
  isNewModel,
  MODEL_MAKERS,
  MODEL_PROVIDERS,
  type ModelProvider,
  MODELS,
  supportedThinkingLevels,
  type ThinkingLevel
} from "~/shared/models"
import { connectedProviders } from "~/shared/protocol"
import { ModelLogo } from "./model-logo"

const selectClass =
  "appearance-none rounded-md border border-zinc-800 bg-zinc-900 py-1 pr-5 pl-6 text-xs text-zinc-300 hover:border-zinc-700 focus:border-emerald-600 focus:outline-none sm:pr-6"

export const hasVision = (model: DexModel | undefined) => model?.input.includes("image") ?? false

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : `${Math.round(tokens / 1024)}K`

/** The labels of a model's badges, which the search also matches. */
const badges = (model: DexModel) => {
  const levels = supportedThinkingLevels(model)
  return [
    hasVision(model) ? "Vision" : "Text only",
    ...(levels.length > 0 ? [levels.includes("off") ? "thinking optional" : "always thinks"] : []),
    ...(model.cost.input === 0 && model.cost.output === 0 ? ["Free"] : []),
    ...(model.trainsOnData ? ["Trains on data"] : []),
    ...(isNewModel(model) ? ["New"] : [])
  ]
}

/** "Nov 3" this year, "Mar 2025" before. */
const releaseLabel = (model: DexModel) => {
  if (!model.releasedAt) return undefined
  const date = new Date(`${model.releasedAt.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return undefined
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return date.toLocaleDateString(undefined, thisYear ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" })
}

/** The newest-first list's sections, by how long ago a model came out. */
const PERIODS = [
  { days: 7, label: "This week" },
  { days: 30, label: "This month" },
  { days: 90, label: "Past 3 months" },
  { days: Infinity, label: "Earlier" }
] as const
const NEWEST_KEY = "dex-models-newest"

function ModelRow(props: { model: DexModel; selected: boolean; usable: boolean; showProvider: boolean; onSelect: () => void }) {
  const { model } = props
  const levels = supportedThinkingLevels(model)
  const free = model.cost.input === 0 && model.cost.output === 0
  const released = releaseLabel(model)
  const vision = hasVision(model)
  // One quiet line under the name: where it's from, when it came out, then what it can do. Color only where it
  // matters: sees images, costs nothing, or may be trained on.
  const dot = <span className="text-zinc-700">·</span>
  return (
    <li>
      <button
        type="button"
        disabled={!props.usable}
        onClick={props.onSelect}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-900 disabled:opacity-40 disabled:hover:bg-transparent ${props.selected ? "bg-zinc-900/70" : ""}`}
      >
        <ModelLogo modelId={model.id} className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm text-zinc-100">{model.name}</span>
            {isNewModel(model) && <span className="shrink-0 text-[10px] font-medium text-violet-300">New</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-zinc-500">
            {/* By release date, the subscription takes the maker's place (the logo shows the maker). */}
            <span className="shrink-0">{props.showProvider ? MODEL_PROVIDERS[model.provider].short : MODEL_MAKERS[model.maker].name}</span>
            {released && (
              <>
                {dot}
                <span className="shrink-0 tabular-nums" title={model.releasedAt && `Released ${model.releasedAt}`}>
                  {released}
                </span>
              </>
            )}
            {dot}
            <span className="shrink-0 tabular-nums" title={`${model.contextWindow.toLocaleString()}-token context`}>
              {formatTokens(model.contextWindow)}
            </span>
            {vision && <Eye className="size-3 shrink-0 text-emerald-400" aria-label="Sees images" />}
            {levels.length > 0 && (
              <Brain className="size-3 shrink-0" aria-label={levels.includes("off") ? "Thinking optional" : "Always thinks"} />
            )}
            {free && <span className="shrink-0 font-medium text-sky-300">Free</span>}
            {model.trainsOnData && (
              <span title="The provider may train on what you send this model" className="truncate text-amber-300/90">
                Trains on data
              </span>
            )}
          </div>
        </div>
        {props.selected && <Check className="size-4 shrink-0 text-emerald-400" />}
      </button>
    </li>
  )
}

/** Model menu that shows each model's capabilities: image input, context window, and thinking levels. */
function ModelMenu(props: { model: string; onSelect: (model: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  // Where the menu sits: fixed on the screen and outside the page (in a portal), so no card or scroll area clips it.
  const [place, setPlace] = useState<{ upward: boolean; style: CSSProperties } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<ModelProvider | "all">("all")
  // Newest first (remembered on this device), optionally only what came out within some days.
  const [newest, setNewest] = useState(() => {
    try {
      return localStorage.getItem(NEWEST_KEY) === "1"
    } catch {
      return false
    }
  })
  const root = useRef<HTMLDivElement>(null)
  const current = findModel(props.model)
  const { state, stub, connected: online } = useDex()
  const [checking, setChecking] = useState(false)
  const connected: Record<ModelProvider, boolean> = state
    ? connectedProviders(state)
    : { clinepass: true, "opencode-go": true, chatgpt: true, commandcode: true, openrouter: true }
  // Connected subscriptions first; a model matches when every word of the search is in its name, maker, subscription,
  // or badges ("free vision" finds the free models that see images).
  const providers = (Object.keys(MODEL_PROVIDERS) as ModelProvider[]).sort((a, b) => Number(connected[b]) - Number(connected[a]))
  const needle = query.trim().toLowerCase()
  const words = needle.split(/\s+/).filter(Boolean)
  const matches = (model: DexModel) => {
    if (only !== "all" && model.provider !== only) return false
    if (words.length === 0) return true
    const text = `${model.name} ${MODEL_MAKERS[model.maker].name} ${MODEL_PROVIDERS[model.provider].name} ${badges(model).join(" ")}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  // Opens toward whichever side of the screen has more room, as tall as fits there, and follows the button when the
  // page scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open) return
    const MARGIN = 12
    const GAP = 6
    const WIDTH = 320
    const position = () => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      // Fixed positions are relative to the layout viewport, as getBoundingClientRect is.
      const height = window.innerHeight
      const width = window.innerWidth
      const above = rect.top - GAP - MARGIN
      const below = height - rect.bottom - GAP - MARGIN
      const upward = above > below
      const left = Math.max(MARGIN, Math.min(rect.left, width - Math.min(WIDTH, width - 2 * MARGIN) - MARGIN))
      setPlace({
        upward,
        style: {
          left,
          maxHeight: Math.max(160, upward ? above : below),
          ...(upward ? { bottom: height - rect.top + GAP } : { top: rect.bottom + GAP })
        }
      })
    }
    position()
    window.addEventListener("resize", position)
    window.addEventListener("scroll", position, true)
    window.visualViewport?.addEventListener("resize", position)
    return () => {
      window.removeEventListener("resize", position)
      window.removeEventListener("scroll", position, true)
      window.visualViewport?.removeEventListener("resize", position)
    }
  }, [open])

  const toggle = () => {
    setQuery("")
    setOnly("all")
    setOpen((value) => !value)
  }

  const toggleNewest = () => {
    const next = !newest
    setNewest(next)
    try {
      localStorage.setItem(NEWEST_KEY, next ? "1" : "0")
    } catch {}
  }

  const select = (model: DexModel) => {
    props.onSelect(model.id)
    setOpen(false)
  }
  const row = (model: DexModel, showProvider: boolean) => (
    <ModelRow
      key={model.id}
      model={model}
      selected={model.id === props.model}
      usable={connected[model.provider] || model.id === props.model}
      showProvider={showProvider}
      onSelect={() => select(model)}
    />
  )
  // Newest first: every subscription's models in one list, by release date, in sections by how recent.
  const byRelease = newest
    ? MODELS.filter(matches).toSorted((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") || Number(connected[b.provider]) - Number(connected[a.provider]))
    : []
  const sections: Array<{ label: string; models: DexModel[] }> = PERIODS.map((period, index) => ({
    label: period.label as string,
    models: byRelease.filter((model) => {
      const days = daysSinceRelease(model)
      return days !== undefined && days <= period.days && (index === 0 || days > PERIODS[index - 1]!.days)
    })
  })).concat([{ label: "Release date unknown", models: byRelease.filter((model) => daysSinceRelease(model) === undefined) }])

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        disabled={props.disabled}
        onClick={toggle}
        title={`${current?.name ?? props.model} (${current ? MODEL_PROVIDERS[current.provider].name : "unknown"}): ${hasVision(current) ? "can see images" : "reads text only"}`}
        className="flex max-w-full min-w-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 py-1 pr-1.5 pl-1.5 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-50 sm:max-w-48 sm:gap-1.5 sm:pl-2"
      >
        <ModelLogo modelId={props.model} className="size-3.5" />
        <span className="min-w-0 truncate">{current?.name ?? props.model}</span>
        {/* With more than one subscription connected, the same model can come from several: say which. */}
        {current && Object.values(connected).filter(Boolean).length > 1 && (
          <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">{MODEL_PROVIDERS[current.provider].short}</span>
        )}
        {hasVision(current) && <Eye className="size-3.5 shrink-0 text-emerald-400" />}
        <ChevronDown className="hidden size-3.5 shrink-0 text-zinc-500 sm:block" />
      </button>
      {open && place && createPortal(
        <div
          ref={menu}
          style={place.style}
          className={`fixed z-50 flex w-80 max-w-[calc(100vw-1.5rem)] animate-pop flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 ${
            place.upward ? "origin-bottom-left" : "origin-top-left"
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-zinc-500" />
            <input
              // Not on phones, where focusing would pop the keyboard over the list.
              autoFocus={matchMedia("(pointer: fine)").matches}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none md:text-sm"
            />
            <button
              type="button"
              onClick={toggleNewest}
              aria-pressed={newest}
              title={newest ? "Group by subscription" : "Newest first"}
              className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ${
                newest ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              }`}
            >
              <CalendarClock className="size-3.5" />
              Newest
            </button>
          </div>
          {/* One subscription at a time, or all of them. */}
          <div className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-900 px-2 py-1.5">
            {(["all", ...providers] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setOnly(choice)}
                aria-pressed={only === choice}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                  only === choice ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {choice === "all" ? "All" : MODEL_PROVIDERS[choice].name}
                {choice !== "all" && !connected[choice] && <span className={`size-1.5 rounded-full ${only === choice ? "bg-zinc-500" : "bg-zinc-600"}`} title="Not connected" />}
                <span className={only === choice ? "text-zinc-500" : "text-zinc-600"}>
                  {choice === "all" ? MODELS.length : MODELS.filter((model) => model.provider === choice).length}
                </span>
              </button>
            ))}
          </div>
          <div className="scrollbar-thin max-h-80 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
            {newest &&
              sections.map((section) =>
                section.models.length === 0 ? null : (
                  <section key={section.label}>
                    <div className="sticky top-0 z-10 bg-zinc-950/95 px-3 pt-2.5 pb-1 backdrop-blur">
                      <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{section.label}</span>
                    </div>
                    <ul>{section.models.map((model) => row(model, true))}</ul>
                  </section>
                )
              )}
            {!newest && providers.map((provider) => {
              const models = MODELS.filter((model) => model.provider === provider && matches(model))
              if (models.length === 0) return null
              return (
                <section key={provider}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-zinc-950/95 px-3 pt-2.5 pb-1 backdrop-blur">
                    <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{MODEL_PROVIDERS[provider].name}</span>
                    {!connected[provider] && (
                      <Link to="/settings" onClick={() => setOpen(false)} className="ml-auto text-[11px] text-emerald-400 hover:underline">
                        Connect in Settings
                      </Link>
                    )}
                  </div>
                  <ul>{models.map((model) => row(model, false))}</ul>
                </section>
              )
            })}
            {MODELS.every((model) => !matches(model)) && (
              <p className="px-3 py-4 text-center text-xs text-zinc-500">
                {needle ? `No model matches “${query}”.` : "No models."}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 border-t border-zinc-900 px-3 py-1.5 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1" title="Text-only models can't see images or VM screenshots">
              <Eye className="size-3 text-emerald-400" /> sees images
            </span>
            <span className="flex items-center gap-1">
              <Brain className="size-3" /> thinks
            </span>
            {state?.models && state.models.updatedAt > 0 && (
              <span className="ml-auto flex items-center gap-1 text-zinc-600">
                Checked {timeAgo(state.models.updatedAt)}
                <button
                  type="button"
                  title="Check for new and retired models now"
                  aria-label="Check for new models"
                  disabled={!online || checking}
                  onClick={() => {
                    setChecking(true)
                    void stub
                      .refreshModelList()
                      .catch(() => undefined)
                      .finally(() => setChecking(false))
                  }}
                  className="p-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${checking ? "animate-spin" : ""}`} />
                </button>
              </span>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function ModelPicker(props: {
  model: string
  thinking: ThinkingLevel
  onChange: (value: { model: string; thinking: ThinkingLevel }) => void
  disabled?: boolean
}) {
  const levels = supportedThinkingLevels(findModel(props.model))
  return (
    // One line: the model name truncates before anything wraps.
    <div className="flex min-w-0 items-center gap-1">
      <ModelMenu
        model={props.model}
        disabled={props.disabled}
        onSelect={(model) => props.onChange({ model, thinking: clampThinking(findModel(model), props.thinking) })}
      />
      {levels.length > 0 && (
        <div className="relative shrink-0">
          <Brain className="pointer-events-none absolute top-1.5 left-1.5 size-3.5 text-zinc-500" />
          <select
            className={selectClass}
            value={props.thinking}
            disabled={props.disabled}
            title="Thinking level"
            onChange={(event) => props.onChange({ model: props.model, thinking: event.target.value as ThinkingLevel })}
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1.5 right-1 size-3.5 text-zinc-500" />
        </div>
      )}
    </div>
  )
}
