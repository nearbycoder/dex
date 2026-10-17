import { ImageOff } from "lucide-react"
import { memo } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/** Images from other sites aren't loaded (the CSP blocks them too): their URLs could carry chat content out. */
const isInlineImage = (src: string) => src.startsWith("data:image/") || src.startsWith("blob:") || (src.startsWith("/") && !src.startsWith("//"))

const REMARK_PLUGINS = [remarkGfm]

const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  img: ({ node: _node, src, alt }) => {
    const url = typeof src === "string" ? src : ""
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
