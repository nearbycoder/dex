import { PatchDiff } from "@pierre/diffs/react"
import { Check, Code2, Columns2, Copy, Download, Rows2 } from "lucide-react"
import { Component, memo, type ReactNode, useState } from "react"
import { toast } from "sonner"

class DiffBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Lazy-loaded `@pierre/diffs` unified/split diff viewer for fenced ```diff / ```patch blocks in chat. */
export default memo(function DiffBlock({ code, fallback }: { code: string; fallback: ReactNode }) {
  const [style, setStyle] = useState<"unified" | "split">("unified")
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  const download = () => {
    const blob = new Blob([code], { type: "text/x-diff;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = "changes.diff"
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    toast.success("Downloaded changes.diff")
  }

  if (raw) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setRaw(false)}
          className="absolute top-1.5 right-36 z-10 rounded-md px-2 py-0.5 text-[11px] text-emerald-400 hover:bg-zinc-800"
        >
          Diff view
        </button>
        {fallback}
      </div>
    )
  }

  return (
    <DiffBoundary fallback={fallback}>
      <div className="not-prose my-3 overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/90">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-3 py-1.5 text-[11px] text-zinc-400">
          <span className="font-mono tracking-wide uppercase">diff</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStyle((s) => (s === "unified" ? "split" : "unified"))}
              title={style === "unified" ? "Split view" : "Unified view"}
              className="hidden items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:inline-flex"
            >
              {style === "unified" ? <Columns2 className="size-3" /> : <Rows2 className="size-3" />}
              <span>{style === "unified" ? "Split" : "Unified"}</span>
            </button>
            <button
              type="button"
              onClick={() => setRaw(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Code2 className="size-3" />
              <span>Raw</span>
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Download className="size-3" />
            </button>
          </div>
        </div>
        <div className="scrollbar-thin max-h-[32rem] overflow-auto text-xs">
          <PatchDiff
            patch={code}
            disableWorkerPool
            options={{
              theme: "pierre-dark",
              themeType: "dark",
              diffStyle: style
            }}
          />
        </div>
      </div>
    </DiffBoundary>
  )
})
