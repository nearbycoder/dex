import { ArrowUp, FileText, LoaderCircle, Paperclip, Square, X } from "lucide-react"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { type DraftAttachment, uploadAttachment } from "~/client/lib/attachments"
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, type ChatAttachment } from "~/shared/attachments"
import { SkillMenu, type SkillMenuHandle } from "./skill-menu"

/** Files attached in the composer: each uploads (to be prepared for the model) as soon as it's added. */
function useDraftAttachments() {
  const [drafts, setDrafts] = useState<DraftAttachment[]>([])
  const live = useRef(drafts)
  live.current = drafts
  // Object URLs for thumbnails, freed when they're no longer shown.
  useEffect(() => () => live.current.forEach((draft) => draft.preview && URL.revokeObjectURL(draft.preview)), [])

  const update = (id: string, patch: Partial<DraftAttachment>) =>
    setDrafts((list) => list.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))

  const add = (files: Iterable<File>) => {
    const room = ATTACHMENT_LIMITS.files - live.current.length
    const added = [...files].slice(0, Math.max(0, room)).map((file): DraftAttachment & { file: File } => ({
      id: crypto.randomUUID(),
      name: file.name || "pasted",
      mimeType: file.type,
      ...(file.type.startsWith("image/") && { preview: URL.createObjectURL(file) }),
      status: "uploading",
      file
    }))
    if (added.length === 0) return
    setDrafts((list) => [...list, ...added.map(({ file: _file, ...draft }) => draft)])
    for (const draft of added) {
      uploadAttachment(draft.file).then(
        (attachment) => update(draft.id, { status: "ready", attachment }),
        (error: unknown) => update(draft.id, { status: "error", error: error instanceof Error ? error.message : String(error) })
      )
    }
  }

  const remove = (id: string) =>
    setDrafts((list) => {
      const draft = list.find((each) => each.id === id)
      if (draft?.preview) URL.revokeObjectURL(draft.preview)
      return list.filter((each) => each.id !== id)
    })

  const clear = () =>
    setDrafts((list) => {
      list.forEach((draft) => draft.preview && URL.revokeObjectURL(draft.preview))
      return []
    })

  return { drafts, add, remove, clear }
}

