<p align="center">
  <img src="docs/media/title.png" alt="Dex: your personal AI agent, running on Cloudflare" width="100%">
</p>

<p align="center">
  <a href="docs/media/dex-promo.mp4"><img src="docs/media/dex-preview.gif" alt="Dex answering a request with a live chart card" width="100%"></a>
  <br>
  <sub><b><a href="docs/media/dex-promo.mp4">▶ Watch the 75-second tour</a></b> · generative UI, a cloud VM per chat, skills, MCP, and the phone app</sub>
</p>

**Dex** is a personal agent harness. Each user gets an agent in a Cloudflare Durable Object running [Pi Durable](https://developers.cloudflare.com/agents/harnesses/pi/), thinking with open-weight models through [ClinePass](https://docs.cline.bot/getting-started/clinepass), answering with generative UI from [OpenUI](https://www.openui.com/), and doing real work on its own cloud VM from [boat.dev](https://boat.dev). Built with TanStack Start, Effect, and the Cloudflare Agents SDK, and installable on your phone.

[Highlights](#highlights) · [Features](#features) · [Architecture](#architecture) · [Develop](#develop) · [Deploy](#deploy) · [Security](#security) · [Limits](#limits)

## Highlights

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/chat-chart.png" alt="A chat answering with a bar chart card"><br><b>Answers as live UI.</b> Cards, tables, charts, and forms, streamed as the model writes them.</td>
    <td width="50%"><img src="docs/screenshots/machine.png" alt="The Machine page with the VM's live desktop and activity log"><br><b>A cloud VM per chat.</b> Watch the desktop and every command live, or take over.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/skill-menu.png" alt="The slash menu listing installed skills and skills.sh results"><br><b>Skills on a keystroke.</b> Type <code>/</code> to use one, or install it from skills.sh in place.</td>
    <td width="50%"><img src="docs/screenshots/mcp-search.png" alt="MCP search with Dex's checks on a server"><br><b>Any MCP server, checked first.</b> Search, see its tools and sign-in, add it in a tap.</td>
  </tr>
</table>

## Features

### Chat that answers with UI

<img src="docs/screenshots/chat-vm.png" alt="A chat that used the VM, with its folded activity row and a table answer" width="100%">

- **Any ClinePass model**, with a per-chat model and thinking level. Replies stream live, and runs survive restarts, evictions, and deploys.
- **One activity row per reply** folds its thinking, tool calls, and in-between notes. While it works it shows what's really happening: the running tool and its arguments ("Running on the VM… npm test"), or the latest line of the model's thinking. Then it reads "Worked for 36s · 8 tools · 6 thoughts"; tap it to see every step. Screenshots in those steps load when you open them, so long VM chats stay light.
- **Generative UI** with `render_ui` (OpenUI): cards, stat tiles, tables, charts, and forms. Markdown tables wrap at word boundaries and scroll sideways in their own frame on a phone.
- **Tools:** `bash` over a persistent `/workspace` (a simulated shell with grep, sed, jq, sqlite3, curl), file tools, `web_search` / `web_fetch` (Workers AI), `schedule_prompt` (one-off or cron), and `use_skill`.
- **Memory:** `/workspace/MEMORY.md` joins every chat's system prompt; edits to it are always shown in the chat.
- **Pinned to the latest message:** chats open at the bottom and follow new content, and a round arrow jumps back down when you've scrolled up.

### A cloud VM for every chat

<img src="docs/screenshots/machine.png" alt="The Machine page" width="100%">

- A chat gets its own Ubuntu VM ([boat.dev](https://boat.dev): root, Docker, Node, Bun, Python, Chrome, and a desktop) the first time the model needs one. Plain questions never start one.
- **Tools:** `vm_exec` (output streams live), `vm_screenshot` (the agent sees the desktop and clicks and types with `xdotool`), `vm_read_file` / `vm_write_file`, `vm_expose_port` (token-protected URLs), `share_media`, `vm_stop`.
- **The Machine page** shows the live desktop and every command as it happens. Take control of the desktop, run your own commands, open ports, re-run setup, or stop the agent mid-run to take over.
- **Lifecycle:** a VM stops after 5 idle minutes (configurable) and keeps its disk. It's deleted with its chat, and Dex retries every 5 minutes if boat.dev can't be reached then. Requests retry when Cloudflare can't connect, and when boat refuses another running VM, Dex stops the least recently used idle one.
- **Your own boat.dev account:** everyone connects their own boat.dev key in Settings → Cloud VMs (checked, then stored encrypted). The deployment's `BOAT_API_KEY` serves only its owner.

### Skills

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/skills.png" alt="The Skills page searching skills.sh"></td>
    <td width="50%"><img src="docs/screenshots/skill-menu.png" alt="The slash menu in the composer"></td>
  </tr>
</table>

- Skills are instructions for particular tasks: a `SKILL.md` and the files beside it. Install them from [skills.sh](https://skills.sh), or write your own on the Skills page.
- **Typing `/` in any message** opens a quick lookup of your skills and skills.sh matches, which install in place. A message starting with `/<name>` adds that skill's instructions to the chat from then on.
- **Auto skills** are listed for every chat, which loads one with `use_skill` when a request matches.
- Installing reads the skill from its GitHub repo, using your GitHub connection for private repos and a higher rate limit. Text files only, up to 60 files and 1 MB. Expand a search result to read it before installing.

### MCP servers: remote, local, searched, and checked

<img src="docs/screenshots/mcp-search.png" alt="MCP search with checks" width="100%">

- **Remote servers** (Streamable HTTP or SSE) with no auth, headers (encrypted at rest), or OAuth (dynamic client registration with PKCE; the Agents SDK stores and refreshes tokens). Each server's tools appear as `<server>__<tool>`. Chats pick servers in the composer, agents preselect theirs, and servers marked "On for new chats" attach to plain new chats.
- **Search** [Smithery](https://smithery.ai) by default: it answers in well under a second, with use counts and verification, and its servers sign in through Smithery. Or search the official [MCP Registry](https://registry.modelcontextprotocol.io) for publishers' own endpoints and packages.
- **Checks before you add one:**
  - HTTPS.
  - The verified publisher, and whether the endpoint is on their domain.
  - A live MCP handshake (open, OAuth, or a required header) and its tool list.
  - Its GitHub repo: stars, license, archived, last push.

  "Add server" opens the editor prefilled.
- **Local (stdio) servers:** npm, PyPI, and Docker packages, or any command, run on a dedicated "MCP servers" VM. Each runs behind [supergateway](https://github.com/supercorp-ai/supergateway) (stdio to Streamable HTTP, one port each), and Dex connects to its private address like any remote server.
  - The VM starts when a chat calls one of the server's tools, tool calls keep it awake, and it stops when idle.
  - The MCP VM never gets your GitHub token or saved secrets. Each server gets only the environment variables it lists.

### Queue, edit, and steer follow-ups

- Messages you send while a chat is working wait in a collapsible panel above the message box.
- Open the panel to edit, reorder, or delete them, or **Steer** one into the current run after its current step.
- One message goes each time a run ends. Stopping a chat holds the queue until you send something.

### Inbox triage

<img src="docs/screenshots/mobile-sidebar.png" alt="The sidebar with Snoozed and Settled groups" width="320" align="right">

- The chat list works like an inbox. **Settle** a chat when you're done for now and it moves under a collapsed Settled group.
- **Snooze** a chat (in an hour, this evening, tomorrow, this weekend, next week) and it waits under Snoozed, then comes back to the top at that time with a notification.
- Any new message in a chat brings it back to the inbox.

<br clear="right">

### Secrets

<img src="docs/screenshots/secrets.png" alt="The Secrets page" width="100%">

- **Saved secrets** (Settings → Secrets) are API keys every chat's VM gets as environment variables. Enter them once, and the model uses `$NAME` without ever seeing the value.
- They're written to a private env file on each VM, loaded by every command, by login and interactive shells, and by project setup scripts. VMs pick up changes on their next command.
- **Password fields in chat forms** keep the value out of the transcript. The browser stores it, encrypted per chat, before sending, and the message carries `{{secret:name}}`. VM tools fill placeholders in on the VM, as environment variables from a file the command sources and deletes.
- Any secret value in VM output, read files, or the Machine page's log is masked before the model or you see it.

### Projects, GitHub, and agents

<img src="docs/screenshots/home.png" alt="The home screen with projects and agents" width="100%">

- **Projects:** one or more repos (with branch and folder), a setup script, notes for the model, a starter prompt, and a VM size.
  - The repo field searches every repo your GitHub connection can reach, private and org ones included, then public repos. The branch field suggests the repo's branches.
  - Starting a project chat boots its VM, signs in to GitHub, clones the repos into `~/work`, and runs the setup script before the model's VM tools go ahead.
- **GitHub:** Connect with GitHub (OAuth) or paste a fine-grained token. Every new VM signs the GitHub CLI and git in with it, so agents can push and open pull requests. Disconnecting an OAuth connection revokes the token at GitHub.
- **Custom agents:** presets with a name, icon, color, instructions, starter prompt, model, thinking level, and MCP servers. Dex starts with PR Author, PR Reviewer, Researcher, Data Analyst, and Changelog Writer, and agents combine with projects.

### Inline media

- Videos, audio, and images a chat makes on its VM play inline with `share_media`. Dex stores them privately in R2, with seeking (byte ranges, which Safari needs), and deletes them with their chat.
- Media is never played from a VM: when a reply links a file served from its VM's port, Dex copies it into the chat when the reply ends, or when you tap "Save to chat".
- YouTube, Vimeo, and direct video links render as players that load only when you tap play.

### On your phone

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/mobile-chart.png" alt="Dex on a phone showing a chart card"></td>
    <td width="50%"><img src="docs/media/everywhere.png" alt="Dex on phones"></td>
  </tr>
</table>

- **Install it** on a phone or tablet Home Screen. It runs full screen and edge to edge, keeps the composer above the keyboard, and opens the sidebar with a swipe from the left edge (never "back"). It adapts from folded phones to tablets.
- **Push notifications** (opt in, per device) for replies, errors, scheduled prompts, machine setup, MCP sign-ins, and snoozed chats coming back. A chat that's open on any device stays quiet, and each chat has a mute bell. Android and desktop notifications carry quick actions; iOS 16.4+ delivers them to the installed app.
- **Haptics** on every control you tap (buttons, links, menus, switches, tabs) and on swiping the sidebar. iPhone has no Vibration API, so Dex plays the system tap through a hidden `<input type="checkbox" switch>`; Android uses `navigator.vibrate`. Fields never zoom the page on focus.

### Chats and external agents can run Dex

- Every app capability is an operation in one registry (`src/agent/operations.ts`):
  - Chats, agents, projects, skills, MCP servers, VMs, schedules, the workspace, the queue, notifications, settings, and usage.
- **Chats** use them through `app_operations` / `app_call`, so "start a chat per repo and have each open a PR" just works.
- **External agents** connect over MCP at `/api/mcp` with a token from Settings → Access & API. Each token is Read, Read & write, or Full, and has an expiry.
- **Admin operations** (deleting things, settings, editing existing agents or projects, MCP servers, installing skills) need a Full token, or your tap on a Confirm card in the chat.
- Every operation is validated, rate-limited, and logged. `npm run check:ops` (run by `npm run deploy`) fails if a new callable isn't covered or explicitly excluded.

### Usage, speed, and the rest

<img src="docs/screenshots/usage.png" alt="The Usage page" width="100%">

- **Usage:** what Dex costs across ClinePass (tokens per model and chat, at list prices), boat.dev (VM time), and Cloudflare (from the Analytics API), with a daily chart.
- **Snappy navigation:** pages render from the agent's synced state, so switching pages never waits on the network.
  - Every page's code is fetched while idle, and the last state is kept on the device for instant launches.
  - Anything still loading shows a skeleton shaped like the page.
  - The agent batches and dedupes the updates it sends.
- **Always current:** after a deploy, the first page load restarts a long-running agent onto the new code.
- **Sign in** with GitHub (allowlisted logins), an owner password, or a local dev login. **Sign out everywhere** revokes every session on every device.

## Architecture

```
Browser (TanStack Start, React)
  │  HTTP: login, server functions          WebSocket: RPC, synced state, Pi event stream
  ▼                                          ▼
Worker (src/server.ts) ── auth check ──► DexAgent Durable Object, one per user (src/agent/dex-agent.ts)
  └─ TanStack Start handler                  ├─ PiHarness → Pi Durable (chats in the object's SQLite)
                                             ├─ ClinePass provider (openai-completions → api.cline.bot)
                                             ├─ tools + Workspace (SQLite-backed files, just-bash)
                                             ├─ VmManager → boat.dev VMs (one per chat, plus the MCP VM)
                                             ├─ MCP client (remote servers; local ones via supergateway)
                                             ├─ Skills, secrets, message queue, media (R2), push
                                             └─ Agents SDK schedules (scheduled prompts, queue checks)
```

- `src/server/`: Effect services for config, keys (HMAC session signing, AES-GCM), sessions, and GitHub OAuth.
- `src/agent/`: the Durable Object and its parts (operations, VMs, MCP and registry search, skills, secrets, queue, media, push, the ClinePass provider) and the tools.
- `src/shared/`: model catalog, wire protocol, and shared types.
- `src/client/`: the agent connection (`useAgent`), the Pi event reducer, and UI components.
- `src/routes/`: pages and auth endpoints.
- `docs/`: the screenshots and promo video in this README.

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # set AUTH_SECRET; DEV_LOGIN=true enables the dev login
npm run dev                      # http://localhost:5173
```

Workers AI (web search and fetch) runs remotely even in dev, so run `wrangler login` first. After changing `src/client/openui/library.tsx`, run `npm run openui:spec` to regenerate the component spec the agent learns from. See [AGENTS.md](AGENTS.md) for the conventions every change follows (operations, skeletons, security, deploys).

## Deploy

1. Create a GitHub OAuth app (github.com/settings/applications/new) with homepage `https://<your-worker>` and callback `https://<your-worker>/auth/github` (sign-in and "Connect with GitHub" use paths under it).
2. Set `ALLOWED_GITHUB_USERS` in `wrangler.jsonc` (the first login is the owner).
3. Add the secrets, then deploy:

```sh
npx wrangler secret put AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put CLINE_API_KEY         # optional shared key
npx wrangler secret put OWNER_PASSWORD        # optional: password sign-in as the owner
npx wrangler secret put BOAT_API_KEY          # optional: boat.dev key for the owner's VMs; everyone else connects their own
npx wrangler secret put CLOUDFLARE_API_TOKEN  # optional: Account Analytics: Read, for the Usage page
npx wrangler secret put VAPID_PRIVATE_KEY     # optional: push notifications (a P-256 private JWK; its public key goes in VAPID_PUBLIC_KEY)
npm run deploy
```

The current deployment is https://dex.nearbycoder.workers.dev.

## Security

- **Sign-in:**
  - GitHub OAuth, for allowlisted logins only and state-checked.
  - The owner password: compared by HMAC, limited to 10 attempts a minute per IP, same-origin posts only.
  - Dev login is off unless `DEV_LOGIN` is set.
- **Sessions:**
  - Signed, HttpOnly, SameSite=Lax, Secure cookies, valid for 30 days.
  - Sign out everywhere revokes every session; every sign-in check rejects older ones and closes their sockets.
  - Each user's agent accepts requests only from the same origin, with a current session for that user.
- **Stored secrets:** API keys, tokens, MCP headers and env values, and saved and chat secrets are AES-GCM encrypted. Nothing secret is synced to the browser or returned by an operation.
- **Secrets and the model:** the model only ever sees placeholders and names. Values reach VMs through files that commands source, and are masked in output.
  - Chat VMs get all saved secrets, so anything a chat installs there could read them.
  - The MCP VM, which runs third-party packages, gets no GitHub token and no saved secrets, only each server's listed variables.
- **Browser:** a strict Content Security Policy:
  - Scripts and connections only to Dex itself (`connect-src 'self'`).
  - Images only from Dex, GitHub avatars, and YouTube thumbnails.
  - Frames only from boat.dev and the YouTube/Vimeo players, and nothing may frame Dex.

  Also COOP same-origin, HSTS, `nosniff`, a strict referrer policy, and a minimal Permissions-Policy. Model output is rendered without raw HTML.
- **Media:** served only to its owner, for an allowlist of video, audio, and image types (never HTML, SVG, or PDF), sandboxed. VM uploads use single-use, HMAC-checked tokens.
- **MCP access tokens:**
  - 256-bit secrets bound to their user by an HMAC, checked before any agent wakes.
  - Stored only as SHA-256 hashes.
  - Scoped, expiring, revocable, and rate limited.
- **Prompt injection:** tools run without approval, so text from the web or an MCP server can try to steer a chat. Anything lasting or destructive waits for your Confirm:
  - Deleting things, settings, editing existing agents or projects, MCP servers, skills, and recurring schedules.
  - Chats started by chats go at most two levels deep.
  - Every operation is in the Access page's activity log.

  A tricked chat can still use a secret it has access to in a command, so give chats only the secrets they need.
- **Dependencies:** `npm audit` reports no high or critical issues. KaTeX is pinned to a patched 0.18; the remaining moderate advisory is `sprintf-js` in the simulated workspace shell, with no upstream fix yet.

## Limits

- Cline has no third-party OAuth, so users connect with an API key.
- The `/workspace` shell is simulated (just-bash) and can't install or run programs; real work happens on a VM.
- boat.dev's free trial allows 2 running VMs at once; stopped VM disks are kept 14 days.
- The embedded desktop uses boat's stream mode. noVNC needs a third-party cookie, so Safari opens it in a new tab.
- `web_search` needs Web Search billing on the Cloudflare account.
- Pi Durable has no tool-approval step yet and can't delete conversations, so deleting a chat hides it.
- The official MCP Registry can take many seconds for a search it hasn't cached; Smithery is the fast default.
