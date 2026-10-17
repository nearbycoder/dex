import type { CSSProperties, ReactNode } from "react"

/**
 * Loading placeholders shaped like the page that is coming, so navigation shows structure at once instead of a
 * blank screen or a spinner. Bones shimmer (styles.css `.dex-bone`) and hold still under Reduce Motion.
 */

export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={`dex-bone rounded-md ${className}`} style={style} />
}

/** Text lines of varied width, like a paragraph. */
export function Lines({ count = 3, className = "" }: { count?: number; className?: string }) {
  const widths = ["92%", "78%", "85%", "64%", "71%"]
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <Bone key={index} className="h-3" style={{ width: widths[index % widths.length] }} />
      ))}
    </div>
  )
}

function Status({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="contents">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  )
}

/** A page title with its one-line description. */
function Heading() {
  return (
    <div className="space-y-2.5">
      <Bone className="h-7 w-40" />
      <Bone className="h-3.5 w-72 max-w-full" />
    </div>
  )
}

function Rows({ count }: { count: number }) {
  return (
    <ul className="divide-y divide-zinc-800/80">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex items-center gap-3 py-3">
          <Bone className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3.5" style={{ width: `${55 - (index % 3) * 10}%` }} />
            <Bone className="h-3" style={{ width: `${35 + (index % 2) * 15}%` }} />
          </div>
          <Bone className="h-6 w-14 shrink-0" />
        </li>
      ))}
    </ul>
  )
}

/** Rows like a settings list: icon, two lines, trailing control. */
export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Status>
      <Rows count={count} />
    </Status>
  )
}

function Card() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start gap-3">
        <Bone className="size-9 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-4 w-3/4" />
          <Bone className="h-3 w-1/2" />
          <Bone className="mt-3 h-3 w-2/3" />
        </div>
      </div>
    </div>
  )
}

/** Cards in a grid, like the Agents, Projects, and Machines lists. */
export function CardGridSkeleton({ count = 4, columns = "sm:grid-cols-2" }: { count?: number; columns?: string }) {
  return (
    <Status>
      <div className={`grid gap-3 ${columns}`}>
        {Array.from({ length: count }, (_, index) => (
          <Card key={index} />
        ))}
      </div>
    </Status>
  )
}

function Field({ tall = false }: { tall?: boolean }) {
  return (
    <div className="space-y-2">
      <Bone className="h-3 w-24" />
      <Bone className={`w-full rounded-lg ${tall ? "h-28" : "h-9"}`} />
    </div>
  )
}

export type PageSkeletonVariant = "list" | "cards" | "form" | "sections"

/** A whole page's body: heading plus a list, a card grid, a form, or stacked sections. */
export function PageSkeleton({ variant = "list", width = "max-w-3xl" }: { variant?: PageSkeletonVariant; width?: string }) {
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={`mx-auto ${width} space-y-6 px-4 pt-6 md:pt-10`}>
          <Heading />
          {variant === "list" && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4">
              <Rows count={5} />
            </div>
          )}
          {variant === "cards" && (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Card key={index} />
              ))}
            </div>
          )}
          {variant === "form" && (
            <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6">
              <Field />
              <Field />
              <Field tall />
              <Bone className="h-9 w-28 rounded-lg" />
            </div>
          )}
          {variant === "sections" &&
            [3, 2].map((lines, index) => (
              <div key={index} className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6">
                <Bone className="h-4 w-32" />
                <Lines count={lines} />
                <Bone className="h-9 w-40 rounded-lg" />
              </div>
            ))}
        </div>
      </div>
    </Status>
  )
}

/** A chat loading: a few alternating messages. The composer stays real, so you can type right away. */
export function ChatSkeleton() {
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          <div className="flex justify-end">
            <Bone className="h-10 w-2/3 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex gap-3">
            <Bone className="size-6 shrink-0 rounded-full" />
            <Lines count={4} className="flex-1" />
          </div>
          <div className="flex justify-end">
            <Bone className="h-10 w-1/2 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex gap-3">
            <Bone className="size-6 shrink-0 rounded-full" />
            <Lines count={3} className="flex-1" />
          </div>
        </div>
      </div>
    </Status>
  )
}

/** The signed-in app before it can render: sidebar and an empty page, so a cold launch shows the app at once. */
export function ShellSkeleton() {
  return (
    <div className="dex-app flex h-[var(--app-height,100dvh)] overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 md:flex lg:w-72">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">Dex</span>
        </div>
        <div className="space-y-1 px-3">
          <Bone className="mb-3 h-9 w-full rounded-lg" />
          {Array.from({ length: 7 }, (_, index) => (
            <Bone key={index} className="h-8" style={{ width: `${88 - (index % 4) * 9}%` }} />
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="dex-topbar flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-4 md:hidden">
          <Bone className="size-6" />
          <img src="/favicon.svg" alt="" className="ml-1 size-6" />
          <span className="font-semibold tracking-tight">Dex</span>
        </header>
        <PageSkeleton />
      </main>
    </div>
  )
}