function AttachmentChip({ draft, onRemove }: { draft: DraftAttachment; onRemove: () => void }) {
  const failed = draft.status === "error"
  return (
    <div
      title={failed ? draft.error : draft.name}
      className={`group relative flex h-14 shrink-0 items-center overflow-hidden rounded-lg border bg-zinc-950 ${
        failed ? "border-red-900/80" : "border-zinc-800"
      } ${draft.preview ? "w-14" : "max-w-48 gap-2 pr-7 pl-2.5"}`}
    >
      {draft.preview ? (
        <img src={draft.preview} alt={draft.name} className="size-full object-cover" />
      ) : (
        <>
          <FileText className={`size-5 shrink-0 ${failed ? "text-red-400" : "text-zinc-400"}`} />
          <span className="min-w-0 truncate text-xs text-zinc-300">{draft.name}</span>
        </>
      )}
      {draft.status === "uploading" && (
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
          <LoaderCircle className="size-4 animate-spin text-zinc-300" />
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${draft.name}`}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800 hover:text-white"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

export function Composer(props: {
  onSend: (text: string, attachments: ChatAttachment[]) => void | Promise<void>
  onStop?: () => void
  running?: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  toolbar?: ReactNode
  /** Replaces the text when `key` changes, e.g. with a picked agent's starter prompt. */
  draft?: { readonly text: string; readonly key: number }
  /** Shown above the text box, inside the composer (e.g. the selected agent). */
  header?: ReactNode
}) {
  // The text box owns its text and `text` follows it; React never writes it back on a re-render. A controlled box
  // would: iOS dictation puts words in the box before telling React, so any re-render then (a reply streaming in)
  // put the old text back and threw the dictation away. Changes from code go through `replaceText`.
  const [text, setText] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)
  const replaceText = (value: string) => {
    if (ref.current) ref.current.value = value
    setText(value)
  }
  const picker = useRef<HTMLInputElement>(null)
  const { drafts, add, remove, clear } = useDraftAttachments()
  const [dragging, setDragging] = useState(false)
  const uploading = drafts.some((draft) => draft.status === "uploading")
  const failed = drafts.filter((draft) => draft.status === "error")
  const ready = drafts.flatMap((draft) => (draft.status === "ready" && draft.attachment ? [draft.attachment] : []))
  // Waits for uploads, and for files that couldn't be attached to be removed, so nothing goes missing unnoticed.
  const canSend = Boolean(text.trim() || ready.length) && !uploading && failed.length === 0 && !props.disabled
  /** When the message box last lost focus: a tap on Send can take it (iOS haptics), and typing should go on. */
  const blurredAt = useRef(0)
  // `/` at the start opens the skill lookup, until a space ends the name or Escape closes it.
  const slash = /^\/([a-z0-9-]*)$/i.exec(text)?.[1]
  const [menuClosed, setMenuClosed] = useState(false)
  const menu = useRef<SkillMenuHandle>(null)
  const menuOpen = slash !== undefined && !menuClosed && !props.disabled
  useEffect(() => {
    if (slash === undefined) setMenuClosed(false)
  }, [slash])

  useEffect(() => {
    if (!props.draft) return
    replaceText(props.draft.text)
    const element = ref.current
    if (!element) return
    element.focus()
    // Caret at the end, ready to finish the starter sentence.
    requestAnimationFrame(() => element.setSelectionRange(element.value.length, element.value.length))
  }, [props.draft?.key])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = "0px"
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`
  }, [text])

  const submit = () => {
    // The box itself, in case dictation hasn't reported its last words yet.
    const value = (ref.current?.value ?? text).trim()
    if (!(value || ready.length) || uploading || failed.length > 0 || props.disabled) return
    replaceText("")
    clear()
    void props.onSend(value, ready)
    // Still inside the tap, so iOS keeps the keyboard up.
    if (Date.now() - blurredAt.current < 500) ref.current?.focus()
  }

  return (
    <div
      className={`relative rounded-2xl border bg-zinc-900/80 shadow-lg shadow-black/20 transition-colors duration-200 focus-within:border-zinc-700 ${
        dragging ? "border-emerald-600" : "border-zinc-800"
      }`}
      onDragOver={(event) => {
        if (props.disabled || !event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        setDragging(false)
        if (!props.disabled) add(event.dataTransfer.files)
      }}
    >
      {menuOpen && (
        <SkillMenu
          ref={menu}
          query={slash}
          onClose={() => setMenuClosed(true)}
          onPick={(name) => {
            replaceText(`/${name} `)
            ref.current?.focus()
          }}
        />
      )}
      {props.header}
      {drafts.length > 0 && (
        <div className="space-y-1.5 px-3 pt-3">
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {drafts.map((draft) => (
              <AttachmentChip key={draft.id} draft={draft} onRemove={() => remove(draft.id)} />
            ))}
          </div>
          {failed.length > 0 && <p className="text-xs text-red-400">{failed[0]!.error}{failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""}</p>}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        defaultValue=""
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? "Ask Dex to do anything…"}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base text-zinc-100 md:text-sm placeholder:text-zinc-500 focus:outline-none"
        onChange={(event) => setText(event.target.value)}
        // Dictation can finish without a change event; catch up when it ends or the box is left.
        onCompositionEnd={(event) => setText(event.currentTarget.value)}
        onPaste={(event) => {
          // A pasted screenshot or copied file attaches; pasted text stays text.
          const files = event.clipboardData.files
          if (files.length === 0 || props.disabled) return
          event.preventDefault()
          add(files)
        }}
        onBlur={(event) => {
          blurredAt.current = Date.now()
          setText(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (menuOpen && !event.nativeEvent.isComposing && menu.current?.handleKey(event)) {
            event.preventDefault()
            return
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={props.disabled || drafts.length >= ATTACHMENT_LIMITS.files}
          title="Attach files"
          aria-label="Attach files"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
        >
          <Paperclip className="size-4" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) add(event.target.files)
            event.target.value = ""
          }}
        />
        <div className="min-w-0 flex-1">{props.toolbar}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.running && props.onStop && (
            <button
              type="button"
              onClick={props.onStop}
              title="Stop"
              className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            title={props.running ? "Queue follow-up" : "Send"}
            className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
