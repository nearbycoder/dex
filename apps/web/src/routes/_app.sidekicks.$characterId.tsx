import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, LoaderCircle, MessageCircle, Plug, RotateCcw, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CharacterAvatar } from "~/client/components/agent-avatar"
import { SidekickLookPicker } from "~/client/components/sidekick-look-picker"
import { dataUrlBlob, lookPng, shrinkPicture } from "~/client/lib/sidekick-art"
import { randomLook } from "~/shared/sidekick-look"
import { InfoTip } from "~/client/components/info-tip"
import { McpStatusDot } from "~/client/components/mcp-picker"
import { ModelPicker } from "~/client/components/model-picker"
import { EditorSkeleton } from "~/client/components/skeleton"
import { useDex } from "~/client/lib/dex"
import { timeAgo } from "~/client/lib/format"
import { AGENT_COLORS } from "~/shared/agents"
import { CHARACTER_TEMPLATES, type CharacterDraft, characterMemoryPath, NOTIFY_LABELS, NOTIFY_LEVELS } from "~/shared/characters"
import { DEFAULT_MODEL_ID, DEFAULT_THINKING } from "~/shared/models"

export const Route = createFileRoute("/_app/sidekicks/$characterId")({ component: CharacterEditorPage })

const blank = (model: string, thinking: CharacterDraft["thinking"]): CharacterDraft => ({
  name: "",
  tagline: "",
  persona: "",
  instructions: "",
  greeting: "",
  avatar: "",
  look: randomLook(),
  image: null,
  color: "violet",
  model,
  thinking,
  mcpServers: []
})


const field = "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none md:text-sm"

function Field({ label, hint, children, as = "label" }: { label: string; hint?: string; children: ReactNode; as?: "label" | "div" }) {
  const Tag = as
  return (
    <Tag className="block">
      <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      <div className="mt-2">{children}</div>
    </Tag>
  )
}

/** Keyed by id: moving from one character (or “new”) to another starts a fresh draft instead of keeping the last one. */
function CharacterEditorPage() {
  const { characterId } = Route.useParams()
  return <CharacterEditor key={characterId} />
}

