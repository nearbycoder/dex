// Goldens for the Kotlin OpenUI Lang port: lang-core's own parser and evaluator on fixed programs.
// Run from the repo root:  node apps/android/tools/goldens/openui.mts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import {
  createParser,
  createQueryManager,
  createStore,
  createStreamingParser,
  evaluate,
  evaluateRoot,
  markReactive,
  type EvaluationContext
} from "@openuidev/lang-core"

const SPEC_PATH = new URL("../../../web/src/shared/openui-spec.json", import.meta.url)
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"))
const OUT = new URL("../../core/openui/src/test/resources/golden/", import.meta.url)
mkdirSync(OUT, { recursive: true })

const examples: string[] = spec.promptOptions.examples

/** Programs that exercise the corners: errors, streaming shapes, expressions, state, data, actions. */
const cases: Record<string, string> = {
  minimal: `root = Card([TextContent("Hello")])`,
  forwardRefs: `root = Card([header, body])\nheader = CardHeader("Title", "Sub")\nbody = TextContent("Body **bold**", "small")`,
  fences: "Here you go:\n```openui\nroot = Card([t])\nt = TextContent(\"x\")\n```\nDone.",
  comments: `# a comment\nroot = Card([t]) // trailing\nt = TextContent("a # not a comment", "large") # comment`,
  missingRequired: `root = Card([CardHeader("ok"), Callout("info", "Only title")])`,
  nullRequired: `root = Card([TextContent(null), TextContent("kept")])`,
  unknownComponent: `root = Card([Bogus("x"), TextContent("y")])`,
  typeMismatch: `root = Card([TextContent(42), Table("not an array")])`,
  enumMismatch: `root = Card([TextContent("x", "huge"), Buttons([Button("Go", @ToAssistant("go"), "loud")])])`,
  excessArgs: `root = Card([CardHeader("a", "b", "c", "d")])`,
  unresolved: `root = Card([header, missing])\nheader = CardHeader(title)`,
  cycle: `root = Card([a])\na = Card([b])\nb = Card([a])`,
  orphaned: `root = Card([a])\na = TextContent("a")\nb = TextContent("unused")\n$s = "x"`,
  noRoot: `header = CardHeader("x")`,
  fallbackRoot: `main = Card([TextContent("fallback")])`,
  notComponent: `root = "just a string"`,
  rootExpression: `$dark = false\nroot = $dark ? Card([TextContent("dark")]) : Card([TextContent("light")])`,
  inlineReserved: `root = Card([TextContent(Query("app_list_sessions", {}, []))])`,
  unknownFunction: `root = Card([TextContent(@Nope(1))])`,
  expressions: `$a = 4\n$b = "5"\nroot = Card([TextContent("Sum: " + ($a + 1) + " eq " + ($a == $b) + " " + (!$a) + " " + (-$a * 2 % 3) + " " + ($a >= 4 && $b != null ? "y" : "n"))])`,
  multilineTernary: `$on = true\nroot = Card([label])\nlabel = TextContent($on\n  ? "On"\n  : "Off")`,
  numbers: `root = Card([TextContent("x"), Table([Col("n", [1, -2, 3.5, 1e3, 2.5e-3, 0.1])])])`,
  strings: `root = Card([TextContent("tab\\there \\"quoted\\" \\u00e9 \\n newline"), TextContent('single \\'quote\\' \\n')])`,
  objects: `root = Card([EntityList([{ left: "A", right: "1" }, {left: 'B', right: "2", rightVariant: "number"}], "small", {left: "K", right: "V"})])`,
  state: `$tab = "b"\n$count = 0\n$items = ["x", "y"]\n$flag\nroot = Card([TextContent("Tab " + $tab), TextContent($undeclared)])`,
  bindings: `$name = "Ada"\nroot = Card([Form("f", buttons, [FormControl("Name", Input("name", "Your name", "text", {required: true, minLength: 2}, $name))])])\nbuttons = Buttons([Button("Send", @ToAssistant("Submit"))])`,
  queries: `sessions = Query("app_list_sessions", {limit: $limit, q: "x " + $q}, {rows: []}, 30)\n$limit = 5\nroot = Card([Table([Col("Title", sessions.rows.title)]), TextContent("Count " + @Count(sessions.rows))])`,
  mutations: `stop = Mutation("app_stop_vm", {key: $vm})\n$vm = "s1"\nroot = Card([Buttons([Button("Stop", Action([@Run(stop), @Set($vm, ""), @ToAssistant("Stopped it")]))]), TextContent(stop.status)])`,
  each: `$rows = [{name: "a", n: 1}, {name: "b", n: 2}]\nroot = Card([ListBlock(@Each($rows, "r", ListItem(r.name, "n=" + r.n, null, "Pick", @Set($sel, r.name))))])`,
  builtins: `xs = [3, 1, 2]\nroot = Card([TextContent("" + @Sum(xs) + @Avg(xs) + @Min(xs) + @Max(xs) + @Round(2.555, 2) + @Abs(-3) + @Floor(1.7) + @Ceil(1.2) + @First(xs) + @Last(xs))])`,
  dexFunctions: `root = Card([TextContent(@Ago(1700000000000)), TextContent(@Bytes(2048)), TextContent(@DateTime("bad", 3))])`,
  dexActions: `root = Card([Buttons([Button("Open", @OpenChat("s1")), Button("Copy", @Copy("hi")), Button("Bad", @OpenFile(5)), Button("Url", @OpenUrl("https://example.com"))])])`,
  charts: `root = Card([BarChart(["a", "b"], [Series("x", [1, 2]), Series("y", [3, 4])], "stacked"), PieChart(["p", "q"], [60, 40], "donut")])`,
  partialTail: `root = Card([t])\nt = TextContent("Hello wor`,
  halfStatement: `root = Card([header, tbl])\nheader = CardHeader("Report")\ntbl = Table([Col("A", [1, 2`,
  duplicate: `root = Card([t])\nt = TextContent("first")\nt = TextContent("second")`,
  member: `$o = {a: {b: [10, 20]}}\nroot = Card([TextContent("v" + $o.a.b[1] + $o.a.b.length + $o["a"].b[0])])`,
  junk: `this is not openui at all`,
  empty: ``
}

