import { createFileRoute, Link } from "@tanstack/react-router"
import { MessageCircle, Pencil, Plus } from "lucide-react"
import { CharacterAvatar } from "~/client/components/agent-avatar"
import { InfoTip } from "~/client/components/info-tip"
import { ModelLogo } from "~/client/components/model-logo"
import { CardGridSkeleton } from "~/client/components/skeleton"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { findModel } from "~/shared/models"

export const Route = createFileRoute("/_app/sidekicks/")({ component: CharactersPage })

function CharactersPage() {
  const { state } = useDex()
  const characters = state?.characters ?? []
  const sessions = new Map((state?.sessions ?? []).map((session) => [session.id, session]))

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">Sidekicks</h1>
            <InfoTip label="About sidekicks">
              Companions with a name, a personality, and one long conversation of their own, pinned in the sidebar. They remember you, and keep every tool Dex has.
            </InfoTip>
          </div>
          <Link
            to="/sidekicks/$characterId"
            params={{ characterId: "new" }}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-4" /> New sidekick
          </Link>
        </div>
        {!state ? (
          <CardGridSkeleton kind="character" />
        ) : characters.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
            <p className="text-sm text-zinc-300">No sidekicks yet.</p>
            <p className="mt-1 text-sm text-zinc-500">Make a creative partner, a planner, a coach, or anyone you'd like to talk to.</p>
            <Link
              to="/sidekicks/$characterId"
              params={{ characterId: "new" }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <Plus className="size-4" /> Make one
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {characters.map((character, index) => {
              const session = sessions.get(character.sessionId)
              return (
                <li
                  key={character.id}
                  style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
                  className="flex animate-rise flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
                >
                  <div className="flex items-start gap-3">
                    <CharacterAvatar character={character} size={40} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-medium text-zinc-100">{character.name}</h2>
                      <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{character.tagline || "A sidekick"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <ModelLogo modelId={character.model} className="size-3.5" />
                      {findModel(character.model)?.name ?? character.model}
                    </span>
                    {session && <span>{session.updatedAt > session.createdAt + 1_000 ? `last talked ${timeAgo(session.updatedAt)}` : "new"}</span>}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Link
                      to="/chat/$sessionId"
                      params={{ sessionId: character.sessionId }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
                    >
                      <MessageCircle className="size-4" /> Talk
                    </Link>
                    <Link
                      to="/sidekicks/$characterId"
                      params={{ characterId: character.id }}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
