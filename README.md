<img src="assets/icon.svg" width="64" height="64" alt="">

# Dex

A personal agent harness: [Pi Durable](https://developers.cloudflare.com/agents/harnesses/pi/) running in a Cloudflare Durable Object, thinking with open-weight models through [ClinePass](https://docs.cline.bot/getting-started/clinepass), and answering with generative UI from [OpenUI](https://www.openui.com/). Built with TanStack Start and Effect.

## What it does

- **Sign in** with GitHub (allowlisted logins), an owner password (`OWNER_PASSWORD`, until GitHub OAuth is set up), or a local dev login.
- **Connect ClinePass** by pasting a Cline API key. Dex verifies it with Cline, then stores it AES-GCM encrypted in your agent.
- **Custom agents**: presets with a name, icon, color, instructions, starter prompt, and default model and thinking level. Pick one on the Home Screen to start a chat with it; its instructions join the chat's system prompt (edits apply to existing chats). Starts with PR Author, PR Reviewer, Researcher, and Data Analyst.
- **Chat** with any ClinePass model, with a per-chat model and thinking level. Responses stream live; runs survive restarts, evictions, and deploys.
- **Cloud VM** ([boat.dev](https://boat.dev)): each user's agent gets a full Ubuntu VM with root, Docker, Node, Bun, Python, Chrome and a desktop. Tools: `vm_exec` (output streams live), `vm_screenshot` (the agent sees the desktop; it clicks and types with `xdotool`), `vm_read_file` / `vm_write_file`, `vm_expose_port`, `vm_stop`. The VM starts on demand and keeps its disk. It stops itself after 5 idle minutes (configurable): commands, file and port actions, screenshots, your terminal, and having control of the desktop all count as activity. boat's own auto-stop deadline is kept 15 minutes further out as a fallback.
- **Machine page**: watch the VM's live desktop and every command Dex runs as it happens, take control of the desktop, run your own commands, open ports, and stop the agent mid-run to take over.
- **Tools**: `bash` (a simulated shell with grep, sed, jq, sqlite3, curl and more, over a persistent `/workspace`), `read_file` / `write_file` / `edit_file`, `web_search` / `web_fetch` (Workers AI), `render_ui` (OpenUI cards, tables, charts, forms), and `schedule_prompt` (one-off or cron).
- **Memory**: `/workspace/MEMORY.md` is injected into every chat's system prompt.
- **Workspace page**: browse and edit the agent's files, and run shell commands yourself.
- **Installable app**: add Dex to a phone or tablet Home Screen (Settings → Install Dex). It runs full screen and edge to edge with safe-area insets, keeps the composer above the keyboard, swipes the sidebar in from the left edge, and adapts from folded phones to tablets, with a collapsible sidebar (⌘/Ctrl+B) and a split across the hinge on dual-screen devices. A service worker caches static assets and shows an offline screen; it never caches pages or API calls.
- **Usage page**: what Dex costs across ClinePass (tokens per model and chat, at API list prices), boat.dev (VM run time × hourly rate), and Cloudflare (Workers, Durable Objects, and Workers AI from the Analytics API, against the plan's allowance), with a daily chart.

## Architecture

```
Browser (TanStack Start, React)
  │  HTTP: login, server functions          WebSocket: RPC, synced state, Pi event stream
  ▼                                          ▼
Worker (src/server.ts) ── auth check ──► DexAgent Durable Object, one per user (src/agent/dex-agent.ts)
  └─ TanStack Start handler                  ├─ PiHarness → Pi Durable (chats in the object's SQLite)
                                             ├─ ClinePass provider (openai-completions → api.cline.bot)
                                             ├─ tools + Workspace (SQLite-backed files, just-bash)
                                             ├─ VmManager → boat.dev VM (commands, files, ports, desktop)
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
npx wrangler secret put BOAT_API_KEY    # optional: boat.dev key for the agent's cloud VM
npx wrangler secret put CLOUDFLARE_API_TOKEN  # optional: Account Analytics: Read, for the Usage page
npm run deploy
```

The current deployment is https://dex.nearbycoder.workers.dev. Its secrets were uploaded from the gitignored `.prod.vars` (`npx wrangler deploy --secrets-file .prod.vars`).

## Limits

- Cline has no third-party OAuth, so users connect with an API key.
- The `/workspace` shell is simulated (just-bash) and can't install or run programs; real work happens on the boat.dev VM.
- boat.dev's free trial allows 2 running VMs at once and a 2-hour maximum auto-stop. Stopped VM disks are kept 14 days.
- The embedded desktop uses boat's stream mode. noVNC is available too but authenticates with a third-party cookie, so some browsers (Safari) only show it in a new tab.
- `web_search` needs Web Search billing enabled on the Cloudflare account; until then it reports `web_search_payment_required`.
- Pi Durable has no tool-approval step yet, and cannot delete conversations. Deleting a chat hides it.
