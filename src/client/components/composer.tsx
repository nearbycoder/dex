import { ArrowUp, Square } from "lucide-react"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"

export function Composer(props: {
  onSend: (text: string) => void | Promise<void>
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
  const [text, setText] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!props.draft) return
    setText(props.draft.text)
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
    const value = text.trim()
    if (!value || props.disabled) return
    setText("")
    void props.onSend(value)
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-lg shadow-black/20 focus-within:border-zinc-700">
      {props.header}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? "Ask Dex to do anything…"}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base text-zinc-100 md:text-sm placeholder:text-zinc-500 focus:outline-none"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
        <div className="min-w-0">{props.toolbar}</div>
        <div className="flex items-center gap-1.5">
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
            disabled={!text.trim() || props.disabled}
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
