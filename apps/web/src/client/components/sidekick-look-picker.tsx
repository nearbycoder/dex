import { Check, Dices, ImagePlus, LoaderCircle, RotateCcw, Wand2, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { lookUrl } from "~/client/lib/sidekick-art"
import { AGENT_COLORS, type AgentColor } from "~/shared/agents"
import { BODIES, EXTRAS, EYES, LABELS, LOOK_PRESETS, MOUTHS, randomLook, type SidekickLook, SKINS, type Skin } from "~/shared/sidekick-look"

const PARTS: Record<keyof SidekickLook, string> = { body: "Body", skin: "Body color", eyes: "Eyes", mouth: "Mouth", extra: "Extra", blush: "Cheeks" }

const sameLook = (a: SidekickLook | null | undefined, b: SidekickLook) =>
  Boolean(a) && a!.body === b.body && a!.skin === b.skin && a!.eyes === b.eyes && a!.mouth === b.mouth && a!.extra === b.extra && a!.blush === b.blush

const tile = (selected: boolean) =>
  `overflow-hidden rounded-full ring-offset-2 ring-offset-zinc-950 transition-transform hover:scale-105 ${selected ? "ring-2 ring-emerald-500" : "ring-1 ring-zinc-800 hover:ring-zinc-600"}`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[6.5rem_1fr] sm:items-center">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/**
 * Picks a sidekick's look: a ready-made one, or their own mix of body, eyes, mouth, extra, and colors (each option
 * drawn on the current look, so you see what you'd get), or a photo instead.
 */
export function SidekickLookPicker({
  look,
  color,
  hasPhoto,
  onChange,
  onPhoto,
  canGenerate,
  generate,
  onPicture
}: {
  look: SidekickLook | null
  color: AgentColor
  hasPhoto: boolean
  onChange: (patch: { look?: SidekickLook | null; color?: AgentColor; image?: null }) => void
  onPhoto: () => void
  /** Whether ChatGPT is connected, which drawing a picture needs. */
  canGenerate: boolean
  /** Draws a picture from a description (empty: from their profile) in a style; resolves to a data: URL to keep. */
  generate: (prompt: string, style: string) => Promise<string>
  onPicture: (image: string) => void
}) {
  const [drawing, setDrawing] = useState(false)
  const background = AGENT_COLORS[color]?.[0] ?? AGENT_COLORS.violet[0]
  // Customizing a photo or an emoji starts from the first ready-made look.
  const current = look ?? LOOK_PRESETS[0]!.look
  const set = (patch: Partial<SidekickLook>) => onChange({ look: { ...current, ...patch }, image: null })
  const option = <K extends keyof SidekickLook>(part: K, value: SidekickLook[K], name: string) => {
    const label = `${PARTS[part]}: ${name}`
    const preview = { ...current, [part]: value }
    const selected = Boolean(look) && current[part] === value
    return (
      <button key={String(value)} type="button" title={label} aria-label={label} aria-pressed={selected} onClick={() => set({ [part]: value } as Partial<SidekickLook>)} className={tile(selected)}>
        <img src={lookUrl(preview, background)} alt="" className="size-11" draggable={false} />
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2.5">
        {LOOK_PRESETS.map((preset) => {
          const presetColor = preset.color as AgentColor
          const selected = sameLook(look, preset.look) && color === presetColor
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.name}
              aria-label={`Look: ${preset.name}`}
              aria-pressed={selected}
              onClick={() => onChange({ look: preset.look, color: presetColor, image: null })}
              className={tile(selected)}
            >
              <img src={lookUrl(preset.look, AGENT_COLORS[presetColor][0])} alt="" className="size-14" draggable={false} />
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
        <button
          type="button"
          aria-expanded={drawing}
          onClick={() => setDrawing(!drawing)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
            drawing ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
          }`}
        >
          <Wand2 className="size-4" /> Draw one
        </button>
        {hasPhoto && !look && (
          <button type="button" onClick={() => onChange({ look: current, image: null })} className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-zinc-500 hover:text-zinc-200">
            <X className="size-4" /> Remove photo
          </button>
        )}
      </div>

      {drawing && <DrawPicture canGenerate={canGenerate} generate={generate} onPicture={(image) => (onPicture(image), setDrawing(false))} />}

      <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3 sm:p-4">
        <Row label="Body">{BODIES.map((value) => option("body", value, LABELS[value]))}</Row>
        <Row label="Eyes">{EYES.map((value) => option("eyes", value, LABELS[value]))}</Row>
        <Row label="Mouth">{MOUTHS.map((value) => option("mouth", value, LABELS[value]))}</Row>
        <Row label="Extra">{EXTRAS.map((value) => option("extra", value, LABELS[value]))}</Row>
        <Row label="Body color">
          {(Object.keys(SKINS) as Skin[]).map((skin) => {
            const selected = Boolean(look) && current.skin === skin
            return (
              <button
                key={skin}
                type="button"
                title={skin}
                aria-label={`Body color ${skin}`}
                aria-pressed={selected}
                onClick={() => set({ skin })}
                className={`size-8 rounded-full ring-offset-2 ring-offset-zinc-950 ${selected ? "ring-2 ring-zinc-200" : ""}`}
                style={{ background: SKINS[skin] }}
              />
            )
          })}
        </Row>
        <Row label="Background">
          {(Object.keys(AGENT_COLORS) as AgentColor[]).map((key) => {
            const [fill, dot] = AGENT_COLORS[key]
            const selected = key === color
            return (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={`Background ${key}`}
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
        <Row label="Cheeks">
          {[true, false].map((blush) => (
            <button
              key={String(blush)}
              type="button"
              aria-pressed={Boolean(look) && current.blush === blush}
              onClick={() => set({ blush })}
              className={`rounded-full border px-3 py-1 text-xs ${
                Boolean(look) && current.blush === blush ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {blush ? "Rosy" : "Plain"}
            </button>
          ))}
        </Row>
      </div>
    </div>
  )
}

const STYLES: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "illustration", label: "Illustration" },
  { id: "3d", label: "3D" },
  { id: "pixel", label: "Pixel art" },
  { id: "anime", label: "Anime" },
  { id: "watercolor", label: "Watercolor" },
  { id: "photo", label: "Photo" }
]

