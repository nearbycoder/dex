/**
 * Dex's OpenUI engine for the native apps: what @openuidev/react-lang's <Renderer> does (parse a streaming program,
 * keep its $variables and form state, run its Query() and Mutation() calls through the host, evaluate the tree, and
 * turn button presses into actions), without React. The app renders the evaluated tree natively.
 *
 * It runs in JavaScriptCore. Built by apps/ios/scripts/build-openui-engine.mjs into
 * DexKit/Sources/DexCore/Resources/openui-engine.js; DexCore's OpenUIRuntime talks to it through `OpenUIEngine` and
 * the `__host` object it installs. Nothing here touches the network (JavaScriptCore has no fetch).
 *
 * Mirrors node_modules/@openuidev/react-lang (useOpenUIState, triggerAction, useStateField, form validation) and the
 * chat components in @openuidev/react-ui/genui-lib (which props are fields, what a press sends). Keep it in step when
 * those packages are upgraded.
 */
import {
  ACTION_STEPS,
  BuiltinActionType,
  McpToolError,
  createQueryManager,
  createStore,
  createStreamingParser,
  enrichErrors,
  evaluate,
  evaluateRoot,
  isReactiveAssign,
  markReactive,
  parseStructuredRules,
  validate
} from "@openuidev/lang-core"

// MARK: Host

interface Host {
  emit(doc: string, kind: string, payload: string): void
  setTimer(id: number, ms: number, repeat: boolean): void
  clearTimer(id: number): void
  format(kind: string, value: number): string
  log(message: string): void
}

declare const __host: Host
const g = globalThis as any

// JavaScriptCore has no timers or console: the host provides them (the query manager's refresh intervals use them).
const timers = new Map<number, () => void>()
let nextTimer = 1
g.setTimeout = (fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
  const id = nextTimer++
  timers.set(id, () => {
    timers.delete(id)
    fn(...args)
  })
  __host.setTimer(id, Number(ms) || 0, false)
  return id
}
g.setInterval = (fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
  const id = nextTimer++
  timers.set(id, () => fn(...args))
  __host.setTimer(id, Number(ms) || 0, true)
  return id
}
g.clearTimeout = g.clearInterval = (id: number) => {
  if (timers.delete(id)) __host.clearTimer(id)
}
const log = (...parts: unknown[]) => __host.log(parts.map((part) => (part instanceof Error ? part.message : typeof part === "string" ? part : safeJSON(part))).join(" "))
g.console = { log, info: log, warn: log, error: log, debug: () => undefined }

function safeJSON(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// MARK: Library

type Rec = Record<string, any>
type Spec = { root?: string; components: Record<string, { signature: string }>; schema: Rec }

let spec: Spec | null = null
let library: { components: Record<string, { props: { shape: Record<string, object> } }> } = { components: {} }
let componentNames: string[] = []
let functions: Record<string, unknown> = {}

const toMs = (value: unknown) => (typeof value === "number" ? value : Date.parse(String(value)))

/** Dex's functions (apps/web/src/client/openui/library.tsx), formatted by the app like the rest of Dex. */
const DEX_FUNCTIONS: Record<string, (args: Rec) => unknown> = {
  Ago: ({ time }) => (Number.isFinite(toMs(time)) ? __host.format("ago", toMs(time)) : ""),
  DateTime: ({ time }) => (Number.isFinite(toMs(time)) ? __host.format("dateTime", toMs(time)) : ""),
  Bytes: ({ bytes }) => __host.format("bytes", Number(bytes))
}

/**
 * The library as the evaluator needs it: each component's props, with the `$binding<...>` ones (reactive() in the
 * component schemas) marked, so `value: $name` binds the field instead of reading it once.
 */
function configure(text: string) {
  spec = JSON.parse(text) as Spec
  const components: typeof library.components = {}
  for (const [name, def] of Object.entries(spec.schema.$defs ?? {}) as [string, Rec][]) {
    if (!spec.components[name]) continue
    const signature = spec.components[name].signature
    const shape: Record<string, object> = {}
    for (const prop of Object.keys(def.properties ?? {})) {
      const marker = {}
      if (new RegExp(`[(,\\s]${prop}\\??: \\$binding<`).test(signature)) markReactive(marker)
      shape[prop] = marker
    }
    components[name] = { props: { shape } }
  }
  library = { components }
  componentNames = Object.keys(spec.components)
  functions = Object.fromEntries(
    Object.entries(spec.schema.functions ?? {}).flatMap(([name, schema]) => (DEX_FUNCTIONS[name] ? [[name, { ...(schema as Rec), fn: DEX_FUNCTIONS[name] }]] : []))
  )
}

// MARK: Helpers

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value)
const isElement = (value: unknown): value is { type: "element"; typeName: string; props: Rec; partial?: boolean; statementId?: string } =>
  isRecord(value) && value.type === "element" && typeof value.typeName === "string"