function CharacterEditor() {
  const { characterId } = Route.useParams()
  const { state, stub } = useDex()
  const navigate = useNavigate()
  const isNew = characterId === "new"
  const existing = state?.characters.find((character) => character.id === characterId)
  const [draft, setDraft] = useState<CharacterDraft | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pictureInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draft || !state) return
    if (isNew) setDraft(blank(state.settings.defaultModel ?? DEFAULT_MODEL_ID, state.settings.defaultThinking ?? DEFAULT_THINKING))
    else if (existing) setDraft({ ...existing })
  }, [state, existing, isNew, draft])

  if (!state) return <EditorSkeleton kind="character" />
  if (!isNew && !existing) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        This sidekick no longer exists.{" "}
        <Link to="/sidekicks" className="text-emerald-400 hover:underline">
          Back to sidekicks
        </Link>
      </div>
    )
  }
  if (!draft) return null

  const update = (patch: Partial<CharacterDraft>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // The apps show a picture rather than drawing looks: send one along.
      const image = draft.look ? await lookPng(draft.look, AGENT_COLORS[draft.color][0]) : draft.image
      const result = await stub.saveCharacter({ ...draft, image })
      setDraft({ ...result })
      setSaved(true)
      // A new character: straight to saying hi.
      if (isNew) await navigate({ to: "/chat/$sessionId", params: { sessionId: result.sessionId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const pickPicture = async (file: File | undefined) => {
    if (!file) return
    try {
      // A photo instead of a look.
      update({ image: await shrinkPicture(file), look: null, avatar: "" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read that picture.")
    }
  }

  const conversations = existing ? state.sessions.filter((session) => session.characterId === existing.id).toSorted((a, b) => b.createdAt - a.createdAt) : []

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-10">
        <Link to="/sidekicks" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Sidekicks
        </Link>

        <div className="mb-6 flex items-center gap-4">
          <CharacterAvatar character={{ ...draft, name: draft.name || "?", image: draft.image ?? null }} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{draft.name || (isNew ? "New sidekick" : "Untitled")}</h1>
            <p className="truncate text-sm text-zinc-400">{draft.tagline || "Who are they to you?"}</p>
          </div>
        </div>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {isNew && (
            <Field as="div" label="Start from" hint="Fills in everything below; change any of it.">
              <div className="flex flex-wrap gap-2">
                {CHARACTER_TEMPLATES.map(({ key, ...preset }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={template === key}
                    onClick={() => {
                      setTemplate(key)
                      update({ ...preset, image: null })
                    }}
                    className={`flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm ${
                      template === key ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                    }`}
                  >
                    <CharacterAvatar character={{ ...preset, image: null }} size={24} />
                    {preset.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={template === "blank"}
                  onClick={() => {
                    setTemplate("blank")
                    setDraft(blank(draft.model, draft.thinking))
                  }}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    template === "blank" ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                  }`}
                >
                  Blank
                </button>
              </div>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Muse" maxLength={40} className={field} required />
            </Field>
            <Field label="Tagline" hint="One line under their name in the sidebar.">
              <input
                value={draft.tagline}
                onChange={(event) => update({ tagline: event.target.value })}
                placeholder="Your creative sparring partner"
                maxLength={120}
                className={field}
              />
            </Field>
          </div>

          <Field as="div" label="Look" hint="Pick a ready-made sidekick or make your own; Shuffle rolls a new one.">
            <input ref={pictureInput} type="file" accept="image/*" className="hidden" onChange={(event) => void pickPicture(event.target.files?.[0])} />
            <SidekickLookPicker
              look={draft.look ?? null}
              color={draft.color}
              hasPhoto={Boolean(draft.image)}
              onChange={(patch) => update({ ...patch, avatar: "" })}
              onPhoto={() => pictureInput.current?.click()}
              canGenerate={state.chatgpt?.connected ?? false}
              generate={async (prompt, style) => {
                const description = prompt || [draft.name, draft.tagline, draft.persona.slice(0, 600)].filter(Boolean).join(". ")
                const picture = await stub.generateSidekickPicture({ prompt: description, style, color: draft.color })
                return shrinkPicture(dataUrlBlob(picture.dataUrl))
              }}
              onPicture={(image) => update({ image, look: null, avatar: "" })}
            />
          </Field>

          <Field label="Character profile" hint="Who they are: personality, voice, backstory, how they talk to you. They become this instead of Dex.">
            <textarea
              value={draft.persona}
              onChange={(event) => update({ persona: event.target.value })}
              rows={6}
              placeholder="Playful and curious, an artist friend who gets excited about half-formed ideas…"
              className={`${field} leading-relaxed`}
            />
          </Field>

          <Field label="Prompt" hint="What they do for you, and any rules. Edits apply to the conversation right away.">
            <textarea
              value={draft.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              rows={7}
              placeholder="Help me brainstorm and make small prototypes. Remember the projects we've worked on…"
              className={`${field} leading-relaxed`}
            />
          </Field>

          <Field label="Greeting" hint="Their first words, at the top of the conversation.">
            <textarea
              value={draft.greeting}
              onChange={(event) => update({ greeting: event.target.value })}
              rows={2}
              placeholder="Hey you. What are we making today?"
              maxLength={2_000}
              className={field}
            />
          </Field>

          <Field as="div" label="Notifications" hint="Which of their messages notify you on the devices you turned notifications on for.">
            <div className="grid gap-2 sm:grid-cols-3">
              {NOTIFY_LEVELS.map((level) => {
                const selected = (draft.notify ?? "all") === level
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update({ notify: level })}
                    className={`rounded-lg border px-3 py-2 text-left ${
                      selected ? "border-emerald-600/70 bg-emerald-950/40" : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <span className={`block text-sm ${selected ? "text-emerald-100" : "text-zinc-200"}`}>{NOTIFY_LABELS[level].label}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">{NOTIFY_LABELS[level].description}</span>
                  </button>
                )
              })}
            </div>
            {state.push.devices.length === 0 && (
              <p className="mt-2 text-xs text-amber-300/90">
                No device gets notifications yet.{" "}
                <Link to="/notifications" className="underline">
                  Turn them on
                </Link>{" "}
                on this one, or open the iPhone or Android app and allow them.
              </p>
            )}
          </Field>

          <Field as="div" label="Model and thinking" hint="Changing them moves the conversation to the new model.">
            <ModelPicker model={draft.model} thinking={draft.thinking} onChange={(value) => update(value)} />
          </Field>

          {state.mcp.length > 0 && (
            <Field as="div" label="MCP servers" hint="Tools from these servers are always on in their conversation.">
              <div className="flex flex-wrap gap-2">
                {state.mcp.map((server) => {
                  const selected = draft.mcpServers?.includes(server.id) ?? false
                  return (
                    <button
                      key={server.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        update({ mcpServers: selected ? (draft.mcpServers ?? []).filter((id) => id !== server.id) : [...(draft.mcpServers ?? []), server.id] })
                      }
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                        selected ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {selected ? <Check className="size-3.5" /> : <Plug className="size-3.5" />}
                      {server.name}
                      <McpStatusDot status={server.status} />
                    </button>
                  )
                })}
              </div>
            </Field>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              {isNew ? "Create and say hi" : saved ? "Saved" : "Save"}
            </button>
            {existing && (
              <>
                <Link
                  to="/chat/$sessionId"
                  params={{ sessionId: existing.sessionId }}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <MessageCircle className="size-4" /> Talk
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Delete ${existing.name}? Your conversations with them stay, as ordinary chats.`)) return
                    await stub.deleteCharacter(existing.id)
                    await navigate({ to: "/sidekicks" })
                  }}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-red-400"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </>
            )}
          </div>
        </form>

        {existing && <CharacterMemory key={existing.id} id={existing.id} name={existing.name} />}

        {existing && (
          <section className="mt-8">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-zinc-200">Conversations</h2>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Start a new conversation with ${existing.name}? They keep their memory, and the current one stays here.`)) return
                  const next = await stub.restartCharacter(existing.id)
                  await navigate({ to: "/chat/$sessionId", params: { sessionId: next.sessionId } })
                }}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <RotateCcw className="size-3.5" /> Start over
              </button>
            </div>
            <ul className="mt-2 divide-y divide-zinc-900 rounded-xl border border-zinc-800">
              {conversations.map((session) => (
                <li key={session.id}>
                  <Link to="/chat/$sessionId" params={{ sessionId: session.id }} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-zinc-900/60">
                    <span className="text-zinc-200">
                      {session.id === existing.sessionId ? "Current" : `Started ${new Date(session.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">{session.updatedAt > session.createdAt + 1_000 ? timeAgo(session.updatedAt) : "nothing yet"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

/** Their own notes about you: they read these every turn and keep them up to date; you can edit them too. */
function CharacterMemory({ id, name }: { id: string; name: string }) {
  const { stub } = useDex()
  const [text, setText] = useState<string | null>(null)
  const [loaded, setLoaded] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    stub
      .characterMemory(id)
      .then((memory) => {
        if (!current) return
        setText(memory)
        setLoaded(memory)
      })
      .catch(() => current && setText(""))
    return () => {
      current = false
    }
  }, [stub, id])

  const save = async () => {
    if (text === null) return
    setSaving(true)
    setError(null)
    try {
      await stub.saveCharacterMemory(id, text)
      setLoaded(text)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium text-zinc-200">Memory</h2>
        <InfoTip>{`${name} reads this every turn and keeps it up to date as they get to know you. It lives at ${characterMemoryPath(id)}.`}</InfoTip>
      </div>
      {text === null ? (
        <div className="mt-2 h-32 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/40" />
      ) : (
        <>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(16, Math.max(5, text.split("\n").length + 1))}
            placeholder={`Empty so far. ${name} writes here as they get to know you.`}
            className={`${field} mt-2 font-mono text-[13px] leading-relaxed md:text-xs`}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || text === loaded}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-600"
            >
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              {text === loaded ? "Memory saved" : "Save memory"}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </>
      )}
    </section>
  )
}
