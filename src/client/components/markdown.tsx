import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none [overflow-wrap:anywhere] prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-code:before:content-none prose-code:after:content-none prose-a:text-emerald-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
