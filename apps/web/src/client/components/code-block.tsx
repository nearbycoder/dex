import { Check, Copy, Download } from "lucide-react"
import { lazy, memo, Suspense, useMemo, useState } from "react"
import { toast } from "sonner"

const MermaidBlock = lazy(() =>
  import.meta.env.SSR
    ? Promise.resolve({ default: (() => null) as unknown as typeof import("./mermaid-block")["default"] })
    : import("./mermaid-block")
)

const DiffBlock = lazy(() =>
  import.meta.env.SSR
    ? Promise.resolve({ default: (() => null) as unknown as typeof import("./diff-block")["default"] })
    : import("./diff-block")
)

const isUnifiedDiff = (code: string) => /(^|\n)@@\s+-\d+/.test(code) && /(^|\n)---\s+/.test(code) && /(^|\n)\+\+\+\s+/.test(code)

const LANG_EXT: Readonly<Record<string, string>> = {
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  js: "js",
  jsx: "jsx",
  javascript: "js",
  mjs: "mjs",
  py: "py",
  python: "py",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  shell: "sh",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  swift: "swift",
  kt: "kt",
  kotlin: "kt",
  rs: "rs",
  rust: "rs",
  go: "go",
  html: "html",
  xml: "xml",
  css: "css",
  md: "md",
  markdown: "md",
  diff: "diff",
  toml: "toml",
  dockerfile: "Dockerfile"
}

type TokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "type" | "added" | "removed"

interface Token {
  readonly kind: TokenKind
  readonly text: string
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "text-zinc-200",
  comment: "text-zinc-500 italic",
  string: "text-emerald-300",
  keyword: "text-violet-300",
  number: "text-amber-300",
  type: "text-sky-300",
  added: "text-emerald-300 bg-emerald-950/50",
  removed: "text-rose-300 bg-rose-950/50"
}

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "defer", "def", "del",
  "do", "elif", "else", "enum", "export", "extends", "false", "finally", "fn", "for", "from", "fun", "func",
  "function", "if", "impl", "import", "in", "interface", "is", "let", "match", "mut", "new", "nil", "none",
  "null", "object", "override", "package", "private", "protected", "pub", "public", "raise", "readonly",
  "return", "select", "self", "static", "struct", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "val", "var", "void", "where", "while", "with", "yield",
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE",
  "INDEX", "JOIN", "LEFT", "INNER", "ON", "ORDER", "BY", "GROUP", "LIMIT", "AND", "OR", "NOT", "AS", "NULL"
])

const CODE_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Z][A-Za-z0-9_]*\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g

function tokenize(code: string, lang: string): Token[] {
  const normalized = lang.toLowerCase()
  if (normalized === "diff" || normalized === "patch") {
    return code.split("\n").flatMap((line, i, arr) => {
      const nl = i < arr.length - 1 ? "\n" : ""
      const kind: TokenKind =
        line.startsWith("+") && !line.startsWith("+++")
          ? "added"
          : line.startsWith("-") && !line.startsWith("---")
            ? "removed"
            : line.startsWith("@@")
              ? "type"
              : "plain"
      return [{ kind, text: line + nl }]
    })
  }
  const allowHashComments = ["py", "python", "sh", "bash", "zsh", "shell", "yaml", "yml", "toml", "ruby", "rb", "dockerfile"].includes(normalized)
  const tokens: Token[] = []
  let lastIndex = 0
  CODE_RE.lastIndex = 0
  for (const match of code.matchAll(CODE_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) tokens.push({ kind: "plain", text: code.slice(lastIndex, start) })
    const text = match[0]
    let kind: TokenKind = "plain"
    if (text.startsWith("//") || text.startsWith("/*") || (allowHashComments && text.startsWith("#"))) {
      kind = "comment"
    } else if (text.startsWith('"') || text.startsWith("'") || text.startsWith("`")) {
      kind = "string"
    } else if (/^\d/.test(text)) {
      kind = "number"
    } else if (KEYWORDS.has(text)) {
      kind = "keyword"
    } else if (/^[A-Z][A-Za-z0-9_]*$/.test(text) && text.length > 1) {
      kind = "type"
    }
    tokens.push({ kind, text })
    lastIndex = start + text.length
  }
  if (lastIndex < code.length) tokens.push({ kind: "plain", text: code.slice(lastIndex) })
  return tokens
}

/**
 * Syntax-highlighted fenced code block with language badge, 1-click Copy, and 1-click Download.
 * Synchronous tokenization keeps streaming replies flicker-free and strict-CSP compliant.
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const lang = (language ?? "").trim().toLowerCase()
  const tokens = useMemo(() => (code.length <= 24_000 ? tokenize(code, lang) : [{ kind: "plain" as const, text: code }]), [code, lang])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  const download = () => {
    const ext = LANG_EXT[lang] ?? "txt"
    const name = ext === "Dockerfile" ? "Dockerfile" : `snippet.${ext}`
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    toast.success(`Downloaded ${name}`)
  }

  const plainBlock = (
    <div className="not-prose group my-3 overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/90">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-3 py-1.5 text-[11px] text-zinc-400">
        <span className="font-mono tracking-wide uppercase">{lang || "code"}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            title="Copy code"
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={download}
            title="Download snippet"
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Download className="size-3" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed">
        <code>
          {tokens.map((token, index) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              <span key={index} className={TOKEN_CLASS[token.kind]}>
                {token.text}
              </span>
            )
          )}
        </code>
      </pre>
    </div>
  )

  if (!import.meta.env.SSR && lang === "mermaid" && code.trim().length > 4) {
    return (
      <Suspense fallback={plainBlock}>
        <MermaidBlock code={code} />
      </Suspense>
    )
  }

  if (!import.meta.env.SSR && (lang === "diff" || lang === "patch") && isUnifiedDiff(code)) {
    return (
      <Suspense fallback={plainBlock}>
        <DiffBlock code={code} fallback={plainBlock} />
      </Suspense>
    )
  }

  return plainBlock
})
