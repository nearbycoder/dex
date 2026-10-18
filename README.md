<img src="assets/icon.svg" width="64" height="64" alt="">

# Dex

A personal agent harness: [Pi Durable](https://developers.cloudflare.com/agents/harnesses/pi/) running in a Cloudflare Durable Object, thinking with open-weight models through [ClinePass](https://docs.cline.bot/getting-started/clinepass), and answering with generative UI from [OpenUI](https://www.openui.com/). Built with TanStack Start and Effect.

## What it does

- **Sign in** with GitHub (allowlisted logins), an owner password (`OWNER_PASSWORD`, until GitHub OAuth is set up), or a local dev login.
- **Connect ClinePass** by pasting a Cline API key. Dex verifies it with Cline, then stores it AES-GCM encrypted in your agent.
- **Custom agents**: presets with a name, icon, color, instructions, starter prompt, and default model and thinking level. Pick one on the Home Screen to start a chat with it; its instructions join the chat's system prompt (edits apply to existing chats). Agents can also preselect MCP servers. Starts with PR Author, PR Reviewer, Researcher, and Data Analyst.
- **MCP servers**: connect remote MCP servers (Streamable HTTP or SSE) with no auth, API-key or custom headers (encrypted at rest), or OAuth (dynamic client registration with PKCE; the Agents SDK stores and refreshes tokens). Each server becomes a Pi extension whose tools appear as `<server>__<tool>`. Each chat picks its servers in the composer, agents preselect theirs, and servers marked "On for new chats" attach to plain new chats. Connections restore themselves after evictions and deploys.
- **Chat** with any ClinePass model, with a per-chat model and thinking level. Responses stream live; runs survive restarts, evictions, and deploys. Each reply folds its thinking, tool calls, and in-between notes into one activity row that follows the current step live ("Running a command… npm test", rotating while the model thinks) with tool-call and thought counts and a timer, then reads "Worked for 1m 12s"; tap it to see every step. The answer and any UI cards stay in view.
- **A cloud VM per chat** ([boat.dev](https://boat.dev)): a full Ubuntu VM with root, Docker, Node, Bun, Python, Chrome and a desktop. A chat gets its own VM the first time the model calls a VM tool (plain questions never start one); project chats get theirs as soon as they start. Tools: `vm_exec` (output streams live), `vm_screenshot` (the agent sees the desktop; it clicks and types with `xdotool`), `vm_read_file` / `vm_write_file`, `vm_expose_port` (token-protected URLs), `vm_stop`. Each VM keeps its disk while stopped and is deleted with its chat (if boat.dev can't be reached then, Dex retries every 5 minutes until it's gone). Requests to boat.dev are retried twice when Cloudflare can't connect (521–523) or a gateway fails; running a command is only retried when it never reached boat. It stops itself after 5 idle minutes (configurable); commands, file and port actions, screenshots, your terminal, and having control of the desktop all count as activity, and boat's own auto-stop deadline is kept 15 minutes further out as a fallback. When boat refuses another running VM (the free trial allows 2), Dex stops the least recently used idle one and retries.
- **Inbox triage**: the chat list works like an inbox. Settle a chat when you're done for now (the ✓✓ button in its header, or its ⋯ menu) and it moves under a collapsed Settled group; snooze it (in an hour, this evening, tomorrow, this weekend, next week) and it waits under Snoozed, then comes back to the top at that time with a notification. Any new message in a chat (from you, a schedule, or another chat) brings it back to the inbox. Chats and external agents can settle and snooze too (`app_update_session`).
- **Navigation**: the sidebar shows chats, with one Settings entry (a hint when VMs run or something needs attention). Settings and every configuration page switch the sidebar to links (General, Notifications, Machines, Projects, Agents, MCP servers, Workspace, Usage, Access & API) with a back button to the last chat; on phones the drawer stays open while switching.
- **Machines**: a list of every chat's VM, each linking to its chat (status, chat, project, size, last use, setup state, quick Stop/Resume) and the VM defaults; each opens its own page to watch the live desktop and every command Dex runs as it happens, take control of the desktop, run your own commands, open ports, re-run setup, and stop the agent mid-run to take over.
- **Projects**: one or more repos (GitHub `owner/repo` or any https git URL, with optional branch and folder), a setup script, notes for the model, a starter prompt, and a VM size. Starting a chat on a project boots its VM right away, signs in to GitHub, clones every repo into `~/work`, and runs the setup script (detached, up to 30 minutes, logged to `~/work/.dex/setup.log`) before the model's VM tools proceed. The chat's system prompt tells the model where everything is and whether setup succeeded. Projects combine with agents (e.g. PR Author on a project).
- **GitHub**: Settings → GitHub → Connect with GitHub (OAuth, asks for repo and workflow access) or paste a fine-grained token for access limited to chosen repos. The token is verified and stored encrypted; every new VM signs the GitHub CLI and git in with it (`gh auth login`, `gh auth setup-git`, your noreply identity), so projects clone private repos and agents can push and open PRs. Disconnecting an OAuth connection revokes the token at GitHub. The same OAuth app enables Sign in with GitHub.
- **Tools**: `bash` (a simulated shell with grep, sed, jq, sqlite3, curl and more, over a persistent `/workspace`), `read_file` / `write_file` / `edit_file`, `web_search` / `web_fetch` (Workers AI), `render_ui` (OpenUI cards, tables, charts, forms), and `schedule_prompt` (one-off or cron).
- **Inline video**: videos play in the chat. A chat shares a video, audio file, or image it made on its VM with `share_media` (e.g. a screen recording made with ffmpeg): the VM uploads it straight to Dex with a single-use token, it's stored privately in R2 (`dex-media`), and it plays inline from `/api/media/…` for you only, with seeking (byte ranges, which Safari needs), after the VM stops, and is deleted with its chat. Links to YouTube, Vimeo, and direct video files render as players that load only when you tap play. Up to 95 MB per file (the Worker's request limit); larger videos should be compressed first.
- **Memory**: `/workspace/MEMORY.md` is injected into every chat's system prompt.
- **Workspace page**: browse and edit the agent's files, and run shell commands yourself.
- **Installable app**: add Dex to a phone or tablet Home Screen (Settings → Install Dex). It runs full screen and edge to edge with safe-area insets, keeps the composer above the keyboard, swipes the sidebar in from the left edge, and adapts from folded phones to tablets, with a collapsible sidebar (⌘/Ctrl+B) and a split across the hinge on dual-screen devices. A service worker caches static assets and shows an offline screen; it never caches pages or API calls.
- **Chats and external agents can run Dex**: every app capability is an operation in one registry (`src/agent/operations.ts`): start, message, read, stop, and delete chats; create and edit agents and projects; manage MCP servers, VMs, scheduled prompts, the workspace, notifications, and settings; read usage. Chats use them through two tools (`app_operations` lists them, `app_call` runs one), so asking a chat to "start a chat per repo and have each open a PR" just works. External agents connect over MCP at `/api/mcp` (Streamable HTTP) with a token from Settings → Access & API, where each token gets Read, Read & write, or Full access and an expiry. Admin operations (deleting anything, changing settings, editing existing agents or projects, MCP servers) need a Full token over MCP, and from a chat they show a Confirm button: nothing happens until you tap it, and your answer goes back to the chat. Every operation is validated, rate-limited, and listed in the Access page's activity log. `npm run check:ops` (run by `npm run deploy`) fails if a new callable isn't covered by an operation or explicitly excluded.
- **Push notifications** (opt in, per device): Settings → Notifications turns them on for this phone or browser and picks what to hear about: replies when a run finishes, errors, scheduled prompts, project machines finishing setup, and MCP servers that need you to sign in again. "Skip what I'm looking at" stays quiet for a chat that's open and visible on any device, each chat has a mute bell, and the app icon shows a badge until you open Dex. On Android and desktop, notifications carry quick actions (Open chat, Mute this chat, Watch machine, Sign in); "Mute" runs in the background through `/api/push/action` without opening Dex. iOS (16.4+) delivers them to the Home Screen app only and shows no buttons; tapping opens the right page. Sent as standard Web Push (RFC 8291 aes128gcm, VAPID), straight from the agent.
- **Snappy navigation**: pages render from the agent's synced state, so switching pages never waits on the network. Sign-in is checked once per launch (the agent socket checks the cookie on every connection), every page's code is fetched while the app is idle, and the last synced state is kept on the device so a launch shows your chats at once while the socket connects (signing out clears it). Recently opened chats and page data (usage, files, schedules, VM activity) reappear instantly and refresh in the background. Anything still loading shows a skeleton shaped like the page, including the server's first response on a cold launch.
- **Haptics**: a light tap when pressing buttons on phones (Settings → Haptic feedback, saved per device). iPhone uses [ios-haptics](https://github.com/tijnjh/ios-haptics), which plays the system haptic through a hidden `<input type="checkbox" switch>` (Safari has no Vibration API); only `type="button"` buttons get one, since it would swallow link navigation and form submits. Android uses `navigator.vibrate`.
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

1. Create a GitHub OAuth app (github.com/settings/applications/new) with homepage `https://<your-worker>` and callback `https://<your-worker>/auth/github` (sign-in and "Connect with GitHub" use paths under it).
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
npx wrangler secret put VAPID_PRIVATE_KEY     # optional: push notifications (a P-256 private JWK; its public key goes in VAPID_PUBLIC_KEY)
npm run deploy
```

The current deployment is https://dex.nearbycoder.workers.dev. Its secrets were uploaded from the gitignored `.prod.vars` (`npx wrangler deploy --secrets-file .prod.vars`).

## Security

- **Sign-in:** GitHub OAuth (allowlisted logins, state-checked) or the owner password (compared by HMAC, rate limited to 10 attempts a minute per IP, same-origin posts only). Dev login is off unless `DEV_LOGIN` is set.
- **Sessions:** signed, HttpOnly, SameSite=Lax, Secure cookies for 30 days. Settings → Sign out everywhere revokes every session on every device: the user's agent records the time, and every sign-in check (page loads, the agent socket, notification actions) rejects older sessions and closes open sockets. A revoked device clears its saved state.
- **Agent access:** each user's agent accepts WebSocket and HTTP requests only from the same origin, with a current session for that user. Cross-site WebSockets get neither the cookie (SameSite) nor past the origin check.
- **Secrets:** API keys, the GitHub token, and MCP header values are AES-GCM encrypted with a key derived from `AUTH_SECRET`. Nothing secret is synced to the browser (only key hints and header names).
- **Browser:** a strict Content Security Policy limits scripts and connections to Dex itself (`connect-src 'self'`, so even injected script couldn't send chat content elsewhere), images to Dex, GitHub avatars, and YouTube thumbnails (prompt-injected "image" URLs can't leak data), frames to boat.dev (the VM desktop) and the YouTube/Vimeo players, and forbids framing Dex. Video from other sites (`media-src https:`) loads only after you tap play, never from model output alone. Also `Cross-Origin-Opener-Policy: same-origin`, HSTS, `nosniff`, a strict referrer policy, and a Permissions-Policy without camera, microphone, or location. Model output is rendered without raw HTML; model-written links only open http(s) pages, with `noopener`.
- **Media:** shared files are served only to their owner (session cookie, keys prefixed per user), only for an allowlist of video, audio, and image types decided by the extension (never HTML, SVG, or PDF), sandboxed, with `nosniff`. VM uploads use single-use, HMAC-checked tokens that expire in 15 minutes; browsers can't use the upload endpoint.
- **MCP access tokens:** 256-bit secrets bound to their user by an HMAC (checked in the Worker before any agent wakes), stored only as SHA-256 hashes, scoped (read / write / full), expiring, revocable, and rate limited. Failed attempts count against the sign-in limit. The endpoint sends no CORS headers and refuses other sites' pages.
- **Prompt injection:** tools run without approval, so text from web pages and MCP servers can try to steer a chat. Anything lasting or destructive waits for you: deleting things, changing settings, editing existing agents or projects, adding MCP servers, and creating recurring schedules all show a Confirm card that only the signed-in app can answer. Chats started by chats go at most two levels deep and are rate limited; memory edits are shown in the chat, and memory is framed as notes, not instructions. Every app operation is in the Access page's activity log. Only you can make a VM port public; the agent gets token-protected URLs. Anything on a VM can use the GitHub token, so keep it fine-grained.
- **Dependencies:** `npm audit` reports no high or critical issues (undici is pinned to a patched 7.x); the remaining low and moderate advisories are in KaTeX (UI cards only) and the simulated shell's `printf`, with no upstream fixes yet.

## Limits

- Cline has no third-party OAuth, so users connect with an API key.
- The `/workspace` shell is simulated (just-bash) and can't install or run programs; real work happens on the boat.dev VM.
- boat.dev's free trial allows 2 running VMs at once and a 2-hour maximum auto-stop. Stopped VM disks are kept 14 days.
- The embedded desktop uses boat's stream mode. noVNC is available too but authenticates with a third-party cookie, so some browsers (Safari) only show it in a new tab.
- `web_search` needs Web Search billing enabled on the Cloudflare account; until then it reports `web_search_payment_required`.
- Pi Durable has no tool-approval step yet, and cannot delete conversations. Deleting a chat hides it.
- MCP connections are remote only (no stdio servers). Header values are encrypted in Dex's table, but the Agents SDK also keeps them, with OAuth tokens, in the agent's own storage so it can reconnect after an eviction. MCP tool calls run without approval, like every other tool.
