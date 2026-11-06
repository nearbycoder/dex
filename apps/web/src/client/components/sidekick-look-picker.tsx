import type { BoopFaceSkinInfo, BoopFaceSkinSeries } from "boopface"
import { Dices, ImagePlus, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AGENT_COLORS, type AgentColor } from "~/shared/agents"
import { LOOK_PRESETS, randomLook, type SidekickLook, SKINS, type Skin } from "~/shared/sidekick-look"
import { BoopAvatar, loadBoopFace } from "./boop-face"

const sameLook = (a: SidekickLook | null | undefined, b: SidekickLook) => Boolean(a) && a!.skin === b.skin && (a!.finish ?? null) === (b.finish ?? null)

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[6.5rem_1fr] sm:items-start">
      <span className="text-xs font-medium text-zinc-500 sm:pt-2">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** BoopFace's finishes, by series: read from BoopFace once it has loaded. */
function useFinishes() {
  const [catalog, setCatalog] = useState<{ series: ReadonlyArray<BoopFaceSkinSeries>; skins: Readonly<Record<string, BoopFaceSkinInfo>> } | null>(null)
  useEffect(() => {
    let live = true
    void loadBoopFace().then((module) => live && setCatalog({ series: module.SKIN_SERIES, skins: module.SKINS }))
    return () => {
      live = false
    }
  }, [])
  return catalog
}

/**
 * Picks a sidekick's look: a ready-made BoopFace, or a color, or one of BoopFace's finishes (glaze, gummy, metal, wood,
 * fruit…), or a photo instead. The big face above shows the result, live.
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
  const set = (patch: Partial<SidekickLook>) => onChange({ look: { ...current, ...patch }, image: null })
  const catalog = useFinishes()
  const finishSeries = catalog?.series.find((series) => series.skins.some((skin) => Number(skin) === current.finish))
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const shown = catalog?.series.find((series) => series.id === (seriesId ?? finishSeries?.id)) ?? catalog?.series[0]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2.5">
        {LOOK_PRESETS.map((preset) => {
          const presetColor = preset.color as AgentColor
          const selected = sameLook(look, preset.look)
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.name}
              aria-label={`Look: ${preset.name}`}
              aria-pressed={selected}
              onClick={() => onChange({ look: preset.look, color: presetColor, image: null })}
              className={`rounded-xl p-1.5 transition-transform hover:scale-105 ${selected ? "bg-zinc-800 ring-2 ring-emerald-500" : "bg-zinc-900/60 ring-1 ring-zinc-800 hover:ring-zinc-600"}`}
            >
              <BoopAvatar look={preset.look} size={44} />
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
        <Row label="Color">
          {(Object.keys(SKINS) as Skin[]).map((skin) => {
            const selected = Boolean(look) && !current.finish && current.skin === skin
            return (
              <button
                key={skin}
                type="button"
                title={skin}
                aria-label={`Color ${skin}`}
                aria-pressed={selected}
                onClick={() => set({ skin, finish: null })}
                className={`size-8 rounded-[30%] ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : "ring-1 ring-zinc-700/60"}`}
                style={{ background: SKINS[skin] }}
              />
            )
          })}
        </Row>
        <Row label="Finish">
          {!catalog ? (
            <span className="py-2 text-xs text-zinc-600">Loading finishes…</span>
          ) : (
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
                {catalog.series.map((series) => (
                  <button
                    key={series.id}
                    type="button"
                    aria-pressed={shown?.id === series.id}
                    onClick={() => setSeriesId(series.id)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                      shown?.id === series.id ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {series.titleEn}
                    {finishSeries?.id === series.id && <span className={`ml-1 inline-block size-1.5 rounded-full align-middle ${shown?.id === series.id ? "bg-emerald-600" : "bg-emerald-400"}`} />}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {shown?.skins.map((skin) => {
                  const info = catalog.skins[skin]
                  const selected = Boolean(look) && current.finish === Number(skin)
                  const base = info?.base ?? []
                  return (
                    <button
                      key={skin}
                      type="button"
                      title={`${info?.titleEn ?? skin} (${skin})`}
                      aria-label={`Finish ${info?.titleEn ?? skin}`}
                      aria-pressed={selected}
                      onClick={() => set({ finish: Number(skin) })}
                      className={`size-8 rounded-[30%] ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : "ring-1 ring-zinc-700/60"}`}
                      style={{ background: base.length > 1 ? `linear-gradient(135deg, ${base.join(", ")})` : (base[0] ?? "#27272a") }}
                    />
                  )
                })}
              </div>
              {current.finish != null && look && (
                <button type="button" onClick={() => set({ finish: null })} className="text-xs text-zinc-500 hover:text-zinc-200">
                  Back to the plain color
                </button>
              )}
            </div>
          )}
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
