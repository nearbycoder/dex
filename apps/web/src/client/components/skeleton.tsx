import { useRouterState } from "@tanstack/react-router"
import type { CSSProperties, ReactNode } from "react"

/**
 * Loading placeholders that match the page they stand in for: the same padding, widths, card shapes, and rows,
 * so nothing jumps when the data arrives. Bones shimmer (styles.css `.dex-bone`) and hold still under Reduce Motion.
 * To compare a skeleton with its page in development, set `sessionStorage["dex-skeleton"] = "1"` and reload.
 */

export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  // A radius given in `className` replaces the default instead of competing with it.
  return <div aria-hidden="true" className={`dex-bone ${/(^|\s)rounded/.test(className) ? "" : "rounded-md "}${className}`} style={style} />
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

const widthAt = (index: number, widths: number[]) => `${widths[index % widths.length]}%`

/**
 * A bone the height of one line of text (its line box, not just the glyphs): `text-base` lines are 24px, `text-sm`
 * 20px, `text-xs` 16px.
 */
function LineBone({ size, width }: { size: "base" | "sm" | "xs"; width: string }) {
  const [box, bar] = size === "base" ? ["h-6", "h-4"] : size === "sm" ? ["h-5", "h-3.5"] : ["h-4", "h-3"]
  return (
    <div className={`flex ${box} items-center`}>
      <Bone className={bar} style={{ width }} />
    </div>
  )
}


// ── Pieces shared by several pages ─────────────────────────────────────────

