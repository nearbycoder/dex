# Working on Dex

Dex is a personal agent harness: a Durable Object agent (`src/agent/dex-agent.ts`) running Pi Durable, with a TanStack Start app on Cloudflare Workers. See README.md for the feature tour and architecture.

## Every feature is also an operation

Anything a user can do in the app must also be doable by a chat (its `app_operations` / `app_call` tools) and by an external agent over MCP (`/api/mcp`). Both are generated from one registry: `src/agent/operations.ts`.

When you add or change functionality:

1. Expose it as a `@callable()` on DexAgent as usual for the UI.
2. Add an operation to `OPERATIONS` in `src/agent/operations.ts` that `covers` the callable: a clear name (`app_<verb>_<thing>`), a description written for a model, a TypeBox `parameters` schema with limits, a `risk`, and a one-line `summarize`.
   - `read`: looks only. `write`: creates, starts, sends, stops, runs. `admin`: deletes, or changes what future chats see (settings, existing agents and projects, MCP servers). Chats must get the user's confirmation for `admin`; MCP tokens need admin scope.
   - Set `inChats: false` only when chats already have a native tool for it.
3. If it must not be exposed (credentials, access control, browser-only actions), add it to `EXCLUDED` with the reason instead.
4. Never return secrets from an operation (API keys, tokens, header values).

`npm run check:ops` fails if a callable is neither covered nor excluded, and `npm run deploy` runs it first.

## Security

- Every sign-in check goes through `activeViewer` (src/server/active-session.ts): cookie signature plus the agent's revocation time ("Sign out everywhere"). Use it for any new authenticated route; don't read the cookie directly.
- Anything lasting or destructive that a chat can trigger must be an `admin` operation (it then needs the user's confirmation). Persistence counts: recurring schedules, settings, agent and project edits, MCP servers.
- Keep the Content Security Policy in src/server.ts strict; add an origin only when a feature truly needs it.
- Worker → agent RPC: a Durable Object keeps running its old code until it restarts, so a method added in the same deploy may not exist yet on a live instance (calls throw). Callers must tolerate that (feature-detect, or ship the agent method a deploy before its caller); `activeViewer` fails closed, so don't rename `isSessionCurrent`.

## Deploys and stale agents

A busy agent (running VMs schedule an idle check every minute; open sockets and test scripts keep it warm) can keep serving the previous build for a long time after `npm run deploy`. Check `state.build` (the agent's build time, from `__DEX_BUILD__`) in the synced state before testing a change on production; if it's old, let the agent go idle (stop VMs, close sockets) and check again.

## Workflow

- `npm run typecheck`, then `npm run deploy` (checks operations, builds, deploys), then commit and push to main.
- Secrets live in Cloudflare secrets and the gitignored `.dev.vars` / `.prod.vars`; never commit or print them.
