import "katex/dist/katex.min.css"
import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

/** Lazy-loaded math-capable Markdown block (only fetched when a message contains LaTeX `$...$` / `$$...$$`). */
export default memo(function MathMarkdownBlock({
  source,
  components,
  urlTransform
}: {
  source: string
  components: Components
  urlTransform: (url: string, key: string) => string
}) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components} urlTransform={urlTransform}>
      {source}
    </ReactMarkdown>
  )
})
