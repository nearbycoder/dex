import { ImageOff } from "lucide-react"
import { isValidElement, lazy, memo, type ReactNode, Suspense, useMemo } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { CodeBlock } from "./code-block"
import { AssetDownloadLink, MediaPlayer, videoSource } from "./media"

const MathMarkdownBlock = lazy(() =>
  import.meta.env.SSR
    ? Promise.resolve({ default: (() => null) as unknown as typeof import("./math-markdown")["default"] })
    : import("./math-markdown")
)

// Detect LaTeX display/inline math without false-triggering on currency like "$50" or "$1.5M".
const HAS_MATH_RE =
  /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(^|[^\\$])\$(?!\s|\d+(?:[.,]\d+)?(?:\s|$|[,.;:)]|[kKmMbB]\b))[^$\n]+?\$(?!\d)/m

/** Images from other sites aren't loaded (the CSP blocks them too): their URLs could carry chat content out. */
const isInlineImage = (src: string) => src.startsWith("data:image/") || src.startsWith("blob:") || (src.startsWith("/") && !src.startsWith("//"))

const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i
const urlTransform = (url: string, key: string) => {
  if (key === "src" && (SAFE_DATA_IMAGE.test(url) || url.startsWith("blob:"))) return url
  return defaultUrlTransform(url)
}

const REMARK_PLUGINS = [remarkGfm]

/**
 * Splits Markdown into independent top-level blocks so while a long reply streams, only the final block re-parses
 * (O(N) instead of O(N²)). Falls back to a single block when reference link definitions or footnotes are present.
 */
function splitMarkdownBlocks(markdown: string): string[] {
  if (markdown.length < 400 || /^\[[^\]]+\]:/m.test(markdown)) return [markdown]
  const lines = markdown.split("\n")
  const blocks: string[] = []
  let current: string[] = []
  let fenceChar = ""
  let fenceLen = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trimStart()
    const fence = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fence) {
      const marker = fence[1]!
      if (!fenceChar) {
        fenceChar = marker[0]!
        fenceLen = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && trimmed.slice(marker.length).trim() === "") {
        fenceChar = ""
        fenceLen = 0
      }
      current.push(line)
      continue
    }
    if (!fenceChar && line.trim() === "" && current.length > 0) {
      // Keep indented continuations of lists together with the preceding block.
      const next = lines[i + 1]
      if (next !== undefined && /^(?:\s{2,}|\t|[-*+]\s|\d+[.)]\s)/.test(next)) {
        current.push(line)
        continue
      }
      blocks.push(current.join("\n"))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current.join("\n"))
  return blocks.length > 0 ? blocks : [markdown]
}

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  const plain = (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={urlTransform}>
      {source}
    </ReactMarkdown>
  )
  if (!import.meta.env.SSR && HAS_MATH_RE.test(source)) {
    return (
      <Suspense fallback={plain}>
        <MathMarkdownBlock source={source} components={COMPONENTS} urlTransform={urlTransform} />
      </Suspense>
    )
  }
  return plain
})

const textOf = (children: ReactNode): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : ""

const COMPONENTS: Components = {
  // Fenced code blocks get syntax highlighting, language badge, Copy, and Download.
  pre: ({ node: _node, children }) => {
    const child = Array.isArray(children) ? children[0] : children
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const match = /language-([^\s]+)/.exec(child.props.className ?? "")
      const raw = textOf(child.props.children).replace(/\n$/, "")
      return <CodeBlock code={raw} language={match?.[1]} />
    }
    return <pre>{children}</pre>
  },
  // Tables: words wrap whole (the reply's break-anywhere would shrink columns to one letter), and a table wider
  // than the chat scrolls sideways inside its own frame instead of squeezing.
  table: ({ node: _node, children }) => (
    <div className="scrollbar-thin not-prose my-3 max-w-full overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-left text-[13px] leading-relaxed [overflow-wrap:normal] [word-break:normal]">{children}</table>
    </div>
  ),
  thead: ({ node: _node, children }) => <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400">{children}</thead>,
  tr: ({ node: _node, children }) => <tr className="border-t border-zinc-800 first:border-t-0">{children}</tr>,
  th: ({ node: _node, children, style }) => (
    <th style={style} className="px-3 py-2 align-bottom font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ node: _node, children, style }) => (
    <td style={style} className="max-w-[28rem] min-w-[3rem] px-3 py-2 align-top text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-800/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]">
      {children}
    </td>
  ),
  a: ({ node: _node, href, children, ...props }) => {
    // Links to videos (YouTube, Vimeo, a video file, or one Dex stores) play inline.
    const source = typeof href === "string" ? videoSource(href) : null
    if (source) {
      const label = textOf(children)
      return <MediaPlayer source={source} title={label && label !== href ? label : undefined} />
    }
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  img: ({ node: _node, src, alt }) => {
    const url = typeof src === "string" ? src : ""
    const source = videoSource(url)
    if (source) return <MediaPlayer source={source} title={alt} />
    if (isInlineImage(url)) {
      return (
        <span className="not-prose relative my-2 inline-block max-w-full overflow-hidden rounded-xl">
          <img src={url} alt={alt ?? ""} className="block max-h-[70vh] max-w-full rounded-xl" />
          <span className="absolute top-2 right-2">
            <AssetDownloadLink url={url} title={alt || "image"} label="" compact />
          </span>
        </span>
      )
    }
    let host = "external site"
    try {
      host = new URL(url).host
    } catch {}
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 no-underline" title={url}>
        <ImageOff className="size-3.5" /> {alt || "Image"} ({host})
      </a>
    )
  }
}

/** Memoized per top-level block: while a long reply streams, only the final paragraph re-parses. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(children), [children])
  return (
    <div className="prose prose-invert prose-sm max-w-none [overflow-wrap:anywhere] prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-zinc-800/70 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:text-zinc-200 prose-a:text-emerald-400">
      {blocks.map((source, index) => (
        <MarkdownBlock key={index} source={source} />
      ))}
    </div>
  )
})