/** Draws a picture with the image model on the user's ChatGPT plan: describe them, pick a style, keep or redo it. */
function DrawPicture({ canGenerate, generate, onPicture }: { canGenerate: boolean; generate: (prompt: string, style: string) => Promise<string>; onPicture: (image: string) => void }) {
  const [prompt, setPrompt] = useState("")
  const [style, setStyle] = useState("illustration")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await generate(prompt.trim(), style))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!canGenerate) {
    return (
      <p className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3 text-sm text-zinc-400">
        Drawing a picture uses your ChatGPT plan's image model. Connect ChatGPT in Settings → Model subscriptions first.
      </p>
    )
  }
  return (
    <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3 sm:p-4">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        maxLength={1_000}
        aria-label="Describe their picture"
        placeholder="A cheerful fox in a green hoodie with round glasses. Leave empty to draw them from their profile."
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {STYLES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={style === option.id}
            onClick={() => setStyle(option.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              style === option.id ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {result && !busy && <img src={result} alt="The drawn picture" className="size-20 rounded-full object-cover ring-1 ring-zinc-700" />}
        {busy && (
          <span className="flex size-20 items-center justify-center rounded-full bg-zinc-900 ring-1 ring-zinc-800">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          {result && !busy && (
            <button type="button" onClick={() => onPicture(result)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              <Check className="size-4" /> Use this
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:text-zinc-500"
          >
            {result ? <RotateCcw className="size-4" /> : <Wand2 className="size-4" />}
            {busy ? "Drawing… about 30 seconds" : result ? "Draw again" : "Draw"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
