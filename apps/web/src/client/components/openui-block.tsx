import { type ActionEvent, BuiltinActionType, type McpClientLike, type OpenUIError, type ParseResult, Renderer } from "@openuidev/react-lang"
import { ThemeProvider } from "@openuidev/react-ui"
import { Check, ShieldAlert, X } from "lucide-react"
import { useContext, useMemo, useRef, useState } from "react"
import { ChatOperationsContext } from "~/client/lib/chat-operations"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { library } from "~/client/openui/library"
// Loaded with this lazy chunk rather than on every page; its layer order is fixed in styles.css.
import "@openuidev/react-ui/layered/styles/index.css"

/** Model-written UI can carry any URL; only open web pages, never `javascript:` or `data:` ones. */
const safeHttpUrl = (value: unknown) => {
  try {
    const url = new URL(String(value))
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The form's values with every password field's value swapped for its `{{secret:<name>}}` placeholder, after
 * storing the value in Dex. Fields are found by name (`{ value }` or a bare string), wherever the form nests them.
 */
async function withoutSecrets(state: unknown, fields: ReadonlySet<string>, store: (field: string, value: string) => Promise<string>): Promise<unknown> {
  const walk = async (node: unknown, key?: string): Promise<unknown> => {
    if (key !== undefined && fields.has(key)) {
      const value = typeof node === "string" ? node : isRecord(node) && typeof node.value === "string" ? node.value : null
      if (value) {
        const placeholder = `{{secret:${await store(key, value)}}}`
        return typeof node === "string" ? placeholder : { ...(node as Record<string, unknown>), value: placeholder }
      }
    }
    if (Array.isArray(node)) return Promise.all(node.map((item) => walk(item)))
    if (isRecord(node)) return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([name, value]) => [name, await walk(value, name)])))
    return node
  }
  return walk(state)
}

const toModelMessage = (event: ActionEvent, formState: unknown) => {
  const lines = [`[UI action] ${event.humanFriendlyMessage}`]
  if (isRecord(formState) && Object.keys(formState).length > 0) lines.push(`Form values: ${JSON.stringify(formState)}`)
  if (event.params?.context !== undefined) lines.push(`Context: ${JSON.stringify(event.params.context)}`)
  return lines.join("\n")
}

type ToolResult = Awaited<ReturnType<McpClientLike["callTool"]>>
const CANCELLED = "You cancelled it."
const failed = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] })

const literal = (node: unknown) => (isRecord(node) && node.k === "Str" && typeof node.v === "string" ? node.v : null)

/**
 * Tools the program calls only from Mutation()s, which run when you press a button. Everything else counts as a
 * Query (it runs on its own when the UI shows) and may only read, so a program can't change anything unprompted.
 * A tool picked at runtime (not a plain string) could be either, so then nothing counts as a Mutation.
 */
const mutationOnlyTools = (result: ParseResult): ReadonlySet<string> => {
  const queried = result.queryStatements.map((statement) => literal(statement.toolAST))
  if (queried.includes(null)) return new Set()
  return new Set(result.mutationStatements.flatMap((statement) => literal(statement.toolAST) ?? []).filter((name) => !queried.includes(name)))
}

/** Renders a render_ui tool call's OpenUI Lang, live while its arguments stream in. */
export default function OpenUIBlock(props: { code: string; streaming: boolean; onSend: (message: string) => void }) {
  const storeSecret = useContext(ChatSecretsContext)
  const runOperation = useContext(ChatOperationsContext)
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Live data that didn't load and buttons that failed: the program only shows these if the model thought to.
  const [toolErrors, setToolErrors] = useState<ReadonlyArray<string>>([])
  const mutationOnly = useRef<ReadonlySet<string>>(new Set())
  // An admin operation a button asked for, shown with Dex's own summary of it (not the model's label).
  const [confirm, setConfirm] = useState<{ readonly summary: string; readonly answer: (yes: boolean) => void } | null>(null)
  const confirming = useRef<((yes: boolean) => void) | null>(null)

  const ask = (summary: string) =>
    new Promise<boolean>((resolve) => {
      confirming.current?.(false)
      const answer = (yes: boolean) => {
        if (confirming.current !== answer) return
        confirming.current = null
        setConfirm(null)
        resolve(yes)
      }
      confirming.current = answer
      setConfirm({ summary, answer })
    })

  // Query() and Mutation() run app operations, as this chat's UI (DexAgent.runUiOperation).
  const toolProvider = useMemo<McpClientLike | null>(
    () =>
      runOperation && {
        async callTool({ name, arguments: args = {} }) {
          const query = !mutationOnly.current.has(name)
          try {
            let outcome = await runOperation(name, args, { query })
            if (outcome.ok === "confirm") {
              if (!(await ask(outcome.summary))) return failed(CANCELLED)
              outcome = await runOperation(name, args, { query, confirmed: true })
            }
            if (outcome.ok === true) return { content: [], structuredContent: outcome.result ?? null }
            return failed(outcome.ok === false ? outcome.error : "It wasn't confirmed.")
          } catch (cause) {
            return failed(cause instanceof Error ? cause.message : String(cause))
          }
        }
      },
    // `ask` only touches refs and state setters.
    [runOperation]
  )

  // Password fields' values never go into the message: Dex stores them and the chat gets placeholders.
  const submit = async (event: ActionEvent) => {
    setError(null)
    const fields = new Set([...(root.current?.querySelectorAll<HTMLInputElement>('input[type="password"][name]') ?? [])].map((input) => input.name))
    try {
      if (fields.size && !storeSecret) throw new Error("Secrets can't be kept out of the chat here, so this wasn't sent.")
      const formState = fields.size && storeSecret ? await withoutSecrets(event.formState, fields, storeSecret) : event.formState
      props.onSend(toModelMessage(event, formState))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <ThemeProvider mode="dark">
      <div ref={root} className="dex-openui my-3 w-full max-w-full overflow-hidden rounded-xl [contain:inline-size_paint]">
        <Renderer
          library={library}
          response={props.code}
          isStreaming={props.streaming}
          toolProvider={toolProvider}
          onError={(errors: OpenUIError[]) => {
            const messages = errors
              .filter((item) => (item.source === "query" || item.source === "mutation") && !item.message.endsWith(CANCELLED))
              .map((item) => item.message.replace(/^(Query|Mutation) "([^"]+)" (returned an error|failed): /, "$2: "))
            setToolErrors((current) => (current.join("\n") === messages.join("\n") ? current : [...new Set(messages)]))
          }}
          onParseResult={(result) => {
            if (result) mutationOnly.current = mutationOnlyTools(result)
          }}
          onAction={(event) => {
            if (event.type === BuiltinActionType.ContinueConversation) void submit(event)
            else if (event.type === BuiltinActionType.OpenUrl) {
              const url = safeHttpUrl(event.params?.url)
              if (url) window.open(url, "_blank", "noopener,noreferrer")
            }
          }}
        />
        {confirm && (
          <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-amber-900/60 bg-amber-950/25 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium tracking-wide text-amber-300/90 uppercase">This button will</p>
              <p className="mt-0.5 break-words text-zinc-100">{confirm.summary}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => confirm.answer(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
                >
                  <Check className="size-4" /> Confirm
                </button>
                <button
                  type="button"
                  onClick={() => confirm.answer(false)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <X className="size-4" /> Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {toolErrors.map((message) => (
          <p key={message} className="px-1 pt-2 text-xs break-words text-red-400">
            {message}
          </p>
        ))}
        {error && <p className="px-1 pt-2 text-xs text-red-400">{error}</p>}
      </div>
    </ThemeProvider>
  )
}