const isActionPlan = (value: unknown): value is { steps: Rec[] } => isRecord(value) && Array.isArray(value.steps)
const unwrapField = (value: unknown) => (isRecord(value) && "value" in value ? value.value : value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null ? [] : [value])
const str = (node: unknown, key: string) => {
  const value = isRecord(node) && isRecord(node.props) ? node.props[key] : undefined
  return typeof value === "string" ? value : undefined
}

const literal = (node: unknown) => (isRecord(node) && node.k === "Str" && typeof node.v === "string" ? (node.v as string) : null)

/** Tools only Mutation()s call (see the web's openui-block.tsx): everything else is a Query and may only read. */
function mutationOnlyTools(result: Rec): Set<string> {
  const queried = (result.queryStatements as Rec[]).map((statement) => literal(statement.toolAST))
  if (queried.includes(null)) return new Set()
  return new Set((result.mutationStatements as Rec[]).flatMap((statement) => literal(statement.toolAST) ?? []).filter((name) => !queried.includes(name)))
}

/** Tools whose list results the program reads as `{ rows: [...] }` (`q.rows`); see the web's openui-block.tsx. */
function rowsTools(result: Rec, code: string): Set<string> {
  const statements = [...result.queryStatements, ...result.mutationStatements] as Rec[]
  return new Set(
    statements.flatMap((statement) => {
      const name = literal(statement.toolAST)
      const id = String(statement.statementId).replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")
      return name && new RegExp(`\\b${id}\\.rows\\b`).test(code) ? [name] : []
    })
  )
}

/** react-ui's selectionFieldUtils: Chips and OptionCards values. */
const onlyStrings = (values: unknown[]) => values.filter((value): value is string => typeof value === "string")
function normalizeSelection(type: string, stored: unknown, fallback: unknown): string[] {
  if (type === "single") {
    for (const value of [stored, fallback]) {
      if (typeof value === "string") return value ? [value] : []
      if (Array.isArray(value) && typeof value[0] === "string") return value[0] ? [value[0]] : []
    }
    return []
  }
  if (Array.isArray(stored)) return onlyStrings(stored)
  if (typeof stored === "string") return stored ? [stored] : []
  if (Array.isArray(fallback)) return onlyStrings(fallback)
  if (typeof fallback === "string") return fallback ? [fallback] : []
  return []
}
function storedDefault(type: string, fallback: unknown): unknown {
  if (type === "single") {
    if (typeof fallback === "string") return fallback || undefined
    if (Array.isArray(fallback) && typeof fallback[0] === "string") return fallback[0] || undefined
    return undefined
  }
  if (Array.isArray(fallback)) return onlyStrings(fallback)
  if (typeof fallback === "string") return fallback ? [fallback] : []
  return undefined
}
function toggleSelection(type: string, selection: string[], value: string) {
  if (type === "single") return selection[0] === value ? [] : [value]
  return selection.includes(value) ? selection.filter((item) => item !== value) : [...selection, value]
}

/** react-ui's cardActionUtils: a card block's shared action, with the pressed card's details attached. */
function withItemContext(action: unknown, itemContext: Rec) {
  const context = Object.fromEntries(Object.entries(itemContext).filter(([, value]) => value !== undefined))
  if (action == null) return { type: BuiltinActionType.ContinueConversation, params: context }
  if (isActionPlan(action)) {
    if (Object.keys(context).length === 0) return action
    const suffix = `Selected item: ${JSON.stringify(context)}`
    return {
      ...action,
      steps: action.steps.map((step) => {
        if (step.type !== ACTION_STEPS.ToAssistant) return step
        if (step.context == null) return { ...step, context: suffix }
        const existing = typeof step.context === "string" ? step.context : JSON.stringify(step.context)
        return { ...step, context: `${existing}\n${suffix}` }
      })
    }
  }
  const legacy = action as Rec
  return {
    type: legacy.type ?? BuiltinActionType.ContinueConversation,
    params: { ...(legacy.params ?? {}), ...(legacy.url !== undefined ? { url: legacy.url } : {}), ...(legacy.context ? { context: legacy.context } : {}), ...context }
  }
}

// MARK: Documents

