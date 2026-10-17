<img src="assets/icon.svg" width="64" height="64" alt="">

# Dex

A personal agent harness: [Pi Durable](https://developers.cloudflare.com/agents/harnesses/pi/) running in a Cloudflare Durable Object, thinking with open-weight models through [ClinePass](https://docs.cline.bot/getting-started/clinepass), and answering with generative UI from [OpenUI](https://www.openui.com/). Built with TanStack Start and Effect.

## What it does

- **Sign in** with GitHub (allowlisted logins), an owner password (`OWNER_PASSWORD`, until GitHub OAuth is set up), or a local dev login.
- **Connect ClinePass** by pasting a Cline API key. Dex verifies it with Cline, then stores it AES-GCM encrypted in your agent.
- **Chat** with any ClinePass model, with a per-chat model and thinking level. Responses stream live; runs survive restarts, evictions, and deploys.
- **Tools**: `bash` (a simulated shell with grep, sed, jq, sqlite3, curl and more, over a persistent `/workspace`), `read_file` / `write_file` / `edit_file`, `web_search` / `web_fetch` (Workers AI), `render_ui` (OpenUI cards, tables, charts, forms), and `schedule_prompt` (one-off or cron).
- **Memory**: `/workspace/MEMORY.md` is injected into every chat's system prompt.
- **Workspace page**: browse and edit the agent's files, and run shell commands yourself.

## Architecture

```
Browser (TanStack Start, React)
  │  HTTP: login, server functions          WebSocket: RPC, synced state, Pi event stream
  ▼                                          ▼
Worker (src/server.ts) ── auth check ──► DexAgent Durable Object, one per user (src/agent/dex-agent.ts)
  └─ TanStack Start handler                  ├─ PiHarness → Pi Durable (chats in the object's SQLite)
                                             ├─ ClinePass provider (openai-completions → api.cline.bot)
                                             ├─ tools + Workspace (SQLite-backed files, just-bash)
                                             └─ Agents SDK schedules (scheduled prompts)
```

- `src/server/`: Effect services for config, keys (HMAC session signing, AES-GCM), sessions, and GitHub OAuth.
- `src/agent/`: the Durable Object, the ClinePass provider and Effect key-verification client, the workspace, and the tools.
- `src/shared/`: model catalog, wire protocol, and the generated OpenUI spec.
- `src/client/`: the agent connection (`useAgent`), the Pi event reducer, and UI components.
- `src/routes/`: pages and auth endpoints.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # set AUTH_SECRET; DEV_LOGIN=true enables the dev login
npm run dev                      # http://localhost:5173
```

Workers AI (web search and fetch) runs remotely even in dev, so `wrangler login` first.

After changing `src/client/openui/library.tsx`, run `npm run openui:spec` to regenerate the component spec the agent learns from.

## Deploy

1. Create a GitHub OAuth app with callback `https://<your-worker>/auth/github/callback`.
2. Set `ALLOWED_GITHUB_USERS` in `wrangler.jsonc`.
3. Add the secrets, then deploy:

```sh
npx wrangler secret put AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put CLINE_API_KEY   # optional shared key
npx wrangler secret put OWNER_PASSWORD  # optional: password sign-in as the first allowlisted login
npm run deploy
```

The current deployment is https://dex.nearbycoder.workers.dev. Its secrets were uploaded from the gitignored `.prod.vars` (`npx wrangler deploy --secrets-file .prod.vars`).

## Limits

- Cline has no third-party OAuth, so users connect with an API key.
- The shell is simulated (just-bash): no package managers, compilers, Python, or Node. For a real Linux box, add [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) as an execution environment.
- `web_search` needs Web Search billing enabled on the Cloudflare account; until then it reports `web_search_payment_required`.
- Pi Durable has no tool-approval step yet, and cannot delete conversations. Deleting a chat hides it.
