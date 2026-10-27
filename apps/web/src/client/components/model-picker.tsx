import { Link } from "@tanstack/react-router"
import { Brain, Check, ChevronDown, Eye, RefreshCw, Search, Type } from "lucide-react"
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import {
  clampThinking,
  type DexModel,
  findModel,
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

function VisionBadge({ vision }: { vision: boolean }) {
  return vision ? (
    <span className="flex items-center gap-1 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
      <Eye className="size-3" /> Vision
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
      <Type className="size-3" /> Text only
    </span>
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
  const root = useRef<HTMLDivElement>(null)
  const current = findModel(props.model)
  const { state, stub, connected: online } = useDex()
  const [checking, setChecking] = useState(false)
  const connected: Record<ModelProvider, boolean> = state
    ? connectedProviders(state)
    : { clinepass: true, "opencode-go": true, chatgpt: true }
  // Connected subscriptions first; a model matches on its name, maker, or subscription.
  const providers = (Object.keys(MODEL_PROVIDERS) as ModelProvider[]).sort((a, b) => Number(connected[b]) - Number(connected[a]))
  const needle = query.trim().toLowerCase()
  const matches = (model: DexModel) =>
    (only === "all" || model.provider === only) && (!needle || `${model.name} ${MODEL_MAKERS[model.maker].name} ${MODEL_PROVIDERS[model.provider].name}`.toLowerCase().includes(needle))

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
            {providers.map((provider) => {
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
                  <ul>
                    {models.map((model) => {
                      const selected = model.id === props.model
                      const levels = supportedThinkingLevels(model)
                      const usable = connected[provider] || selected
                      const free = model.cost.input === 0 && model.cost.output === 0
                      return (
                        <li key={model.id}>
                          <button
                            type="button"
                            disabled={!usable}
                            onClick={() => {
                              props.onSelect(model.id)
                              setOpen(false)
                            }}
                            className={`flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-zinc-900 disabled:opacity-40 disabled:hover:bg-transparent ${selected ? "bg-zinc-900/70" : ""}`}
                          >
                            <ModelLogo modelId={model.id} className="mt-0.5 size-5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-1.5">
                                <span className="truncate text-sm text-zinc-100">{model.name}</span>
                                <span className="shrink-0 text-[10px] text-zinc-500">{MODEL_MAKERS[model.maker].name}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <VisionBadge vision={hasVision(model)} />
                                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                  {formatTokens(model.contextWindow)} context
                                </span>
                                {levels.length > 0 && (
                                  <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                    <Brain className="size-3" />
                                    {levels.includes("off") ? "thinking optional" : "always thinks"}
                                  </span>
                                )}
                                {free && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">Free</span>}
                                {model.trainsOnData && (
                                  <span
                                    title="The provider may train on what you send this model"
                                    className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                                  >
                                    Trains on data
                                  </span>
                                )}
                              </div>
                            </div>
                            {selected && <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
            {MODELS.every((model) => !matches(model)) && (
              <p className="px-3 py-4 text-center text-xs text-zinc-500">{needle ? `No model matches “${query}”.` : "No models."}</p>
            )}
          </div>
          <p className="shrink-0 border-t border-zinc-900 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
            Text-only models can't see images or VM screenshots. Pick a <span className="text-emerald-400">Vision</span> model for
            those.
            {state?.models && state.models.updatedAt > 0 && (
              <span className="mt-1 flex items-center gap-1 text-zinc-600">
                List checked with the providers {timeAgo(state.models.updatedAt)}.
                <button
                  type="button"
                  title="Check for new and retired models now"
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
          </p>
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
