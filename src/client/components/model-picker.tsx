import { Brain, ChevronDown } from "lucide-react"
import { CLINEPASS_MODELS, findModel, supportedThinkingLevels, type ThinkingLevel } from "~/shared/models"

const selectClass =
  "max-w-44 appearance-none truncate rounded-md border border-zinc-800 bg-zinc-900 py-1 pr-7 pl-2 text-xs text-zinc-300 hover:border-zinc-700 focus:border-emerald-600 focus:outline-none"

export function ModelPicker(props: {
  model: string
  thinking: ThinkingLevel
  onChange: (value: { model: string; thinking: ThinkingLevel }) => void
  disabled?: boolean
}) {
  const levels = supportedThinkingLevels(findModel(props.model))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <select
          className={selectClass}
          value={props.model}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ model: event.target.value, thinking: props.thinking })}
        >
          {CLINEPASS_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1.5 right-1.5 size-3.5 text-zinc-500" />
      </div>
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