type Scope = { formName?: string; inForm: boolean }
type ActionEntry = { label: string; formName?: string; action?: unknown; validate?: boolean }
type FieldEntry = {
  kind: "state" | "selection" | "table" | "visible"
  name: string
  formName?: string
  inForm: boolean
  componentType: string
  binding?: { target: string; expr: Rec }
  rules: Rec[]
  mode: "text" | "validate" | "slider" | "none"
  selectionType?: string
  defaultValue?: unknown
}

/** Field names whose `value` prop binds a $variable: Input, Select, …, Callout's `visible`. */
const STATE_FIELDS: Record<string, FieldEntry["mode"]> = {
  Input: "text",
  TextArea: "text",
  Select: "validate",
  DatePicker: "validate",
  RadioGroup: "validate",
  CheckBoxGroup: "validate",
  Slider: "slider",
  SwitchGroup: "none"
}

class Doc {
  readonly id: string
  code = ""
  streaming = false
  result: Rec | null = null
  parseException: Rec | null = null
  readonly parser = createStreamingParser(spec!.schema as any, spec!.root)
  readonly store = createStore()
  readonly queries: ReturnType<typeof createQueryManager>
  initializing = false
  storeInitKey = ""
  initialState: Rec | undefined
  mutationOnly = new Set<string>()
  wantsRows = new Set<string>()
  actions = new Map<string, ActionEntry>()
  fields = new Map<string, FieldEntry>()
  formFields = new Map<string, Array<{ name: string; rules: Rec[]; getValue: () => unknown }>>()
  formErrors: Record<string, Record<string, string | undefined>> = {}
  hydrate: Array<() => void> = []
  passwordFields = new Set<string>()
  runtimeErrors: Rec[] = []
  lastRoot: Rec | null = null
  queriedResult: Rec | null = null
  queriedSnapshot: Rec | null = null
  pending = new Map<number, { name: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  nextTool = 1
  disposed = false
  readonly context: Rec

  constructor(id: string) {
    this.id = id
    this.queries = createQueryManager({ callTool: (name: string, args: Rec) => this.callTool(name, args) })
    this.queries.activate()
    this.queries.subscribe(() => this.invalidate())
    this.store.subscribe(() => {
      if (!this.initializing) this.emit("state", this.store.getSnapshot())
      this.invalidate()
    })
    this.context = {
      getState: (name: string) => unwrapField(this.store.get(name)),
      resolveRef: (name: string) => this.queries.getMutationResult(name) ?? this.queries.getResult(name),
      functions,
      actions: spec!.schema.actions
    }
  }

  emit(kind: string, payload: unknown) {
    if (!this.disposed) __host.emit(this.id, kind, safeJSON(payload ?? null))
  }

  invalidate() {
    this.emit("invalidate", null)
  }

  // Tools: the host runs them (runUiOperation) and answers with resolveTool.
  callTool(name: string, args: Rec): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = this.nextTool++
      this.pending.set(request, { name, resolve, reject })
      this.emit("tool", { request, name, args: args ?? {}, query: !this.mutationOnly.has(name) })
    })
  }

  resolveTool({ request, result, error }: Rec) {
    const call = this.pending.get(request)
    if (!call) return
    this.pending.delete(request)
    if (typeof error === "string") call.reject(new McpToolError(error))
    else call.resolve(Array.isArray(result) && this.wantsRows.has(call.name) ? { rows: result } : (result ?? null))
  }

  setInitialState(state: unknown) {
    this.initialState = isRecord(state) ? state : undefined
    this.initStore()
  }

  setCode({ code, streaming }: Rec) {
    this.code = String(code ?? "")
    this.streaming = streaming === true
    this.parseException = null
    if (!this.code) this.result = null
    else {
      try {
        this.result = this.parser.set(this.code, !this.streaming) as unknown as Rec
      } catch (cause) {
        this.parseException = {
          source: "parser",
          code: "parse-exception",
          message: `Parser crashed: ${cause instanceof Error ? cause.message : String(cause)}`,
          hint: "The response may contain syntax the parser cannot handle"
        }
        this.result = null
      }
    }
    if (this.result) {
      this.mutationOnly = mutationOnlyTools(this.result)
      this.wantsRows = rowsTools(this.result, this.code)
    }
    this.initStore()
  }

  /** $variable defaults and the saved state, as the Renderer does (saved `$` values win; other keys are forms). */
  initStore() {
    const declarations = this.result?.stateDeclarations
    if (!declarations && !this.initialState) return
    const key = `${safeJSON(declarations)}::${safeJSON(this.initialState)}`
    if (key === this.storeInitKey) return
    this.storeInitKey = key
    const bindings: Rec = {}
    if (this.initialState) {
      for (const [name, value] of Object.entries(this.initialState)) {
        if (name.startsWith("$")) bindings[name] = value
        else this.store.set(name, value)
      }
    }
    this.initializing = true
    this.store.initialize(declarations ?? {}, bindings)
    this.initializing = false
  }

  getFieldValue(formName: string | undefined, name: string) {
    if (!formName) return unwrapField(this.store.get(name))
    const form = this.store.get(formName)
    return isRecord(form) ? unwrapField(form[name]) : undefined
  }

  setFieldValue(formName: string | undefined, componentType: string | undefined, name: string, value: unknown) {
    const wrapped = { value, componentType }
    if (!formName) this.store.set(name, wrapped)
    else {
      const raw = this.store.get(formName)
      this.store.set(formName, { ...(isRecord(raw) ? raw : {}), [name]: wrapped })
    }
    this.emit("state", this.store.getSnapshot())
  }

  formPayload(formName?: string) {
    if (formName) {
      const raw = this.store.get(formName)
      if (isRecord(raw)) return { [formName]: raw }
    }
    return this.store.getSnapshot()
  }

  // MARK: Render

  render() {
    const blocked = this.streaming
    const result = this.result
    // Like the Renderer's effects, queries are evaluated only when the program or the store changes (an errored
    // query would otherwise be fetched again on every render).
    const snapshot = this.store.getSnapshot()
    if (!blocked && result && (result !== this.queriedResult || snapshot !== this.queriedSnapshot)) {
      const programChanged = result !== this.queriedResult
      this.queriedResult = result
      this.queriedSnapshot = snapshot
      const nodes = (result.queryStatements as Rec[]).map((statement) => {
        const deps: Rec = {}
        for (const ref of statement.deps ?? []) deps[ref] = snapshot[ref]
        const run = (ast: unknown) => {
          try {
            return ast ? evaluate(ast as any, this.context as any) : null
          } catch {
            return null
          }
        }
        return {
          statementId: statement.statementId,
          toolName: statement.toolAST ? (run(statement.toolAST) as string) : "",
          args: run(statement.argsAST),
          defaults: run(statement.defaultsAST),
          refreshInterval: statement.refreshAST ? (run(statement.refreshAST) as number) : undefined,
          deps: Object.keys(deps).length > 0 ? deps : undefined,
          complete: statement.complete
        }
      })
      this.queries.evaluateQueries(nodes as any)
      if (programChanged) this.queries.registerMutations(
        (result.mutationStatements as Rec[]).map((statement) => ({
          statementId: statement.statementId,
          toolName: statement.toolAST ? String(evaluate(statement.toolAST, this.context as any) ?? "") : ""
        }))
      )
    }

    let root: Rec | null = null
    this.runtimeErrors = []
    if (result?.root || result?.rootExpression) {
      try {
        root = evaluateRoot(result as any, { ctx: this.context as any, library: library as any, store: this.store, errors: this.runtimeErrors as any }) as Rec | null
        this.lastRoot = root
      } catch (cause) {
        this.runtimeErrors.push({ source: "runtime", code: "runtime-error", message: `Prop evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}` })
        root = this.lastRoot
      }
    }

    const querySnapshot = this.queries.getSnapshot()
    const loading = querySnapshot.__openui_loading.length > 0
    this.actions = new Map()
    this.fields = new Map()
    this.formFields = new Map()
    this.passwordFields = new Set()
    this.hydrate = []
    const tree = root && isElement(root) ? this.node(root, "root", { inForm: false }, loading) : null
    const hydrate = this.hydrate
    this.hydrate = []
    for (const apply of hydrate) apply()

    return {
      tree,
      loading,
      streaming: this.streaming,
      errors: this.errors(querySnapshot),
      passwordFields: [...this.passwordFields],
      statements: result?.meta?.statementCount ?? 0
    }
  }

  /** The Renderer's onError list (useOpenUIErrors): none while streaming. */
  errors(querySnapshot: Rec) {
    if (this.streaming) return []
    const errors: Rec[] = []
    if (this.parseException) errors.push(this.parseException)
    if (this.code && !this.result?.meta?.statementCount && !this.parseException) {
      errors.push({
        source: "parser",
        code: "parse-failed",
        message: "Response could not be parsed as valid openui-lang",
        hint: `The entire response must be valid openui-lang code starting with root = ${spec?.root ?? "Root"}(...)`
      })
    }
    if (this.result?.meta?.errors?.length) errors.push(...(enrichErrors(this.result.meta.errors, spec!.schema as any, componentNames) as Rec[]))
    errors.push(...this.runtimeErrors)
    errors.push(...(querySnapshot.__openui_errors ?? []))
    return errors
  }

  convert(value: unknown, path: string, scope: Scope, loading: boolean): unknown {
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value !== "object") return typeof value === "function" ? null : value
    if (isElement(value)) return this.node(value, path, scope, loading)
    if (isReactiveAssign(value)) return { $bind: value.target, value: this.store.get(value.target) ?? null }
    if (isActionPlan(value)) return { $a: this.register(path, { label: "", formName: scope.formName, action: value }) }
    if (Array.isArray(value)) return value.map((item, index) => this.convert(item, `${path}.${index}`, scope, loading) ?? null)
    const out: Rec = {}
    for (const [key, item] of Object.entries(value)) {
      const converted = this.convert(item, `${path}.${key}`, scope, loading)
      if (converted !== undefined) out[key] = converted
    }
    return out
  }

  register(id: string, entry: ActionEntry) {
    this.actions.set(id, entry)
    return id
  }

  node(el: { typeName: string; props: Rec; partial?: boolean; statementId?: string }, path: string, scope: Scope, loading: boolean): Rec {
    const type = el.typeName
    const props = el.props ?? {}
    const inner: Scope = type === "Form" ? { formName: typeof props.name === "string" ? props.name : undefined, inForm: true } : scope
    const out: Rec = { $: type, k: path, p: {} }
    if (el.statementId) out.s = el.statementId
    if (el.partial) out.partial = true
    for (const [key, value] of Object.entries(props)) {
      const converted = this.convert(value, `${path}.${key}`, inner, loading)
      if (converted !== undefined) out.p[key] = converted
    }
    this.decorate(type, props, out, path, scope, loading)
    return out
  }

  /** What each component does beyond showing its props (react-ui's genui-lib renderers). */
  decorate(type: string, props: Rec, out: Rec, path: string, scope: Scope, loading: boolean) {
    const items = asArray(props.items).filter(isElement)
    switch (type) {
      case "Button": {
        const action = props.action
        const variant = props.variant || "primary"
        let check = false
        if (scope.inForm && variant === "primary") {
          check = isActionPlan(action)
            ? action.steps.some((step) => step.type === ACTION_STEPS.ToAssistant || step.type === "custom_action" || (step.type === ACTION_STEPS.Run && step.refType === "mutation"))
            : true
        }
        out.a = this.register(`${path}#press`, { label: String(props.label ?? ""), formName: scope.formName, action, validate: check })
        break
      }
      case "IconButton":
        out.a = this.register(`${path}#press`, { label: String(props.name ?? ""), formName: scope.formName, action: props.action })
        break
      case "FollowUpBlock":
        items.forEach((item, index) => {
          const node = out.p.items?.[index]
          if (isRecord(node)) node.a = this.register(`${path}.items.${index}#press`, { label: String(item.props.text ?? "") })
        })
        break
      case "ListBlock":
        items.forEach((item, index) => {
          const node = out.p.items?.[index]
          if (isRecord(node) && item.props.action) node.a = this.register(`${path}.items.${index}#press`, { label: String(item.props.title ?? ""), action: item.props.action })
        })
        break
      case "SnippetCardBlock":
      case "OverviewCardBlock":
      case "ContextCardBlock":
      case "CompositeCardBlock":
      case "VisualCardBlock":
        if (props.action && !this.streaming) {
          items.forEach((item, index) => {
            const node = out.p.items?.[index]
            if (!isRecord(node)) return
            const { label, context } = cardItem(type, item, index)
            node.a = this.register(`${path}.items.${index}#press`, { label, formName: scope.formName, action: withItemContext(props.action, context) })
          })
        }
        break
      case "FormControl": {
        const input = props.input
        const raw = isElement(input) ? input.props.name : undefined
        const name = isRecord(raw) && raw.name ? raw.name : raw
        if (typeof name === "string" && scope.inForm) out.error = this.formErrors[scope.formName ?? ""]?.[name] ?? null
        out.required = isElement(input) && isRecord(input.props.rules) && input.props.rules.required === true
        break
      }
      case "Table": {
        const columns = asArray(props.columns).filter(isElement)
        const rows = columns.length ? Math.max(0, ...columns.map((column) => asArray(column.props.data).length)) : 0
        out.loading = loading && rows === 0
        break
      }
      case "PieChart":
      case "RadialChart":
        out.loading = loading
        break
      case "Callout":
        if (isReactiveAssign(props.visible)) {
          this.fields.set(path, { kind: "visible", name: "visible", inForm: false, componentType: type, binding: props.visible as any, rules: [], mode: "none" })
          out.f = { value: this.store.get((props.visible as any).target) ?? null }
        }
        break
      case "Chips":
      case "OptionCards":
        this.selectionField(type, props, out, path, scope)
        break
      case "EditableTable": {
        const name = String(props.name ?? "")
        this.fields.set(path, { kind: "table", name, formName: name, inForm: false, componentType: type, rules: [], mode: "none" })
        out.f = { value: this.getFieldValue(name, name) ?? null }
        break
      }
      default:
        if (STATE_FIELDS[type] && typeof props.name === "string") this.stateField(type, props, out, path, scope)
    }
  }

  /** useStateField: a field bound to a $variable, or kept under its name (in its form). */
  stateField(type: string, props: Rec, out: Rec, path: string, scope: Scope) {
    const name = props.name as string
    const rules = parseStructuredRules(props.rules) as Rec[]
    const binding = isReactiveAssign(props.value) ? (props.value as any) : undefined
    const entry: FieldEntry = { kind: "state", name, formName: scope.formName, inForm: scope.inForm, componentType: type, binding, rules, mode: STATE_FIELDS[type] }
    this.fields.set(path, entry)
    const read = () => (binding ? this.store.get(binding.target) : (this.getFieldValue(scope.formName, name) ?? props.value))
    const value = read()
    if (type === "Input" && props.type === "password") this.passwordFields.add(name)
    if (scope.inForm && rules.length && !this.streaming) this.addFormField(scope.formName, name, rules, read)
    out.f = { value: value ?? null, error: scope.inForm ? (this.formErrors[scope.formName ?? ""]?.[name] ?? null) : null }
  }

  /** Chips and OptionCards: a selection kept under its name, starting from defaultValue. */
  selectionField(type: string, props: Rec, out: Rec, path: string, scope: Scope) {
    const name = String(props.name ?? "")
    const selectionType = props.type ?? (type === "Chips" ? "multiple" : "single")
    const rules = parseStructuredRules(props.rules) as Rec[]
    const existing = this.getFieldValue(scope.formName, name)
    const fallback = storedDefault(selectionType, props.defaultValue)
    this.fields.set(path, { kind: "selection", name, formName: scope.formName, inForm: scope.inForm, componentType: type, rules, mode: "validate", selectionType, defaultValue: props.defaultValue })
    if (!this.streaming && existing === undefined && fallback !== undefined) this.hydrate.push(() => this.setFieldValue(scope.formName, type, name, fallback))
    if (scope.inForm && rules.length && !this.streaming) {
      this.addFormField(scope.formName, name, rules, () => {
        const value = this.getFieldValue(scope.formName, name) ?? fallback
        if (selectionType === "single") return typeof value === "string" && value ? value : undefined
        return Array.isArray(value) && value.length > 0 ? value : undefined
      })
    }
    out.f = {
      selection: normalizeSelection(selectionType, existing, props.defaultValue),
      type: selectionType,
      error: scope.inForm ? (this.formErrors[scope.formName ?? ""]?.[name] ?? null) : null
    }
  }

  addFormField(formName: string | undefined, name: string, rules: Rec[], getValue: () => unknown) {
    const key = formName ?? ""
    const list = this.formFields.get(key) ?? []
    list.push({ name, rules, getValue })
    this.formFields.set(key, list)
  }

  setFieldError(formName: string | undefined, name: string, error: string | undefined) {
    const key = formName ?? ""
    const errors = (this.formErrors[key] ??= {})
    if (errors[name] === error) return
    errors[name] = error
    this.invalidate()
  }

  validateForm(formName?: string) {
    let valid = true
    const errors: Record<string, string | undefined> = {}
    for (const field of this.formFields.get(formName ?? "") ?? []) {
      const error = validate(unwrapField(field.getValue()), field.rules as any)
      errors[field.name] = error
      if (error) valid = false
    }
    this.formErrors[formName ?? ""] = errors
    this.invalidate()
    return valid
  }

  // MARK: Input from the app

  setField({ key, value }: Rec) {
    const field = this.fields.get(key)
    if (!field) return
    if (field.binding) {
      const next = evaluate(field.binding.expr as any, { ...(this.context as any), extraScope: { $value: value } })
      this.store.set(field.binding.target, next)
    } else this.setFieldValue(field.formName, undefined, field.name, value)
    if (!field.inForm || !field.rules.length) return
    if (field.mode === "text") this.setFieldError(field.formName, field.name, undefined)
    else if (field.mode === "validate") this.setFieldError(field.formName, field.name, validate(value, field.rules as any))
    else if (field.mode === "slider") this.setFieldError(field.formName, field.name, validate(Array.isArray(value) ? value[0] : value, field.rules as any))
  }

  focusField({ key }: Rec) {
    const field = this.fields.get(key)
    if (field?.inForm && field.rules.length) this.setFieldError(field.formName, field.name, undefined)
  }

  blurField({ key, value }: Rec) {
    const field = this.fields.get(key)
    if (field?.inForm && field.rules.length && field.mode === "text") this.setFieldError(field.formName, field.name, validate(value, field.rules as any))
  }

  toggle({ key, value }: Rec) {
    const field = this.fields.get(key)
    if (!field || field.kind !== "selection" || this.streaming) return
    const type = field.selectionType ?? "single"
    const selection = normalizeSelection(type, this.getFieldValue(field.formName, field.name), field.defaultValue)
    const next = toggleSelection(type, selection, String(value))
    const stored = type === "single" ? (next[0] ?? undefined) : next
    this.setFieldValue(field.formName, field.componentType, field.name, stored)
    if (field.inForm && field.rules.length) {
      const checked = type === "single" ? (next[0] ?? undefined) : next.length > 0 ? next : undefined
      this.setFieldError(field.formName, field.name, validate(checked, field.rules as any))
    }
  }

  /** EditableTable's Save Changes: the rows become the table's form field, then it acts like a submit. */
  saveTable({ key, rows }: Rec) {
    const field = this.fields.get(key)
    if (!field || field.kind !== "table") return
    this.setFieldValue(field.name, "EditableTable", field.name, rows)
    return this.triggerAction("Save Changes", field.name, undefined)
  }

  async press({ id }: Rec) {
    const entry = this.actions.get(id)
    if (!entry) return
    if (entry.validate && !this.validateForm(entry.formName)) return
    await this.triggerAction(entry.label, entry.formName, entry.action)
  }

  /** react-lang's triggerAction: legacy action objects, action plans (@Run, @ToAssistant, @Set, …), or a plain send. */
  async triggerAction(userMessage: string, formName: string | undefined, action: unknown) {
    const send = (event: Rec) => this.emit("action", event)
    if (action && !isActionPlan(action)) {
      const legacy = action as Rec
      const type = legacy.type || BuiltinActionType.ContinueConversation
      if (spec?.schema.actions && Object.prototype.hasOwnProperty.call(spec.schema.actions, type)) return
      const params = { ...(legacy.params || {}) }
      if (legacy.url) params.url = legacy.url
      if (legacy.context) params.context = legacy.context
      send({ type, params, humanFriendlyMessage: userMessage, formState: this.formPayload(formName), formName })
      return
    }
    if (isActionPlan(action)) {
      for (const step of action.steps) {
        switch (step.type) {
          case ACTION_STEPS.Run:
            if (step.refType === "mutation") {
              const statement = (this.result?.mutationStatements as Rec[] | undefined)?.find((item) => item.statementId === step.statementId)
              const args = statement?.argsAST ? evaluate(statement.argsAST, this.context as any) : {}
              if (!(await this.queries.fireMutation(step.statementId, args as Rec))) return
            } else this.queries.invalidate([step.statementId])
            break
          case ACTION_STEPS.ToAssistant:
            send({
              type: BuiltinActionType.ContinueConversation,
              params: step.context !== undefined ? { context: step.context } : {},
              humanFriendlyMessage: step.message,
              formState: this.formPayload(formName),
              formName
            })
            break
          case ACTION_STEPS.OpenUrl:
            send({ type: BuiltinActionType.OpenUrl, params: { url: step.url }, humanFriendlyMessage: "", formState: this.formPayload(formName), formName })
            break
          case "custom_action":
            send({ type: step.name, params: step.params, humanFriendlyMessage: "", formState: this.formPayload(formName), formName })
            break
          case ACTION_STEPS.Set:
            if (step.valueAST) this.store.set(step.target, evaluate(step.valueAST, this.context as any))
            break
          case ACTION_STEPS.Reset: {
            const declarations = (this.result?.stateDeclarations ?? {}) as Rec
            for (const target of step.targets) this.store.set(target, declarations[target] ?? null, { pristine: true })
            break
          }
        }
      }
      return
    }
    send({ type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: userMessage, formState: this.formPayload(formName), formName })
  }

  retry() {
    const failed = (this.queries.getSnapshot().__openui_errors as Rec[]).filter((error) => error.source === "query").map((error) => error.statementId)
    this.queries.invalidate(failed)
  }

  dispose() {
    this.disposed = true
    this.queries.dispose()
    this.store.dispose()
    this.pending.clear()
  }
}