const parser = createParser(spec.schema, spec.root)
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

const parsed = Object.fromEntries(
  [...examples.map((program, index) => [`example${index + 1}`, program] as const), ...Object.entries(cases)].map(([name, program]) => [
    name,
    { program, result: plain(parser.parse(program)) }
  ])
)
writeFileSync(new URL("parse.json", OUT), JSON.stringify(parsed, null, 1) + "\n")

// Streaming: one parser per program, fed growing prefixes, then the whole text with complete = true.
const streams = Object.fromEntries(
  Object.entries(parsed).map(([name, { program }]) => {
    const stream = createStreamingParser(spec.schema, spec.root)
    const cuts = new Set<number>()
    for (let i = 1; i <= 4; i++) cuts.add(Math.round((program.length * i) / 5))
    // Statement boundaries, thinned on long programs so the golden stays small.
    const newlines = [...program.matchAll(/\n/g)].map((match) => match.index!)
    const every = Math.max(1, Math.ceil(newlines.length / 12))
    newlines.forEach((index, i) => {
      if (i % every === 0) cuts.add(index)
    })
    const steps = [...cuts].sort((a, b) => a - b).filter((cut) => cut > 0 && cut < program.length).map((cut) => ({
      length: cut,
      result: plain(stream.set(program.slice(0, cut)))
    }))
    steps.push({ length: program.length, result: plain(stream.set(program, true)) })
    return [name, steps]
  })
)
writeFileSync(new URL("stream.json", OUT), JSON.stringify(streams) + "\n")

// Evaluation: each program's root evaluated against fixed state and query results.
const queryResults: Record<string, unknown> = {
  sessions: { rows: [{ title: "First chat", busy: true }, { title: "Second", busy: false }] },
  stop: { status: "idle" }
}
// lang-core checks reactive schemas through a WeakSet it fills from markReactive.
const reactiveMarker = {}
markReactive(reactiveMarker)
const library = {
  components: Object.fromEntries(
    Object.entries(spec.components as Record<string, { signature: string }>).map(([name, c]) => {
      // Reactive props, as the React library marks them; here from the signatures.
      const shape: Record<string, object> = {}
      for (const m of c.signature.matchAll(/(\w+)\??:\s*\$binding</g)) shape[m[1]!] = reactiveMarker
      return [name, { props: { shape } }]
    })
  )
}

const DEX_FUNCTIONS = {
  Ago: { ...spec.schema.functions.Ago, fn: ({ time }: { time: number | string }) => `ago(${time})` },
  DateTime: { ...spec.schema.functions.DateTime, fn: ({ time }: { time: number | string }) => `dt(${time})` },
  Bytes: { ...spec.schema.functions.Bytes, fn: ({ bytes }: { bytes: number }) => `${bytes} bytes` }
}

const evaluated = Object.fromEntries(
  Object.entries(parsed).map(([name, { program }]) => {
    const result = parser.parse(program)
    const store = createStore()
    store.initialize(result.stateDeclarations, {})
    const errors: string[] = []
    const ctx: EvaluationContext = {
      getState: (n) => store.get(n),
      resolveRef: (n) => queryResults[n] ?? null,
      functions: DEX_FUNCTIONS,
      actions: spec.schema.actions,
      reportError: (message) => errors.push(message)
    }
    const runtimeErrors: unknown[] = []
    let root: unknown = null
    try {
      root = plain(evaluateRoot(result, { ctx, library: library as never, store, errors: runtimeErrors as never }))
    } catch (error) {
      root = { threw: String(error) }
    }
    const queries = result.queryStatements.map((q) => ({
      statementId: q.statementId,
      tool: q.toolAST ? evaluate(q.toolAST, ctx) : null,
      args: q.argsAST ? plain(evaluate(q.argsAST, ctx)) : null,
      defaults: q.defaultsAST ? plain(evaluate(q.defaultsAST, ctx)) : null,
      refresh: q.refreshAST ? evaluate(q.refreshAST, ctx) : null
    }))
    return [name, { root, errors, runtimeErrors: plain(runtimeErrors), queries, state: plain(store.getSnapshot()) }]
  })
)
writeFileSync(new URL("evaluate.json", OUT), JSON.stringify(evaluated, null, 1) + "\n")

// The query manager's cache keys (stable stringify), for a few argument shapes.
void createQueryManager
console.log("OpenUI goldens written to", OUT.pathname)
