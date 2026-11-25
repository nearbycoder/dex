import { Dices, ImagePlus, X } from "lucide-react"
import type { ReactNode } from "react"
import { AGENT_COLORS, type AgentColor } from "~/shared/agents"
import { LOOK_PRESETS, lookMaterial, makeLook, MATERIAL_LABELS, MATERIALS, type Material, randomLook, sameLook, SHAPES, type SidekickLook, SKINS, type Skin } from "~/shared/sidekick-look"
import { SidekickFace } from "./sidekick-face"

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[6.5rem_1fr] sm:items-start">
      <span className="text-xs font-medium text-zinc-500 sm:pt-2">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
    </div>
  )
}

const tile = (selected: boolean) =>
  `rounded-xl p-1.5 transition-transform hover:scale-105 ${selected ? "bg-zinc-800 ring-2 ring-emerald-500" : "bg-zinc-900/60 ring-1 ring-zinc-800 hover:ring-zinc-600"}`

/**
 * Picks a sidekick's look: a ready-made sidekick, or a shape (a robot, a cloud, a mug…) in a color, or a photo
 * instead. A shape a chat drew shows among the shapes while it's the look. The big face above shows the result, live.
 */
export function SidekickLookPicker({
  look,
  color,
  hasPhoto,
  onChange,
  onPhoto
}: {
  look: SidekickLook | null
  color: AgentColor
  hasPhoto: boolean
  onChange: (patch: { look?: SidekickLook | null; color?: AgentColor; image?: null }) => void
  onPhoto: () => void
}) {
  // Customizing a photo or an emoji starts from the first ready-made look.
  const current = look ?? LOOK_PRESETS[0]!.look
  const material = lookMaterial(current)
  const set = (next: SidekickLook) => onChange({ look: next, image: null })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2.5">
        {LOOK_PRESETS.map((preset) => {
          const selected = sameLook(look, preset.look)
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.name}
              aria-label={`Look: ${preset.name}`}
              aria-pressed={selected}
              onClick={() => onChange({ look: preset.look, color: preset.color as AgentColor, image: null })}
              className={tile(selected)}
            >
              <SidekickFace look={preset.look} size={44} mood="still" />
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange({ look: randomLook(), color: (Object.keys(AGENT_COLORS) as AgentColor[])[Math.floor(Math.random() * 8)], image: null })}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
        >
          <Dices className="size-4" /> Shuffle
        </button>
        <button
          type="button"
          onClick={onPhoto}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
        >
          <ImagePlus className="size-4" /> {hasPhoto && !look ? "Change photo" : "Use a photo"}
        </button>
        {hasPhoto && !look && (
          <button type="button" onClick={() => onChange({ look: current, image: null })} className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-zinc-500 hover:text-zinc-200">
            <X className="size-4" /> Remove photo
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3 sm:p-4">
        <Row label="Material">
          {MATERIALS.map((option: Material) => {
            const selected = Boolean(look) && material === option
            const candidate = makeLook(current.shape, current.skin, current.custom ?? null, option)
            const label = MATERIAL_LABELS[option]
            return (
              <button
                key={option}
                type="button"
                aria-label={`Material ${label}`}
                aria-pressed={selected}
                onClick={() => set(candidate)}
                className={`flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-2 text-sm transition-colors ${
                  selected ? "bg-zinc-800 text-zinc-100 ring-2 ring-emerald-500" : "bg-zinc-900/60 text-zinc-300 ring-1 ring-zinc-800 hover:text-zinc-100 hover:ring-zinc-600"
                }`}
              >
                <SidekickFace look={candidate} size={26} mood="still" />
                {label}
              </button>
            )
          })}
        </Row>
        <Row label="Shape">
          {current.shape === "custom" && current.custom && (
            <button type="button" title={current.custom.name} aria-label={`Shape ${current.custom.name}`} aria-pressed={Boolean(look)} className={tile(Boolean(look))}>
              <SidekickFace look={current} size={36} mood="still" />
            </button>
          )}
          {SHAPES.map((shape) => {
            const selected = Boolean(look) && current.shape === shape.key
            const candidate = makeLook(shape.key, current.skin, null, material)
            return (
              <button
                key={shape.key}
                type="button"
                title={shape.name}
                aria-label={`Shape ${shape.name}`}
                aria-pressed={selected}
                onClick={() => set(candidate)}
                className={tile(selected)}
              >
                <SidekickFace look={candidate} size={36} mood="still" />
              </button>
            )
          })}
          <p className="w-full pt-1 text-xs text-zinc-600">Want something else? Ask a chat to draw your sidekick as anything, like “a teapot” or “a cactus”.</p>
        </Row>
        <Row label="Color">
          {(Object.keys(SKINS) as Skin[]).map((skin) => {
            const selected = Boolean(look) && current.skin === skin
            return (
              <button
                key={skin}
                type="button"
                title={skin}
                aria-label={`Color ${skin}`}
                aria-pressed={selected}
                onClick={() => set(makeLook(current.shape, skin, current.custom ?? null, material))}
                className={`size-8 rounded-[30%] ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : "ring-1 ring-zinc-700/60"}`}
                style={{ background: SKINS[skin] }}
              />
            )
          })}
        </Row>
        <Row label="Accent">
          {(Object.keys(AGENT_COLORS) as AgentColor[]).map((key) => {
            const [fill, dot] = AGENT_COLORS[key]
            const selected = key === color
            return (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={`Accent ${key}`}
                aria-pressed={selected}
                onClick={() => onChange({ color: key })}
                className={`flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : ""}`}
                style={{ background: fill }}
              >
                <span className="size-3 rounded-full" style={{ background: dot }} />
              </button>
            )
          })}
        </Row>
      </div>
    </div>
  )
}