/** A pressed card's label and the details sent with it (each block's renderer in react-ui's genui-lib). */
function cardItem(type: string, item: { props: Rec }, index: number): { label: string; context: Rec } {
  const p = item.props
  switch (type) {
    case "SnippetCardBlock":
      return {
        label: str(p.lhs, "title") ?? p.id ?? `Snippet card ${index + 1}`,
        context: { itemIndex: index, itemId: p.id, itemTitle: str(p.lhs, "title"), itemSubtitle: str(p.lhs, "subtitle"), itemValue: str(p.rhs, "value") }
      }
    case "OverviewCardBlock": {
      const title = str(p.top, "title") ?? str(p.top, "value")
      return {
        label: title ?? p.id ?? `Overview card ${index + 1}`,
        context: { itemIndex: index, itemId: p.id, itemTitle: title, itemSubtitle: str(p.top, "subtitle") ?? str(p.top, "subtext"), itemMetricValue: p.bottom?.props?.value }
      }
    }
    case "ContextCardBlock": {
      const title = typeof p.title === "string" ? p.title : (p.title?.props?.text ?? "")
      return {
        label: title || p.id || `Context card ${index + 1}`,
        context: { itemIndex: index, itemId: p.id, itemTitle: title, itemBody: p.body, itemBgColor: p.bgColor, itemBgImageSrc: p.bgImageSrc, itemBgImageAlt: p.bgImageAlt }
      }
    }
    case "CompositeCardBlock": {
      const header = p.header?.props ?? {}
      const pick = (...keys: string[]) => keys.map((key) => header[key]).find((value) => typeof value === "string") as string | undefined
      const title = pick("title", "value")
      const alt = pick("alt")
      const price = p.footer?.price?.props
      return {
        label: title || alt || p.id || `Composite card ${index + 1}`,
        context: {
          itemIndex: index,
          itemId: p.id,
          itemHeaderTitle: title,
          itemHeaderSubtitle: pick("subtitle", "subtext"),
          itemHeaderAlt: alt,
          itemBodyCount: Array.isArray(p.body) ? p.body.length : 0,
          itemFooterPrice: price && "value" in price ? price.value : undefined,
          itemFooterButtonLabel: p.footer?.button?.props?.label
        }
      }
    }
    default: {
      const body = p.body?.props?.value
      const tag = p.tag?.props?.text
      return {
        label: body || tag || p.id || `Visual card ${index + 1}`,
        context: { itemIndex: index, itemId: p.id, itemTag: tag, itemBody: body, itemBodySubtext: p.body?.props?.subtext, itemBgImageSrc: p.bgImageSrc, itemBgImageAlt: p.bgImageAlt }
      }
    }
  }
}