/** A row like ui.tsx's Row: icon, label (and optional detail line), trailing control. */
function RowBones({ index = 0, detail = false, control = "h-6 w-10 rounded-full", icon = "size-4" }: { index?: number; detail?: boolean; control?: string; icon?: string }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2.5">
      <Bone className={`shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">
        <LineBone size="sm" width={widthAt(index, [42, 56, 35, 48])} />
        {detail && (
          <div className="mt-0.5">
            <LineBone size="xs" width={widthAt(index, [28, 36, 22])} />
          </div>
        )}
      </div>
      <Bone className={`shrink-0 ${control}`} />
    </div>
  )
}

/** Rows like a settings list (used inside sections that load their own data, e.g. scheduled prompts). */
export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Status>
      <div className="divide-y divide-zinc-800/80">
        {Array.from({ length: count }, (_, index) => (
          <RowBones key={index} index={index} detail control="size-7 rounded-md" />
        ))}
      </div>
    </Status>
  )
}

/** A card like ui.tsx's Section: a short title, then its body. */
function SectionBones({ title = 80, children }: { title?: number; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex min-h-11 items-center px-4 pt-3 md:px-5">
        <Bone className="h-3.5" style={{ width: title }} />
      </div>
      <div className="px-4 pt-2 pb-4 md:px-5 md:pb-5">{children}</div>
    </div>
  )
}

/** ui.tsx's Page: the scroll container, a title row, and sections. */
function PageBones({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-6 md:pt-10">
        <div className="flex min-h-9 items-center gap-2">
          <Bone className="h-7 w-40" />
        </div>
        {children}
      </div>
    </div>
  )
}

/** A top bar like the Chat, Machines, and Usage pages' own headers. */
function HeaderBones({ children }: { children?: ReactNode }) {
  return (
    <div className="dex-topbar flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 px-4">
      <Bone className="size-6 md:hidden" />
      {children}
    </div>
  )
}

/** The chat composer: a rounded box with the message line and the model / thinking / MCP chips. */
function ComposerBones() {
  return (
    <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900/60 p-2.5">
        <Bone className="m-1.5 h-4 w-48" />
        <div className="mt-3 flex items-center gap-1.5">
          <Bone className="h-7 w-20 rounded-lg" />
          <Bone className="h-7 w-20 rounded-lg" />
          <Bone className="h-7 w-7 rounded-lg" />
          <Bone className="ml-auto size-8 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ── Chats ───────────────────────────────────────────────────────────────────

/** A chat's transcript while it loads: a message from you, then a reply with its activity row and text. */
export function ChatSkeleton() {
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {[3, 2].map((lines, index) => (
            <div key={index} className="space-y-5">
              <div className="flex justify-end">
                <Bone className={`h-11 rounded-2xl rounded-br-md ${index === 0 ? "w-2/3" : "w-1/2"}`} />
              </div>
              <div className="flex gap-3">
                <Bone className="mt-0.5 size-6 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Bone className="h-9 w-full rounded-lg" />
                  <Lines count={lines} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Status>
  )
}

/** The whole chat page (header, transcript, composer), for when the page itself is still loading. */
function ChatPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HeaderBones>
        <Bone className="h-4 w-44" />
      </HeaderBones>
      <ChatSkeleton />
      <ComposerBones />
    </div>
  )
}

/** The new-chat page's project chips and agent cards, while agents and projects load. */
export function PickersSkeleton() {
  return (
    <Status>
      <div className="mt-5 mb-2 flex h-4 items-center px-1">
        <Bone className="h-3 w-16" />
        <Bone className="ml-auto h-3 w-14" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bone className="h-[38px] w-40 rounded-lg" />
        <Bone className="h-[38px] w-32 rounded-lg" />
      </div>
      <div className="mt-5 mb-2 flex h-4 items-center px-1">
        <Bone className="h-3 w-14" />
        <Bone className="ml-auto h-3 w-14" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-start gap-2.5 rounded-xl border border-zinc-800/80 p-2.5 sm:gap-3 sm:px-3.5 sm:py-3">
            <Bone className="size-8 shrink-0 rounded-[9px]" />
            <div className="min-w-0 flex-1">
              <LineBone size="sm" width={widthAt(index, [70, 82, 60])} />
              {/* The description shows from sm up, like the real card's. */}
              <div className="mt-0.5 hidden sm:block">
                <div className="flex h-[19.5px] items-center">
                  <Bone className="h-3 w-full" />
                </div>
                <div className="flex h-[19.5px] items-center">
                  <Bone className="h-3" style={{ width: widthAt(index, [60, 45, 70]) }} />
                </div>
              </div>
              <div className="mt-0.5 flex h-[16.5px] items-center sm:mt-1.5">
                <Bone className="h-2.5" style={{ width: widthAt(index, [48, 56, 40]) }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Status>
  )
}

function NewChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden px-4">
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-end pt-6 pb-4 md:pt-10">
          <div className="mb-5 flex h-8 items-center justify-center md:h-9">
            <Bone className="h-6 w-56 md:h-7" />
          </div>
          <PickersSkeleton />
        </div>
      </div>
      <ComposerBones />
    </div>
  )
}

/** The sidebar's chat list: a title line and a model / time line per chat. */
export function ChatListSkeleton() {
  return (
    <Status>
      {[82, 64, 74, 56, 70, 60].map((width, index) => (
        <div key={index} className="mb-0.5 rounded-lg px-2.5 py-2">
          <LineBone size="sm" width={`${width}%`} />
          <div className="mt-0.5">
            <LineBone size="xs" width={`${width / 2 + 10}%`} />
          </div>
        </div>
      ))}
    </Status>
  )
}

// ── Lists of cards ──────────────────────────────────────────────────────────

/** An agent or project card: avatar, name, description, details, and its Start chat / Edit buttons. */
function ProfileCard({ index, project }: { index: number; project: boolean }) {
  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start gap-3">
        <Bone className="size-10 shrink-0 rounded-[11px]" />
        <div className="min-w-0 flex-1">
          <LineBone size="base" width={widthAt(index, [55, 68, 45])} />
          <div className="mt-0.5">
            <LineBone size="sm" width="100%" />
            <LineBone size="sm" width={widthAt(index, [60, 40, 72])} />
          </div>
        </div>
      </div>
      {project && (
        <div className="mt-3">
          <LineBone size="xs" width="50%" />
        </div>
      )}
      <div className={project ? "mt-2" : "mt-3"}>
        <LineBone size="xs" width={widthAt(index, [64, 52, 70])} />
      </div>
      <div className="mt-4 flex gap-2">
        <Bone className="h-[34px] flex-1 rounded-lg" />
        <Bone className="h-[34px] w-16 rounded-lg" />
      </div>
    </div>
  )
}

/** An MCP server card: name and auth chip with icon actions, URL, status with the "New chats" switch, tools. */
function McpCard({ index }: { index: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center gap-2">
            <Bone className="h-4" style={{ width: widthAt(index, [30, 22, 26]) }} />
            <Bone className="h-4 w-14 rounded" />
          </div>
          <div className="mt-0.5">
            <LineBone size="xs" width={widthAt(index, [60, 70, 52])} />
          </div>
        </div>
        <div className="-mt-1 -mr-1.5 flex">
          {[0, 1, 2].map((icon) => (
            <span key={icon} className="p-1.5">
              <Bone className="size-4" />
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Bone className="h-3 w-16" />
        <Bone className="ml-auto h-3 w-16" />
        <Bone className="h-6 w-10 rounded-full" />
      </div>
      <div className="mt-2">
        <LineBone size="xs" width="30%" />
      </div>
    </div>
  )
}

/** A machine card: avatar, chat title, subtitle, status line (it wraps on phones), and its action bar. */
function MachineCard({ index }: { index: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-start gap-3 p-4">
        <Bone className="size-9 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <LineBone size="sm" width={widthAt(index, [75, 60, 82])} />
          <div className="mt-0.5">
            <LineBone size="xs" width="25%" />
          </div>
          <div className="mt-2 space-y-1">
            <LineBone size="xs" width="60%" />
            <LineBone size="xs" width="30%" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-800/80 px-2 py-1.5">
        <Bone className="h-6 w-20" />
        <Bone className="h-6 w-24" />
      </div>
    </div>
  )
}

export type CardKind = "agent" | "project" | "mcp" | "machine"

/** Cards shaped like the ones the list shows once loaded. */
export function CardGridSkeleton({ kind, count = 4, columns = "sm:grid-cols-2" }: { kind: CardKind; count?: number; columns?: string }) {
  return (
    <Status>
      <div className={`grid gap-3 ${columns}`}>
        {Array.from({ length: count }, (_, index) =>
          kind === "mcp" ? (
            <McpCard key={index} index={index} />
          ) : kind === "machine" ? (
            <MachineCard key={index} index={index} />
          ) : (
            <ProfileCard key={index} index={index} project={kind === "project"} />
          )
        )}
      </div>
    </Status>
  )
}

/** The Agents, Projects, and MCP servers pages: title with its New button, then cards. */
function ListPageSkeleton({ kind }: { kind: CardKind }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 pt-6 md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <Bone className="h-7 w-36" />
          <Bone className="ml-auto h-9 w-32 rounded-lg" />
        </div>
        {/* The MCP page's registry search. */}
        {kind === "mcp" && <Bone className="mb-6 h-[42px] w-full rounded-xl" />}
        <CardGridSkeleton kind={kind} count={kind === "mcp" ? 3 : 4} columns={kind === "mcp" ? "" : "sm:grid-cols-2"} />
      </div>
    </div>
  )
}

/** A skill card: /name and source chip with icon actions, two description lines, then size and the Auto switch. */
function SkillCard({ index }: { index: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex h-5 items-center gap-2">
            <Bone className="h-3.5" style={{ width: widthAt(index, [24, 32, 20]) }} />
            <Bone className="h-4 w-20 rounded" />
          </div>
          <div className="mt-1">
            <LineBone size="xs" width="92%" />
            <LineBone size="xs" width={widthAt(index, [55, 70, 40])} />
          </div>
        </div>
        <div className="-mt-1 -mr-1.5 flex">
          {[0, 1, 2].map((icon) => (
            <span key={icon} className="p-1.5">
              <Bone className="size-4" />
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Bone className="h-3 w-20" />
        <Bone className="ml-auto h-3 w-12" />
        <Bone className="h-6 w-10 rounded-full" />
      </div>
    </div>
  )
}

/** Installed skills on the Skills page. */
export function SkillCardsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <Status>
      <div className="grid gap-3">
        {Array.from({ length: count }, (_, index) => (
          <SkillCard key={index} index={index} />
        ))}
      </div>
    </Status>
  )
}

/** The Skills page: title and New button, the skills.sh search with its suggestion chips, then installed skills. */
function SkillsPageSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 pt-6 md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <Bone className="h-7 w-20" />
          <Bone className="ml-auto h-9 w-28 rounded-lg" />
        </div>
        <Bone className="h-[42px] w-full rounded-xl" />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[36, 92, 80, 54, 40, 36].map((width, index) => (
            <Bone key={index} className="h-[26px] rounded-full" style={{ width }} />
          ))}
        </div>
        <div className="mt-8 mb-2 flex h-4 items-center px-1">
          <Bone className="h-3 w-16" />
        </div>
        <SkillCardsSkeleton count={2} />
      </div>
    </div>
  )
}

/** A skill's editor: back link, /name and source, name, description, instructions, Auto, and the save bar. */
export function SkillEditorSkeleton() {
  const label = (width: string) => <LineBone size="sm" width={width} />
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-2xl px-4 pt-6 md:pt-10">
          <div className="mb-4 flex h-5 items-center">
            <Bone className="h-3.5 w-14" />
          </div>
          <div className="mb-6">
            <div className="flex h-8 items-center">
              <Bone className="h-6 w-48" />
            </div>
            <div className="mt-0.5">
              <LineBone size="sm" width="35%" />
            </div>
          </div>
          <div className="space-y-6">
            <div>
              {label("12%")}
              <Bone className="mt-2 h-[38px] w-full rounded-lg" />
            </div>
            <div>
              {label("24%")}
              <Bone className="mt-2 h-[78px] w-full rounded-lg" />
            </div>
            <div>
              {label("20%")}
              <Bone className="mt-2 h-[330px] w-full rounded-lg" />
            </div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {label("10%")}
                <LineBone size="xs" width="50%" />
              </div>
              <Bone className="h-6 w-10 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </Status>
  )
}

function MachinesPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HeaderBones>
        <Bone className="h-4 w-20" />
        <Bone className="ml-auto size-6" />
      </HeaderBones>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-4xl px-4 pt-5 md:pt-8">
          <CardGridSkeleton kind="machine" count={2} columns="md:grid-cols-2" />
        </div>
      </div>
    </div>
  )
}

// ── Single pages ────────────────────────────────────────────────────────────

/** Rows like the VM activity feed: who ran it, what, and when. */
export function ActivityRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-zinc-800/60">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-2 px-3 py-2.5">
          <Bone className="h-5 w-12 shrink-0 rounded" />
          <Bone className="h-3.5" style={{ width: widthAt(index, [55, 40, 62, 34, 48]) }} />
          <Bone className="ml-auto h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** A Machine page: its header, the chat title, the desktop, and the activity feed. */
export function MachineSkeleton() {
  return (
    <Status>
      <div className="flex min-h-0 flex-1 flex-col">
        <HeaderBones>
          <Bone className="h-4 w-24" />
          <Bone className="ml-auto h-6 w-20 rounded-md" />
          <Bone className="size-6" />
        </HeaderBones>
        <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-4">
          <div className="mb-3">
            <LineBone size="sm" width="75%" />
            <LineBone size="sm" width="10rem" />
          </div>
          <div className="grid gap-3 lg:grid-cols-5 lg:items-start">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-3">
              <div className="flex h-10 items-center border-b border-zinc-800 px-3">
                <Bone className="h-3 w-20" />
              </div>
              <div className="aspect-video w-full bg-black" />
            </div>
            <div className="h-[28rem] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 lg:col-span-2 lg:h-[34rem]">
              <div className="flex h-10 items-center border-b border-zinc-800 px-3">
                <Bone className="h-3 w-16" />
              </div>
              <ActivityRowsSkeleton count={10} />
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex h-10 items-center border-b border-zinc-800 px-3">
                <Bone className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-2 p-3">
                <Bone className="h-[34px] w-24 rounded-md" />
                <Bone className="h-[30px] w-20 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Status>
  )
}

/** One labeled form field: the label's line, then a control of the given height. */
function FieldBones({ height, label = "30%" }: { height: number; label?: string }) {
  return (
    <div>
      <LineBone size="sm" width={label} />
      <Bone className="mt-2 w-full rounded-lg" style={{ height }} />
    </div>
  )
}

function TwoFields({ height, columns = "sm:grid-cols-2" }: { height: number; columns?: string }) {
  return (
    <div className={`grid gap-4 ${columns}`}>
      <FieldBones height={height} label="25%" />
      <FieldBones height={height} label="35%" />
    </div>
  )
}

function IconsField() {
  return (
    <div>
      <LineBone size="sm" width="12%" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from({ length: 24 }, (_, index) => (
          <Bone key={index} className="size-9 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function ColorsField() {
  return (
    <div>
      <LineBone size="sm" width="14%" />
      <div className="mt-2 flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Bone key={index} className="size-9 rounded-full" />
        ))}
      </div>
    </div>
  )
}

export type EditorKind = "agent" | "project" | "mcp"

/** The Agent, Project, and MCP server editors: back link, avatar (or title) and status, then that editor's fields. */
export function EditorSkeleton({ kind }: { kind: EditorKind }) {
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-2xl px-4 pt-6 md:pt-10">
          <div className="mb-4">
            <LineBone size="sm" width="6rem" />
          </div>
          {kind === "mcp" ? (
            <div>
              <div className="flex h-8 items-center">
                <Bone className="h-6 w-44" />
              </div>
              <div className="mt-1">
                <LineBone size="sm" width="5rem" />
              </div>
            </div>
          ) : (
            <div className="mb-6 flex items-center gap-4">
              <Bone className="size-14 shrink-0 rounded-[16px]" />
              <div className="min-w-0 flex-1">
                <div className="flex h-8 items-center">
                  <Bone className="h-6 w-44" />
                </div>
                <LineBone size="sm" width="70%" />
              </div>
            </div>
          )}
          <div className={`space-y-6 ${kind === "mcp" ? "mt-6" : ""}`}>
            {kind === "agent" && (
              <>
                <TwoFields height={42} />
                <IconsField />
                <ColorsField />
                <FieldBones height={27} label="40%" />
                <FieldBones height={76} label="28%" />
                <FieldBones height={236} label="25%" />
                <FieldBones height={42} label="30%" />
              </>
            )}
            {kind === "project" && (
              <>
                <TwoFields height={46} />
                {/* Repositories: a repo card and the Add repository button. */}
                <FieldBones height={116} label="30%" />
                <FieldBones height={151} label="28%" />
                <FieldBones height={130} label="26%" />
                <TwoFields height={42} />
                {/* Picture: the "none" tile and pictures found in the repo. */}
                <FieldBones height={48} label="16%" />
                <IconsField />
                <ColorsField />
              </>
            )}
            {kind === "mcp" && (
              <>
                <TwoFields height={46} columns="sm:grid-cols-[1fr_2fr]" />
                <FieldBones height={42} label="32%" />
                <FieldBones height={70} label="20%" />
                <LineBone size="sm" width="20%" />
                <LineBone size="sm" width="36%" />
              </>
            )}
          </div>
        </div>
      </div>
    </Status>
  )
}

/** Settings: device rows, ClinePass, OpenCode Go, cloud VMs, GitHub, new-chat defaults, scheduled prompts, account. */
export function SettingsSkeleton() {
  return (
    <Status>
      <PageBones>
        <SectionBones title={84}>
          <div className="divide-y divide-zinc-800/80">
            <RowBones index={0} control="h-4 w-36" />
            <RowBones index={1} />
          </div>
        </SectionBones>
        <SectionBones title={70}>
          <div className="flex h-6 items-center gap-2">
            <Bone className="size-4 rounded-full" />
            <Bone className="h-3.5 w-24" />
            <Bone className="ml-auto h-3.5 w-28" />
          </div>
        </SectionBones>
        {/* OpenCode Go: connected, like ClinePass. */}
        <SectionBones title={88}>
          <div className="flex h-6 items-center gap-2">
            <Bone className="size-4 rounded-full" />
            <Bone className="h-3.5 w-24" />
            <Bone className="ml-auto h-3.5 w-28" />
          </div>
        </SectionBones>
        {/* Cloud VMs: connected, like ClinePass. */}
        <SectionBones title={76}>
          <div className="flex h-6 items-center gap-2">
            <Bone className="size-4 rounded-full" />
            <Bone className="h-3.5 w-40" />
            <Bone className="ml-auto h-3.5 w-14" />
          </div>
        </SectionBones>
        <SectionBones title={56}>
          <LineBone size="sm" width="95%" />
          <LineBone size="sm" width="60%" />
          <Bone className="mt-3 h-[42px] w-full rounded-lg" />
        </SectionBones>
        <SectionBones title={76}>
          <div className="flex gap-1.5">
            <Bone className="h-8 w-24 rounded-lg" />
            <Bone className="h-8 w-20 rounded-lg" />
          </div>
          <div className="mt-4">
            <LineBone size="sm" width="40%" />
            <Bone className="mt-2 h-[138px] w-full rounded-lg" />
          </div>
        </SectionBones>
        <SectionBones title={120}>
          <LineBone size="sm" width="35%" />
        </SectionBones>
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 pt-4 pb-4 md:px-5 md:pb-5">
          <div className="divide-y divide-zinc-800/80">
            <RowBones index={0} detail icon="size-7 rounded-full" control="h-[34px] w-24 rounded-lg" />
            <RowBones index={1} control="h-[34px] w-24 rounded-lg" />
          </div>
        </div>
      </PageBones>
    </Status>
  )
}

/** Secrets: the add form (name and note, then value with Save), then the saved list. */
export function SecretsSkeleton() {
  return (
    <Status>
      <PageBones>
        <SectionBones title={92}>
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Bone className="h-[38px] w-full rounded-lg" />
              <Bone className="h-[38px] w-full rounded-lg" />
            </div>
            <div className="flex gap-2">
              <Bone className="h-[38px] flex-1 rounded-lg" />
              <Bone className="h-[38px] w-[72px] rounded-lg" />
            </div>
          </div>
        </SectionBones>
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <div className="flex min-h-11 items-center px-4 pt-3 pb-1 md:px-5">
            <Bone className="h-3.5 w-12" />
          </div>
          <div className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
            {[0, 1].map((index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3 md:px-5">
                <Bone className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <LineBone size="sm" width={widthAt(index, [40, 30])} />
                  <LineBone size="xs" width={widthAt(index, [55, 35])} />
                </div>
                <Bone className="h-6 w-16" />
                <Bone className="size-7" />
              </div>
            ))}
          </div>
        </div>
      </PageBones>
    </Status>
  )
}

/** Notifications: this device (the switches once on, the button before). */
export function NotificationsSkeleton() {
  return (
    <Status>
      <PageBones>
        <SectionBones title={84}>
          <Bone className="h-9 w-56 rounded-lg" />
          <div className="mt-3">
            <LineBone size="sm" width="40%" />
          </div>
        </SectionBones>
      </PageBones>
    </Status>
  )
}

/** Access & API: the MCP endpoint and token form, then the activity log. */
export function AccessSkeleton() {
  return (
    <Status>
      <PageBones>
        <SectionBones title={36}>
          <div className="space-y-4">
            <div>
              <LineBone size="xs" width="40%" />
              <Bone className="mt-1 h-[38px] w-full rounded-lg" />
            </div>
            <div>
              <LineBone size="xs" width="22%" />
              <Bone className="mt-1 h-[42px] w-full rounded-lg" />
            </div>
            <div>
              <LineBone size="xs" width="14%" />
              <Bone className="mt-1 h-[38px] w-full rounded-lg" />
              <div className="mt-1.5">
                <LineBone size="xs" width="80%" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Bone className="h-[31px] w-36" />
              <Bone className="ml-auto h-9 w-36 rounded-lg" />
            </div>
          </div>
        </SectionBones>
        <SectionBones title={62}>
          <div className="divide-y divide-zinc-800/80">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex items-start gap-3 py-2">
                <Bone className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <LineBone size="sm" width={widthAt(index, [60, 45, 70, 52])} />
                  <LineBone size="xs" width={widthAt(index, [35, 28, 40])} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1">
            <LineBone size="xs" width="20%" />
          </div>
        </SectionBones>
      </PageBones>
    </Status>
  )
}

function FilesSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-900 px-4">
        <Bone className="h-4 w-24" />
        <Bone className="ml-auto size-5" />
        <Bone className="size-5" />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2 md:w-80">
        {[70, 55, 82, 46, 64].map((width, index) => (
          <div key={index} className="flex items-center gap-2 px-2 py-2">
            <Bone className="size-3.5 shrink-0" />
            <Bone className="h-3" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-zinc-900 px-4">
        <Bone className="size-4" />
        <Bone className="h-3 w-48" />
      </div>
    </div>
  )
}

/** The Usage page's report: headline numbers (rows on phones, tiles wider), the chart, and the first table. */
export function UsageSkeleton() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading usage…</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 sm:p-4">
            <div className="flex h-7 items-center justify-between gap-3 sm:block sm:h-auto">
              <Bone className="h-3 w-28" />
              <Bone className="h-5 w-20 sm:mt-3 sm:h-7" />
            </div>
            <div className="mt-0.5 flex h-5 items-center sm:mt-1">
              <Bone className="h-3" style={{ width: widthAt(index, [75, 55, 35, 60]) }} />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex h-[45px] items-center gap-2 border-b border-zinc-800 px-4">
          <Bone className="h-4 w-28" />
          <Bone className="ml-auto h-4 w-14" />
        </div>
        <div className="p-4">
          <div className="mb-3 flex h-4 items-center gap-4 sm:hidden">
            <Bone className="h-3 w-16" />
            <Bone className="h-3 w-14" />
            <Bone className="h-3 w-16" />
          </div>
          <div className="flex h-[200px] items-end gap-[2%] pl-11">
            {[8, 14, 6, 22, 10, 18, 7, 12, 30, 9, 16, 60].map((height, index) => (
              <Bone key={index} className="flex-1 rounded-b-none" style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex h-[45px] items-center gap-2 border-b border-zinc-800 px-4">
          <Bone className="h-4 w-36" />
          <Bone className="ml-auto h-3 w-16" />
        </div>
        <div className="divide-y divide-zinc-800/60 p-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-[37px] items-center gap-3">
              <Bone className="h-3.5" style={{ width: widthAt(index, [34, 28, 40, 30]) }} />
              <Bone className="ml-auto h-3 w-10" />
              <Bone className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function UsagePageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HeaderBones>
        <Bone className="h-4 w-14" />
        <Bone className="ml-auto h-8 w-56 rounded-lg" />
      </HeaderBones>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-5xl p-4">
          <UsageSkeleton />
        </div>
      </div>
    </div>
  )
}

/** The Board: the page title, then panels (a title row with its buttons, and a card) two across on wide screens. */
export function BoardSkeleton() {
  return (
    <Status>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-5xl space-y-5 px-4 pt-6 md:pt-10">
          <div className="flex min-h-9 items-center gap-2">
            <Bone className="h-7 w-24" />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {[0, 1].map((index) => (
              <div key={index} className="rounded-xl border border-zinc-800/80 p-3">
                <div className="flex h-8 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <LineBone size="sm" width={widthAt(index, [40, 55])} />
                  </div>
                  <Bone className="h-4 w-24" />
                </div>
                <div className="my-3 space-y-3 rounded-xl border border-zinc-800/60 p-4">
                  <LineBone size="base" width="45%" />
                  <Lines count={3} />
                  <Bone className="h-24 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Status>
  )
}

// ── By route ────────────────────────────────────────────────────────────────

/** Pages that draw their own header instead of the app's (the app shell shows its header for the rest). */
export const ownsHeader = (pathname: string) =>
  /^\/chat\/[^/]+/.test(pathname) || pathname === "/machine" || pathname.startsWith("/machine/") || pathname === "/usage"

/** The skeleton for whichever page `pathname` is, so a slow load shows that page's shape. */
export function RouteSkeleton({ pathname }: { pathname: string }) {
  if (/^\/chat\/[^/]+/.test(pathname)) return <ChatPageSkeleton />
  if (pathname === "/chat" || pathname === "/") return <NewChatSkeleton />
  if (pathname.startsWith("/machine/")) return <MachineSkeleton />
  if (pathname === "/machine") return <MachinesPageSkeleton />
  if (pathname === "/usage") return <UsagePageSkeleton />
  if (pathname === "/files") return <FilesSkeleton />
  if (pathname === "/board") return <BoardSkeleton />
  if (/^\/agents\/[^/]+/.test(pathname)) return <EditorSkeleton kind="agent" />
  if (/^\/projects\/[^/]+/.test(pathname)) return <EditorSkeleton kind="project" />
  if (/^\/mcp\/[^/]+/.test(pathname)) return <EditorSkeleton kind="mcp" />
  if (/^\/skills\/[^/]+/.test(pathname)) return <SkillEditorSkeleton />
  if (pathname === "/skills") return <SkillsPageSkeleton />
  if (pathname === "/secrets") return <SecretsSkeleton />
  if (pathname === "/agents") return <ListPageSkeleton kind="agent" />
  if (pathname === "/projects") return <ListPageSkeleton kind="project" />
  if (pathname === "/mcp") return <ListPageSkeleton kind="mcp" />
  if (pathname === "/notifications") return <NotificationsSkeleton />
  if (pathname === "/access") return <AccessSkeleton />
  return <SettingsSkeleton />
}

/** The page skeleton for the current route (the router's pending view while a page's code loads). */
export function CurrentRouteSkeleton() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <Status>
      <RouteSkeleton pathname={pathname} />
    </Status>
  )
}

/** The signed-in app before it can render: sidebar, the app header where the page has none, and the page's shape. */
export function ShellSkeleton() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <div className="dex-app flex h-[var(--app-height,100dvh)] overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 md:flex lg:w-72">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">Dex</span>
        </div>
        <div className="px-3">
          <Bone className="h-9 w-full rounded-lg" />
          {/* The Board link, like the sidebar's. */}
          <div className="mt-1 mb-4 flex h-9 items-center gap-2.5 px-2.5">
            <Bone className="size-4" />
            <Bone className="h-3.5 w-12" />
          </div>
          <Bone className="mb-2 ml-2.5 h-3 w-12" />
          <ChatListSkeleton />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {!ownsHeader(pathname) && (
          <header className="dex-topbar flex h-12 shrink-0 items-center gap-2 border-b border-zinc-900 px-4 md:hidden">
            <Bone className="size-6" />
            <img src="/favicon.svg" alt="" className="ml-1 size-6" />
            <span className="font-semibold tracking-tight">Dex</span>
          </header>
        )}
        <Status>
          <RouteSkeleton pathname={pathname} />
        </Status>
      </main>
    </div>
  )
}
