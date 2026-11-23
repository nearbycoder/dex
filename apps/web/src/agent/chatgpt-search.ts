export interface SearchResult {
  url: string
  title: string
  description?: string
}

const INSTRUCTIONS =
  "You are a search engine. Search the web for the user's query and reply with only JSON, no prose and no code fence: " +
  '{"results":[{"title":"page title","url":"https://…","description":"one or two sentences from the page that answer the query"}]}. ' +
  "List the most relevant distinct pages first, each a page you found in this search, never a guessed URL."

/** OpenAI adds `utm_source=openai` to the links it cites; the model and the user don't need it. */
const cleanUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.searchParams.delete("utm_source")
    return url.toString()
  } catch {
    return null
  }
}

interface ResponseItem {
  type?: string
  action?: { sources?: Array<{ url?: string }> }
  content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }>
}

/**
 * The results in a finished response: the JSON list the model was asked for, else (it wrote prose) the pages it
 * cited, then the other pages the search returned. Duplicates and non-web links are dropped.
 */
export const readSearchResponse = (output: ReadonlyArray<ResponseItem>, limit: number): SearchResult[] => {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const add = (url: string | undefined, title: string | undefined, description?: string) => {
    const clean = url && cleanUrl(url)
    if (!clean || seen.has(clean) || results.length >= limit) return
    seen.add(clean)
    results.push({ url: clean, title: title?.trim() || clean, ...(description?.trim() ? { description: description.trim() } : {}) })
  }
  const parts = output.flatMap((item) => (item.type === "message" ? (item.content ?? []) : [])).filter((part) => part.type === "output_text")
  const text = parts.map((part) => part.text ?? "").join("\n")
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  try {
    const parsed = JSON.parse(json) as { results?: Array<{ url?: unknown; title?: unknown; description?: unknown }> }
    for (const result of parsed.results ?? []) {
      if (typeof result.url === "string") add(result.url, String(result.title ?? ""), typeof result.description === "string" ? result.description : undefined)
    }
  } catch {
    // Not the JSON asked for: the citations and sources below still give the pages.
  }
  for (const part of parts) {
    for (const annotation of part.annotations ?? []) if (annotation.type === "url_citation") add(annotation.url, annotation.title)
  }
  for (const item of output) {
    if (item.type === "web_search_call") for (const source of item.action?.sources ?? []) add(source.url, undefined)
  }
  return results
}

/** The finished response from a streamed Responses API call (`response.completed`), or what went wrong. */
const readStream = async (response: Response) => {
  const text = await response.text()
  let failure: string | null = null
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue
    let event: { type?: string; response?: { output?: ResponseItem[]; error?: { message?: string } }; message?: string }
    try {
      event = JSON.parse(line.slice(5))
    } catch {
      continue
    }
    if (event.type === "response.completed") return event.response?.output ?? []
    if (event.type === "response.failed") failure = event.response?.error?.message ?? "the search failed"
    if (event.type === "error") failure = event.message ?? "the search failed"
  }
  throw new Error(failure ?? "OpenAI's response ended early")
}

/**
 * Searches the web with OpenAI's web search tool on the user's ChatGPT plan (Sign in with ChatGPT's token, the way
 * chats on ChatGPT models run). Streamed, as pi-ai sends chats, with only the fields those tokens accept.
 */
export async function chatGPTSearch(
  api: { baseUrl: string; token: string; model: string },
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const { model, token } = api
  const input = [
    { role: "developer", content: `${INSTRUCTIONS} Give up to ${limit} results.` },
    { role: "user", content: query }
  ]
  const request = (body: Record<string, unknown>) =>
    fetch(`${api.baseUrl}/responses`, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true, store: false, tools: [{ type: "web_search" }], input, ...body })
    })
  const failure = async (response: Response) => {
    const body = await response.text().catch(() => "")
    let message = body.slice(0, 300)
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message
    } catch {}
    return `OpenAI answered ${response.status}${message ? `: ${message}` : ""}`
  }
  let response = await request({ reasoning: { effort: "low" }, tool_choice: "required", include: ["web_search_call.action.sources"] })
  // Sign in with ChatGPT tokens reject some request fields: a rejected one gets a second try with only the essentials.
  if (response.status === 400) {
    const first = await failure(response)
    response = await request({})
    if (!response.ok) throw new Error(`${first}; with only the essentials, ${await failure(response)}`)
  }
  if (!response.ok) throw new Error(await failure(response))
  const results = readSearchResponse(await readStream(response), limit)
  if (!results.length) throw new Error("ChatGPT's search found no pages")
  return results
}
