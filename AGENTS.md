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

## Workflow

- `npm run typecheck`, then `npm run deploy` (checks operations, builds, deploys), then commit and push to main.
- Secrets live in Cloudflare secrets and the gitignored `.dev.vars` / `.prod.vars`; never commit or print them.
