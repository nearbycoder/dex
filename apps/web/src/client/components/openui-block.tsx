import { type ActionEvent, BuiltinActionType, type McpClientLike, type OpenUIError, type ParseResult, Renderer } from "@openuidev/react-lang"
import { ThemeProvider } from "@openuidev/react-ui"
import { useNavigate } from "@tanstack/react-router"
import { Check, ShieldAlert, Wrench, X } from "lucide-react"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { OpenUIHostContext } from "~/client/lib/openui-host"
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

/** State to save, without password fields: those values are only ever kept as secrets. */
const withoutPasswords = (node: unknown, fields: ReadonlySet<string>): unknown => {
  if (Array.isArray(node)) return node.map((item) => withoutPasswords(item, fields))
  if (!isRecord(node)) return node
  return Object.fromEntries(Object.entries(node).flatMap(([key, value]) => (fields.has(key) ? [] : [[key, withoutPasswords(value, fields)]])))
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

/**
 * Tools whose list results the program reads as `{ rows: [...] }` (`q.rows`, the shape OpenUI's guide teaches and
 * Dex's guide lists them in). Operations return plain lists, and a program written against one (after a look with
 * app_call) reads it directly, so lists are wrapped only for the queries that ask for `.rows`.
 */
const rowsTools = (result: ParseResult, code: string): ReadonlySet<string> => {
  const statements = [...result.queryStatements, ...result.mutationStatements]
  return new Set(
    statements.flatMap((statement) => {
      const name = literal(statement.toolAST)
      const id = statement.statementId.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")
      return name && new RegExp(`\\b${id}\\.rows\\b`).test(code) ? [name] : []
    })
  )
}

/** A string parameter of a Dex action, within reason. */
const param = (event: ActionEvent, key: string) => {
  const value = event.params?.[key]
  return typeof value === "string" && value.length > 0 && value.length <= 2_000 ? value : null
}

/** Problems in the program itself (not failed data), described for the model that wrote it. */
const programProblems = (errors: ReadonlyArray<OpenUIError>) =>
  errors
    .filter((item) => (item.source === "parser" || item.source === "runtime") && (item as { severity?: string }).severity !== "warning")
    .map((item) => [item.statementId && `${item.statementId}:`, item.component && `${item.component}`, item.message, item.hint && `(${item.hint})`].filter(Boolean).join(" "))

/**
 * Renders a chat's render_ui program, live while its arguments stream in. Its
 * Query() and Mutation() calls run app operations through the host; its form and filter state is saved per card.
 */
export default function OpenUIBlock(props: {
  code: string
  streaming: boolean
  /** Which card this is, for its saved state: the render_ui call's id. */
  card: string
  /** Sends a message to the chat (@ToAssistant buttons and forms, and Fix it). */
  onSend: (message: string) => void
}) {
  const storeSecret = useContext(ChatSecretsContext)
  const host = useContext(OpenUIHostContext)
  const navigate = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Live data that didn't load and buttons that failed: the program only shows these if the model thought to.
  const [toolErrors, setToolErrors] = useState<ReadonlyArray<string>>([])
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const mutationOnly = useRef<ReadonlySet<string>>(new Set())
  const wantsRows = useRef<ReadonlySet<string>>(new Set())
  // An admin operation a button asked for, shown with Dex's own summary of it (not the model's label).
  const [confirm, setConfirm] = useState<{ readonly summary: string; readonly answer: (yes: boolean) => void } | null>(null)
  const confirming = useRef<((yes: boolean) => void) | null>(null)

  const ready = !host || host.states !== null
  const initialState = useMemo(() => {
    const saved = host?.states?.[props.card]
    return isRecord(saved) ? saved : undefined
    // Read once, when the saved states arrive: later saves come from this card itself.
  }, [ready])
  const latestState = useRef<unknown>(initialState)

  // Live data loads only while the card is on screen (or near it): a long chat full of old dashboards stays quiet.
  const visible = useRef(false)
  const waiting = useRef<Array<() => void>>([])
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === "undefined") {
      visible.current = true
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = Boolean(entry?.isIntersecting)
        if (visible.current) waiting.current.splice(0).forEach((resume) => resume())
      },
      { rootMargin: "400px 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const whenVisible = () => (visible.current ? Promise.resolve() : new Promise<void>((resume) => waiting.current.push(resume)))

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

  // Query() and Mutation() run app operations, as this chat's (or panel's) UI (DexAgent.runUiOperation).
  const run = host?.run
  const toolProvider = useMemo<McpClientLike | null>(
    () =>
      run
        ? {
            async callTool({ name, arguments: args = {} }) {
              const query = !mutationOnly.current.has(name)
              try {
                if (query) await whenVisible()
                let outcome = await run(name, args, { query })
                if (outcome.ok === "confirm") {
                  if (!(await ask(outcome.summary))) return failed(CANCELLED)
                  outcome = await run(name, args, { query, confirmed: true })
                }
                if (outcome.ok === true) {
                  const result = Array.isArray(outcome.result) && wantsRows.current.has(name) ? { rows: outcome.result } : outcome.result
                  return { content: [], structuredContent: result ?? null }
                }
                return failed(outcome.ok === false ? outcome.error : "It wasn't confirmed.")
              } catch (cause) {
                return failed(cause instanceof Error ? cause.message : String(cause))
              }
            }
          }
        : null,
    // `ask` and `whenVisible` only touch refs and state setters.
    [run]
  )

  const passwordFields = () => new Set([...(root.current?.querySelectorAll<HTMLInputElement>('input[type="password"][name]') ?? [])].map((input) => input.name))

  // Filters, tabs, and half-filled forms are saved (shortly after each change) so the card opens as you left it.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])
  const onStateUpdate = (state: Record<string, unknown>) => {
    if (props.streaming || !host) return
    const next = withoutPasswords(state, passwordFields())
    if (JSON.stringify(next) === JSON.stringify(latestState.current)) return
    latestState.current = next
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => host.saveState(props.card, latestState.current), 800)
  }

  // Password fields' values never go into the message: Dex stores them and the chat gets placeholders.
  const submit = async (event: ActionEvent) => {
    setError(null)
    const fields = passwordFields()
    try {
      if (fields.size && !storeSecret) throw new Error("Secrets can't be kept out of the chat here, so this wasn't sent.")
      const formState = fields.size && storeSecret ? await withoutSecrets(event.formState, fields, storeSecret) : event.formState
      props.onSend(toModelMessage(event, formState))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const flash = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice((current) => (current === text ? null : current)), 2_000)
  }

  const onAction = (event: ActionEvent) => {
    if (event.type === BuiltinActionType.ContinueConversation) void submit(event)
    else if (event.type === BuiltinActionType.OpenUrl) {
      const url = safeHttpUrl(event.params?.url)
      if (url) window.open(url, "_blank", "noopener,noreferrer")
    } else if (event.type === "OpenChat") {
      const sessionId = param(event, "sessionId")
      if (sessionId) void navigate({ to: "/chat/$sessionId", params: { sessionId } })
    } else if (event.type === "OpenFile") {
      const path = param(event, "path")
      if (path) void navigate({ to: "/files", search: { path } })
    } else if (event.type === "OpenMachine") {
      const vmKey = param(event, "vmKey")
      if (vmKey) void navigate({ to: "/machine/$vmKey", params: { vmKey } })
    } else if (event.type === "Copy") {
      const text = typeof event.params?.text === "string" ? event.params.text : null
      if (text !== null) {
        navigator.clipboard.writeText(text).then(
          () => flash("Copied"),
          () => setError("Couldn't copy to the clipboard.")
        )
      }
    }
  }

  const showProblems = !props.streaming && problems.length > 0

  return (
    <ThemeProvider mode="dark">
      <div ref={root} className="dex-openui my-3 w-full max-w-full overflow-hidden rounded-xl [contain:inline-size_paint]">
        {!ready ? (
          <div className="h-24 animate-pulse rounded-xl bg-zinc-900" />
        ) : (
          <Renderer
            library={library}
            response={props.code}
            isStreaming={props.streaming}
            toolProvider={toolProvider}
            initialState={initialState}
            onStateUpdate={onStateUpdate}
            onError={(errors: OpenUIError[]) => {
              const messages = errors
                .filter((item) => (item.source === "query" || item.source === "mutation") && !item.message.endsWith(CANCELLED))
                .map((item) => item.message.replace(/^(Query|Mutation) "([^"]+)" (returned an error|failed): /, "$2: "))
              setToolErrors((current) => (current.join("\n") === messages.join("\n") ? current : [...new Set(messages)]))
              const found = programProblems(errors)
              setProblems((current) => (current.join("\n") === found.join("\n") ? current : found))
            }}
            onParseResult={(result) => {
              if (!result) return
              mutationOnly.current = mutationOnlyTools(result)
              wantsRows.current = rowsTools(result, props.code)
            }}
            onAction={onAction}
          />
        )}
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
        {!props.streaming && (showProblems || notice) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 text-xs text-zinc-500">
            {showProblems && (
              <span className="flex min-w-0 items-center gap-1.5 text-amber-300/90" title={problems.join("\n")}>
                {problems.length} {problems.length === 1 ? "problem" : "problems"} in this UI
                <button
                    type="button"
                    onClick={() =>
                      props.onSend(
                        `[UI errors] The UI you rendered has problems. Render it again, fixed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
                      )
                    }
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-amber-200 hover:bg-amber-950/60"
                  >
                    <Wrench className="size-3" /> Fix it
                  </button>
              </span>
            )}
            {notice && <span className="text-emerald-400">{notice}</span>}
          </div>
        )}
      </div>
    </ThemeProvider>
  )
}
