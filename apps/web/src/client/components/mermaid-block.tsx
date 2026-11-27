import { Check, Code2, Copy, Download, Eye } from "lucide-react"
import { memo, useEffect, useId, useState } from "react"
import { toast } from "sonner"

let mermaidInit: Promise<typeof import("mermaid")["default"]> | null = null

const getMermaid = () => {
  if (!mermaidInit) {
    mermaidInit = import("mermaid").then((mod) => {
      const m = mod.default
      m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        suppressErrorRendering: true
      })
      return m
    })
  }
  return mermaidInit
}

/** Lazy-loaded Mermaid diagram renderer (strict securityLevel, SVG export, Source/Diagram toggle). */
export default memo(function MermaidBlock({ code }: { code: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void getMermaid()
        .then(async (mermaid) => {
          const result = await mermaid.render(`dex-mmd-${reactId}-${Date.now()}`, code)
          if (!cancelled) {
            setSvg(result.svg)
            setFailed(false)
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, reactId])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  const downloadSvg = () => {
    if (!svg) return
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = "diagram.svg"
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    toast.success("Downloaded diagram.svg")
  }

  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/90">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-3 py-1.5 text-[11px] text-zinc-400">
        <span className="font-mono tracking-wide uppercase">mermaid</span>
        <div className="flex items-center gap-1">
          {svg && (
            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {showSource ? <Eye className="size-3" /> : <Code2 className="size-3" />}
              <span>{showSource ? "Diagram" : "Source"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          {svg && (
            <button
              type="button"
              onClick={downloadSvg}
              title="Download SVG"
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Download className="size-3" />
              <span className="hidden sm:inline">SVG</span>
            </button>
          )}
        </div>
      </div>
      {svg && !showSource ? (
        <div
          className="scrollbar-thin flex justify-center overflow-x-auto bg-zinc-950 p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          // Rendered by mermaid with securityLevel: "strict" (DOMPurify-sanitized SVG).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className="scrollbar-thin overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed text-zinc-300">
          <code>{code}</code>
          {failed && <span className="mt-2 block text-[11px] text-zinc-500">Showing source (diagram syntax incomplete)</span>}
        </pre>
      )}
    </div>
  )
})
