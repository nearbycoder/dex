import { ImageOff } from "lucide-react"
import { memo, type ReactNode } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { MediaPlayer, videoSource } from "./media"

/** Images from other sites aren't loaded (the CSP blocks them too): their URLs could carry chat content out. */
const isInlineImage = (src: string) => src.startsWith("data:image/") || src.startsWith("blob:") || (src.startsWith("/") && !src.startsWith("//"))

const REMARK_PLUGINS = [remarkGfm]

const textOf = (children: ReactNode): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : ""

const COMPONENTS: Components = {
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
    <td style={style} className="max-w-[28rem] min-w-[4.5rem] px-3 py-2 align-top text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-800/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]">
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
    if (isInlineImage(url)) return <img src={url} alt={alt ?? ""} />
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

/** Memoized on its text: while a reply streams, only the block that changed is parsed again. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none [overflow-wrap:anywhere] prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-zinc-800/70 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:text-zinc-200 prose-a:text-emerald-400">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
