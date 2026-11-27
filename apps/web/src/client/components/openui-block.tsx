import { type ActionEvent, BuiltinActionType, type McpClientLike, type OpenUIError, type ParseResult, Renderer } from "@openuidev/react-lang"
import { ThemeProvider } from "@openuidev/react-ui/ThemeProvider"
import { useNavigate } from "@tanstack/react-router"
import { Check, ShieldAlert, Wrench, X } from "lucide-react"
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ChatSecretsContext } from "~/client/lib/chat-secrets"
import { OpenUIHostContext } from "~/client/lib/openui-host"
import { library } from "~/client/openui/library"
import { uiActionMessage } from "~/shared/ui-action"
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
 * Also returns every raw secret -> placeholder mapping so context and humanFriendlyMessage can be scrubbed too.
 */
async function withoutSecrets(
  state: unknown,
  fields: ReadonlySet<string>,
  store: (field: string, value: string) => Promise<string>,
  stored: Map<string, string> = new Map()
): Promise<unknown> {
  const walk = async (node: unknown, key?: string): Promise<unknown> => {
    if (key !== undefined && fields.has(key)) {
      const value = typeof node === "string" ? node : isRecord(node) && typeof node.value === "string" ? node.value : null
      if (value) {
        let placeholder = stored.get(value)
        if (!placeholder) {
          placeholder = `{{secret:${await store(key, value)}}}`
          stored.set(value, placeholder)
        }
        return typeof node === "string" ? placeholder : { ...(node as Record<string, unknown>), value: placeholder }
      }
    }
    if (Array.isArray(node)) return Promise.all(node.map((item) => walk(item)))
    if (isRecord(node)) return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([name, value]) => [name, await walk(value, name)])))
    return node
  }
  return walk(state)
}

/** Recursively replaces any raw secret values (longest first) inside strings, arrays, and objects. */
function scrubSecretValues(node: unknown, replacements: ReadonlyArray<readonly [string, string]>): unknown {
  if (!replacements.length) return node
  if (typeof node === "string") {
    let out = node
    for (const [secret, placeholder] of replacements) {
      if (secret.length >= 1) out = out.split(secret).join(placeholder)
    }
    return out
  }
  if (Array.isArray(node)) return node.map((item) => scrubSecretValues(item, replacements))
  if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrubSecretValues(v, replacements)]))
  return node
}

/** Collects password input names and reactive `$var` bindings statically from a ParseResult AST (covers hidden tabs/steps). */
function astPasswordKeys(node: unknown, out: Set<string>, seen = new WeakSet<object>()) {
  if (!node || typeof node !== "object") return
  if (seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    for (const item of node) astPasswordKeys(item, out, seen)
    return
  }
  const rec = node as Record<string, unknown>
  const props = isRecord(rec.props) ? rec.props : null
  const isPasswordType = (value: unknown): boolean =>
    (typeof value === "string" && value.toLowerCase() === "password") ||
    (isRecord(value) && value.k === "Str" && typeof value.v === "string" && value.v.toLowerCase() === "password")
  if (props && isPasswordType(props.type)) {
    const addKey = (val: unknown) => {
      if (typeof val === "string" && val) {
        out.add(val)
        if (val.startsWith("$")) out.add(val.slice(1))
      } else if (isRecord(val)) {
        if (val.k === "Str" && typeof val.v === "string" && val.v) out.add(val.v)
        if (typeof val.target === "string" && val.target) {
          out.add(val.target)
          if (val.target.startsWith("$")) out.add(val.target.slice(1))
        }
        if (typeof val.name === "string" && val.name) {
          out.add(val.name)
          if (val.name.startsWith("$")) out.add(val.name.slice(1))
        }
      }
    }
    addKey(props.name)
    addKey(props.value)
    addKey(props.defaultValue)
    addKey(props.binding)
  }
  for (const value of Object.values(rec)) astPasswordKeys(value, out, seen)
}

/** State to save, without password fields: those values are only ever kept as secrets. */
const withoutPasswords = (node: unknown, fields: ReadonlySet<string>): unknown => {
  if (Array.isArray(node)) return node.map((item) => withoutPasswords(item, fields))
  if (!isRecord(node)) return node
  return Object.fromEntries(Object.entries(node).flatMap(([key, value]) => (fields.has(key) ? [] : [[key, withoutPasswords(value, fields)]])))
}

const toModelMessage = (message: string, formState: unknown, context: unknown) => uiActionMessage(message, formState, context)

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

// Stable empty theme objects: ThemeProvider allocates a fresh `{}` per render when omitted, rewriting `<style>` on every streamed token.
const EMPTY_THEME = {}

/**
 * Renders a chat's render_ui program, live while its arguments stream in. Its
 * Query() and Mutation() calls run app operations through the host; its form and filter state is saved per card.
 */
export default memo(function OpenUIBlock(props: {
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
  // Sticky set of password field names & `$var` bindings seen in the AST or DOM (covers unmounted tabs/steps).
  const knownPasswordKeys = useRef<Set<string>>(new Set())
  // An admin operation a button asked for, shown with Dex's own summary of it (not the model's label).
  const [confirm, setConfirm] = useState<{ readonly summary: string; readonly answer: (yes: boolean) => void } | null>(null)
  const confirming = useRef<((yes: boolean) => void) | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const passwordFields = () => {
    const fields = new Set<string>(knownPasswordKeys.current)
    for (const input of root.current?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []) {
      if (input.name) {
        fields.add(input.name)
        knownPasswordKeys.current.add(input.name)
      }
    }
    return fields
  }

  // Filters, tabs, and half-filled forms are saved (shortly after each change) so the card opens as you left it.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    confirming.current?.(false)
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
      const stored = new Map<string, string>()
      const formState = fields.size && storeSecret ? await withoutSecrets(event.formState, fields, storeSecret, stored) : event.formState
      let context = fields.size && storeSecret ? await withoutSecrets(event.params?.context, fields, storeSecret, stored) : event.params?.context
      let message = event.humanFriendlyMessage
      if (stored.size) {
        const replacements = [...stored.entries()].sort((a, b) => b[0].length - a[0].length)
        context = scrubSecretValues(context, replacements)
        message = scrubSecretValues(message, replacements) as string
      }
      props.onSend(toModelMessage(message, formState, context))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const flash = (text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice((current) => (current === text ? null : current)), 2_000)
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
    <ThemeProvider mode="dark" lightTheme={EMPTY_THEME} darkTheme={EMPTY_THEME}>
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
              astPasswordKeys(result, knownPasswordKeys.current)
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
})
