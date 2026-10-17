import type { McpAuth } from "./mcp"

/** Well-known remote MCP servers, for one-tap setup on the MCP page. */
export const MCP_TEMPLATES: ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly url: string
  readonly auth: McpAuth
  readonly note: string
  /** For header auth: the header to fill in. */
  readonly header?: { readonly name: string; readonly placeholder: string }
}> = [
  { id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", auth: "none", note: "Docs and Q&A for public GitHub repos. No sign-in." },
  { id: "cloudflare-docs", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none", note: "Search Cloudflare's documentation. No sign-in." },
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "headers",
    note: "Repos, issues, and PRs, with a personal access token.",
    header: { name: "Authorization", placeholder: "Bearer github_pat_…" }
  },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", note: "Issues and projects. Sign in with Linear." },
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", note: "Pages and databases. Sign in with Notion." },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth", note: "Errors and performance. Sign in with Sentry." }
]
