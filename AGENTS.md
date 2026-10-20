# Working on Dex

Dex is a personal agent harness: a Durable Object agent (`apps/web/src/agent/dex-agent.ts`) running Pi Durable, with a TanStack Start app on Cloudflare Workers. See README.md for the feature tour and architecture.

## Repository layout

A monorepo. Each app lives in `apps/<name>` with its own build and deploy, and none depends on another's deploy:

- `apps/web`: the web app, the Worker, and the agent. Its own `package.json` (`@dex/web`), `wrangler.jsonc`, and `npm run deploy`. Paths below are relative to it unless they start with `apps/`.
- `apps/ios` (Swift/SwiftUI, XcodeGen; see apps/ios/README.md), `apps/android` (planned): native apps with their own tooling (Xcode, Gradle) and release process. They talk to the same agent over its WebSocket and HTTP API; keep the wire protocol (`apps/web/src/shared/protocol.ts`) backward compatible, and move it to `packages/` once a second app needs it.
- `packages/*` (none yet): code shared between apps, as npm workspaces.
- Root: the npm workspace (`package.json`, one lockfile; `overrides` must live here), README, LICENSE, `docs/` (README media), `assets/` (brand).

Run commands from the root: `npm run dev`, `npm run typecheck`, `npm run check:ops`, and `npm run deploy` forward to `@dex/web` (or `npm run <script> -w @dex/web`). A new JavaScript app joins by adding its folder to the root `workspaces` and gets its own `deploy:<name>` script at the root.

## Every feature is also an operation

Anything a user can do in the app must also be doable by a chat (its `app_operations` / `app_call` tools) and by an external agent over MCP (`/api/mcp`). Both are generated from one registry: `apps/web/src/agent/operations.ts`.

When you add or change functionality:

1. Expose it as a `@callable()` on DexAgent as usual for the UI.
2. Add an operation to `OPERATIONS` in `src/agent/operations.ts` (in `apps/web`) that `covers` the callable: a clear name (`app_<verb>_<thing>`), a description written for a model, a TypeBox `parameters` schema with limits, a `risk`, and a one-line `summarize`.
   - `read`: looks only. `write`: creates, starts, sends, stops, runs. `admin`: deletes, or changes what future chats see (settings, existing agents and projects, MCP servers). Chats must get the user's confirmation for `admin`; MCP tokens need admin scope.
   - Set `inChats: false` only when chats already have a native tool for it.
3. If it must not be exposed (credentials, access control, browser-only actions), add it to `EXCLUDED` with the reason instead.
4. Never return secrets from an operation (API keys, tokens, header values).

`npm run check:ops` fails if a callable is neither covered nor excluded, and `npm run deploy` runs it first.

## Security

- Every sign-in check goes through `activeViewer` (src/server/active-session.ts): cookie signature plus the agent's revocation time ("Sign out everywhere"). Use it for any new authenticated route; don't read the cookie directly.
- Native apps sign in with the PKCE handoff in src/server/native-auth.ts (`/auth/native/start`, `finish`, `token`, `refresh`) and then send the ordinary session token as `Cookie: dex_session=…` with no `Origin`, so every route that uses `activeViewer` works for them unchanged. Keep new authenticated routes usable that way: don't require an `Origin` header except on form posts from Dex's own pages.
- Anything lasting or destructive that a chat can trigger must be an `admin` operation (it then needs the user's confirmation). Persistence counts: recurring schedules, settings, agent and project edits, MCP servers.
- Keep the Content Security Policy in src/server.ts strict; add an origin only when a feature truly needs it.
- Worker → agent RPC: a Durable Object keeps running its old code until it restarts, so a method added in the same deploy may not exist yet on a live instance (calls throw). Callers must tolerate that (feature-detect, or ship the agent method a deploy before its caller); `activeViewer` fails closed, so don't rename `isSessionCurrent`.

## Skeletons

Each page has a skeleton in src/client/components/skeleton.tsx built from that page's real spacing and line heights (bones sit in line boxes: `LineBone`), shown while state or page data loads, during slow page loads (`CurrentRouteSkeleton`), and on a cold launch (`ShellSkeleton`, by route). When you change a page's layout, update its skeleton. To compare them in development, run `sessionStorage.setItem("dex-skeleton", "1")` in the browser and reload: the app then behaves as if nothing has loaded.

## VM desktop stream

The Machine page's Selkies mode is served by Dex: `src/server/vm-desktop.ts` serves the page at `/vm-desktop/<vm key>/` and relays its WebSocket to the VM, adding boat's port cookie and Selkies' password (`DexAgent.vmDesktopUpstream`, Worker-only, never a callable). The web client in `public/assets/selkies` must match `SELKIES_VERSION` in `src/agent/selkies.ts`: when you upgrade, replace the client with the new release's `selkies_web/assets`, update the file names in `vm-desktop.ts`, and bump `TEMPLATE_REVISION` in `src/agent/vm-template.ts` so new VMs come from a fresh template. Bump it too whenever `SELKIES_BAKE` changes.

## Deploys and stale agents

A busy agent (open apps ping it every 20s, running VMs schedule an idle check every minute) can stay in memory on the build it started with long after `npm run deploy`, so callables added since don't exist on it ("Method X does not exist"). The Worker always runs the newest build and passes `__DEX_BUILD__` to `isSessionCurrent` on every sign-in check; an agent whose own build is older resets itself (`restartIfOutdated`) and the next request starts it on the new code. So a page load after a deploy brings the agent up to date. Check `state.build` in the synced state if in doubt. Keep that argument and that check working: they're how every later fix reaches a busy agent.

## Workflow

- From the root: `npm run typecheck`, then `npm run deploy` (checks operations, builds, deploys `apps/web`), then commit and push to main.
- Secrets live in Cloudflare secrets and the gitignored `apps/web/.dev.vars` / `.prod.vars`; never commit or print them.
- Per-deployment settings (the sign-in allowlist, the Cloudflare account ID, the VAPID public key) live in the gitignored `apps/web/.deploy.vars`, which `scripts/deploy.mjs` passes to Wrangler as `--var`s. Keep `wrangler.jsonc` generic (empty placeholders) so anyone can deploy their own Dex from this repo.