// MARK: Entry points (called by DexCore's OpenUIRuntime)

const docs = new Map<string, Doc>()

g.OpenUIEngine = {
  version: 1,
  configure,
  fireTimer(id: number) {
    timers.get(id)?.()
  },
  /** Runs `method` on document `id` with a JSON payload; returns JSON (or "null"). */
  call(id: string, method: string, payload: string): string | Promise<string> {
    const args = payload ? JSON.parse(payload) : {}
    if (method === "create") {
      docs.get(id)?.dispose()
      docs.set(id, new Doc(id))
      return "null"
    }
    const doc = docs.get(id)
    if (!doc) return "null"
    switch (method) {
      case "dispose":
        doc.dispose()
        docs.delete(id)
        return "null"
      case "render":
        return safeJSON(doc.render())
      case "setInitialState":
        doc.setInitialState(args.state)
        return "null"
      case "setCode":
        doc.setCode(args)
        return "null"
      case "setField":
        doc.setField(args)
        return "null"
      case "focusField":
        doc.focusField(args)
        return "null"
      case "blurField":
        doc.blurField(args)
        return "null"
      case "toggle":
        doc.toggle(args)
        return "null"
      case "saveTable":
        void doc.saveTable(args)
        return "null"
      case "press":
        void doc.press(args)
        return "null"
      case "resolveTool":
        doc.resolveTool(args)
        return "null"
      case "retry":
        doc.retry()
        return "null"
      case "snapshot":
        return safeJSON(doc.store.getSnapshot())
      default:
        throw new Error(`Unknown method ${method}`)
    }
  }
}
