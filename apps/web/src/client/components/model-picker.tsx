import { Link } from "@tanstack/react-router"
import { Brain, Check, ChevronDown, Eye, Search, Type } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useDex } from "~/client/lib/dex"
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
  const [upward, setUpward] = useState(true)
  const [query, setQuery] = useState("")
  const root = useRef<HTMLDivElement>(null)
  const current = findModel(props.model)
  const { state } = useDex()
  const connected: Record<ModelProvider, boolean> = { clinepass: state?.cline.connected ?? true, "opencode-go": state?.opencode.connected ?? true }
  // Connected subscriptions first; a model matches on its name, maker, or subscription.
  const providers = (Object.keys(MODEL_PROVIDERS) as ModelProvider[]).sort((a, b) => Number(connected[b]) - Number(connected[a]))
  const needle = query.trim().toLowerCase()
  const matches = (model: DexModel) =>
    !needle || `${model.name} ${MODEL_MAKERS[model.maker].name} ${MODEL_PROVIDERS[model.provider].name}`.toLowerCase().includes(needle)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
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

  const toggle = () => {
    // Open toward whichever side of the screen has more room.
    const rect = root.current?.getBoundingClientRect()
    if (rect) setUpward(rect.top > window.innerHeight - rect.bottom)
    setQuery("")
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
        {/* With both subscriptions connected, the same model can come from either: say which. */}
        {current && connected.clinepass && connected["opencode-go"] && (
          <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">{MODEL_PROVIDERS[current.provider].short}</span>
        )}
        {hasVision(current) && <Eye className="size-3.5 shrink-0 text-emerald-400" />}
        <ChevronDown className="hidden size-3.5 shrink-0 text-zinc-500 sm:block" />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 w-80 max-w-[calc(100vw-2rem)] animate-pop overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 ${
            upward ? "bottom-full mb-1.5 origin-bottom-left" : "top-full mt-1.5 origin-top-left"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-zinc-900 px-3 py-2">
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
          <div className="scrollbar-thin max-h-80 overflow-y-auto overscroll-contain pb-1">
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
            {MODELS.every((model) => !matches(model)) && <p className="px-3 py-4 text-center text-xs text-zinc-500">No model matches “{query}”.</p>}
          </div>
          <p className="border-t border-zinc-900 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
            Text-only models can't see images or VM screenshots. Pick a <span className="text-emerald-400">Vision</span> model for
            those.
          </p>
        </div>
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
