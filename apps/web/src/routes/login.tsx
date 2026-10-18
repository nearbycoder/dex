import { createFileRoute, redirect } from "@tanstack/react-router"
import { KeyRound, Terminal } from "lucide-react"
import { getViewer } from "~/server/viewer"
import { GitHubMark } from "~/client/components/github-mark"

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { error?: string } => (typeof search.error === "string" ? { error: search.error } : {}),
  beforeLoad: async () => {
    const result = await getViewer()
    if (result.viewer) throw redirect({ to: "/chat" })
    return result
  },
  component: Login
})

function Login() {
  const { options } = Route.useRouteContext()
  const { error } = Route.useSearch()

  return (
    <main className="flex min-h-full items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-4 size-16 drop-shadow-[0_8px_24px_rgba(16,185,129,0.35)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Dex</h1>
          <p className="mt-2 text-sm text-zinc-400">Your durable agent, powered by Pi, ClinePass, and OpenCode Go.</p>
        </div>
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          {error && <p className="rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
          {options.github && (
            <a
              href="/auth/github/start"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              <GitHubMark /> Continue with GitHub
            </a>
          )}
          {options.password && (
            <form method="post" action="/auth/password" className="space-y-2">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
                <input
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  placeholder="Owner password"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-base focus:border-emerald-600 sm:text-sm focus:outline-none"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500">
                Sign in
              </button>
            </form>
          )}
          {options.devLogin && (
            <form method="post" action="/auth/dev">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                <Terminal className="size-4" /> Continue as local dev
              </button>
            </form>
          )}
          {!options.github && !options.devLogin && !options.password && (
            <p className="text-sm text-zinc-400">
              No sign-in method is configured. Set <code className="text-zinc-200">GITHUB_CLIENT_ID</code> and{" "}
              <code className="text-zinc-200">GITHUB_CLIENT_SECRET</code>, or <code className="text-zinc-200">DEV_LOGIN=true</code> for local
              development.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
