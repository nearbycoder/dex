import { Brain, Check, ChevronDown, Eye, Type } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { CLINEPASS_MODELS, type ClinePassModel, clampThinking, findModel, supportedThinkingLevels, type ThinkingLevel } from "~/shared/models"

const selectClass =
  "max-w-44 appearance-none truncate rounded-md border border-zinc-800 bg-zinc-900 py-1 pr-7 pl-2 text-xs text-zinc-300 hover:border-zinc-700 focus:border-emerald-600 focus:outline-none"

export const hasVision = (model: ClinePassModel | undefined) => model?.input.includes("image") ?? false

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
  const root = useRef<HTMLDivElement>(null)
  const current = findModel(props.model)

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
    setOpen((value) => !value)
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={props.disabled}
        onClick={toggle}
        title={hasVision(current) ? "This model can see images" : "This model reads text only"}
        className="flex max-w-48 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 py-1 pr-1.5 pl-2 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-50"
      >
        <span className="truncate">{current?.name ?? props.model}</span>
        {hasVision(current) && <Eye className="size-3.5 shrink-0 text-emerald-400" />}
        <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 ${
            upward ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          <ul className="scrollbar-thin max-h-80 overflow-y-auto py-1">
            {CLINEPASS_MODELS.map((model) => {
              const selected = model.id === props.model
              const levels = supportedThinkingLevels(model)
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelect(model.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-zinc-900 ${selected ? "bg-zinc-900/70" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-100">{model.name}</div>
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
                      </div>
                    </div>
                    {selected && <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />}
                  </button>
                </li>
              )
            })}
          </ul>
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
    <div className="flex flex-wrap items-center gap-1.5">
      <ModelMenu
        model={props.model}
        disabled={props.disabled}
        onSelect={(model) => props.onChange({ model, thinking: clampThinking(findModel(model), props.thinking) })}
      />
      {levels.length > 0 && (
        <div className="relative">
          <Brain className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-zinc-500" />
          <select
            className={`${selectClass} pl-7`}
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
          <ChevronDown className="pointer-events-none absolute top-1.5 right-1.5 size-3.5 text-zinc-500" />
        </div>
      )}
    </div>
  )
}
