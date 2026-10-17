import type { ReactNode } from "react"
import { InfoTip } from "./info-tip"

/**
 * The building blocks settings-style pages share, so every page has the same rhythm: one scroll container, a title
 * with an optional ⓘ, cards with short headings, and explanations behind info tips instead of paragraphs.
 */

/** A scrolling page body with a title row. `actions` sit at the right of the title. */
export function Page({
  title,
  info,
  actions,
  width = "max-w-2xl",
  children
}: {
  title: ReactNode
  info?: ReactNode
  actions?: ReactNode
  width?: string
  children: ReactNode
}) {
  return (
    <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">
      <div className={`mx-auto ${width} space-y-5 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:pt-10`}>
        <div className="flex min-h-9 items-center gap-2">
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {info && <InfoTip label={`About ${typeof title === "string" ? title : "this page"}`}>{info}</InfoTip>}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}

/** A card. Keep `title` to a word or two; anything longer belongs in `info`. */
export function Section({
  title,
  info,
  aside,
  children,
  flush = false
}: {
  title?: ReactNode
  info?: ReactNode
  aside?: ReactNode
  children: ReactNode
  /** No inner padding (for lists that run edge to edge). */
  flush?: boolean
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      {(title || aside) && (
        <div className={`flex min-h-11 items-center gap-1.5 px-4 pt-3 md:px-5 ${flush ? "pb-1" : ""}`}>
          {title && <h2 className="text-sm font-medium text-zinc-100">{title}</h2>}
          {info && <InfoTip label={typeof title === "string" ? `About ${title}` : "More info"}>{info}</InfoTip>}
          {aside && <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-zinc-500">{aside}</div>}
        </div>
      )}
      <div className={flush ? "" : `px-4 pb-4 md:px-5 md:pb-5 ${title || aside ? "pt-2" : "pt-4"}`}>{children}</div>
    </section>
  )
}

/** A row in a settings list: label (with optional ⓘ and one short line) on the left, its control on the right. */
export function Row({ icon, label, detail, info, children }: { icon?: ReactNode; label: ReactNode; detail?: ReactNode; info?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2.5">
      {icon && <span className="shrink-0 text-zinc-500">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm text-zinc-100">
          <span className="min-w-0 truncate">{label}</span>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {detail && <div className="mt-0.5 truncate text-xs text-zinc-500">{detail}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/** An on/off switch. Give `label` for screen readers when there's no visible one. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 rounded-full bg-zinc-700 transition-colors duration-200 peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 after:ease-fluid peer-checked:after:translate-x-4"
      />
    </label>
  )
}

/** A labeled form field. Explanations go in `info`; `hint` is for one short line that must stay visible. */
export function Field({ label, info, hint, children, as = "label" }: { label: ReactNode; info?: ReactNode; hint?: ReactNode; children: ReactNode; as?: "label" | "div" }) {
  const Wrapper = as
  return (
    <Wrapper className="block">
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </Wrapper>
  )
}

export const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"

/** The save bar at the bottom of an editor: stays in reach while the form scrolls. */
export function FormBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      {children}
    </div>
  )
}
