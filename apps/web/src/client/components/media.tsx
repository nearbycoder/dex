import { AlertTriangle, ExternalLink, Film, Loader2, Play, Save } from "lucide-react"
import { createContext, useContext, useState } from "react"
import { type ChatArtifact, MEDIA_PREFIX, type MediaKind, mediaTypeOf, vmMediaSource } from "~/shared/media"

/**
 * Inline playback for media in chats. Media Dex stores (shared or saved from a VM) plays straight away; anything from
 * another site loads only when you tap play, so a model-written URL never fetches anything (or leaks anything in
 * its query string) on its own. Links to a chat VM's port are never played from the VM: Dex saves the file into
 * the chat and plays that copy.
 */

export type VideoSource =
  | { readonly kind: "own"; readonly url: string; readonly media: MediaKind }
  | { readonly kind: "vm"; readonly url: string; readonly media: MediaKind }
  | { readonly kind: "file"; readonly url: string }
  | { readonly kind: "youtube"; readonly id: string; readonly url: string }
  | { readonly kind: "vimeo"; readonly id: string; readonly url: string }

const DIRECT_VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i

/** The current chat's stored files by the VM link they were saved from, and a way to save one (set by the chat page). */
export interface ChatArtifacts {
  readonly bySource: ReadonlyMap<string, ChatArtifact>
  readonly saving: ReadonlySet<string>
  readonly save: (url: string) => Promise<unknown>
}

export const ChatArtifactsContext = createContext<ChatArtifacts | null>(null)

const fileName = (url: string) => {
  try {
    return decodeURIComponent(new URL(url, "https://dex.invalid").pathname.split("/").pop() ?? "") || "the file"
  } catch {
    return "the file"
  }
}

const frame = "my-2 block w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-black"
const card = "my-2 block w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 not-prose"

/** Media Dex stores: plays (or shows) right away. */
function StoredMedia({ url, media, title }: { url: string; media: MediaKind; title?: string }) {
  if (media === "image") return <img src={url} alt={title ?? ""} className="my-2 max-h-[70vh] rounded-xl" />
  if (media === "audio") return <audio controls preload="metadata" src={url} className="my-2 block w-full max-w-xl" />
  return <video controls playsInline preload="metadata" src={url} className={`${frame} max-h-[70vh]`} aria-label={title?.trim() || "Video"} />
}

/**
 * A file linked from the chat's VM. Once saved into the chat (automatically when the reply ends, or with "Save to
 * chat") it plays from Dex; until then, this card.
 */
function VmMedia({ url, media, title }: { url: string; media: MediaKind; title?: string }) {
  const artifacts = useContext(ChatArtifactsContext)
  const source = vmMediaSource(url)?.source
  const saved = source ? artifacts?.bySource.get(source) : undefined
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (saved) return <StoredMedia url={saved.url} media={saved.kind} title={title ?? saved.name} />

  const saving = requested || (source !== undefined && (artifacts?.saving.has(source) ?? false))
  const name = fileName(url)
  return (
    <span className={card}>
      <span className="flex items-start gap-2 text-sm text-zinc-200">
        {saving ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-zinc-400" />
        ) : error ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        ) : (
          <Film className="mt-0.5 size-4 shrink-0 text-zinc-500" />
        )}
        <span className="min-w-0">
          <span className="block truncate">{title?.trim() || name}</span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            {saving
              ? "Saving to the chat…"
              : error
                ? error
                : `On the chat's VM. Save it to the chat to ${media === "image" ? "see" : "play"} it here.`}
          </span>
        </span>
      </span>
      {!saving && (
        <span className="mt-2 flex flex-wrap gap-2 pl-6">
          {artifacts && (
            <button
              type="button"
              onClick={() => {
                setRequested(true)
                setError(null)
                artifacts
                  .save(url)
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
                  .finally(() => setRequested(false))
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
            >
              <Save className="size-3.5" /> {error ? "Try again" : "Save to chat"}
            </button>
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-zinc-400 no-underline hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ExternalLink className="size-3.5" /> Open
          </a>
        </span>
      )}
    </span>
  )
}

/** A video from another site that wouldn't load. */
function PlaybackFailed({ url }: { url: string }) {
  return (
    <span className={card}>
      <span className="flex items-start gap-2 text-sm text-zinc-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <span>
          Couldn't play {fileName(url)}.<span className="mt-0.5 block text-xs text-zinc-500">The site may not allow streaming it here.</span>
        </span>
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 ml-6 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-zinc-400 no-underline hover:bg-zinc-800 hover:text-zinc-100"
      >
        <ExternalLink className="size-3.5" /> Open
      </a>
    </span>
  )
}

/** What kind of playable media a URL is, if any. */
export function videoSource(raw: string): VideoSource | null {
  if (raw.startsWith(MEDIA_PREFIX)) {
    const media = mediaTypeOf(raw)
    return media ? { kind: "own", url: raw, media: media.kind } : null
  }
  if (vmMediaSource(raw)) {
    const media = mediaTypeOf(new URL(raw).pathname)
    return media ? { kind: "vm", url: raw, media: media.kind } : null
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  const host = url.hostname.replace(/^(www\.|m\.)/, "")
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1]
    return id && /^[\w-]{11}$/.test(id) ? { kind: "youtube", id, url: raw } : null
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /\/(\d{6,12})(?:\/|$)/.exec(url.pathname)?.[1]
    return id ? { kind: "vimeo", id, url: raw } : null
  }
  return DIRECT_VIDEO.test(url.pathname) ? { kind: "file", url: raw } : null
}

function PlayCard({ title, detail, thumbnail, onPlay }: { title: string; detail: string; thumbnail?: string; onPlay: () => void }) {
  return (
    <button type="button" onClick={onPlay} className={`${frame} group relative aspect-video text-left not-prose`} aria-label={`Play ${title}`}>
      {thumbnail ? (
        <img src={thumbnail} alt="" className="absolute inset-0 size-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950">
          <Film className="size-10 text-zinc-700" />
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-transform group-hover:scale-105">
          <Play className="ml-1 size-6 fill-current" />
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 block bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2">
        <span className="block truncate text-sm font-medium text-white">{title}</span>
        <span className="block truncate text-xs text-zinc-300">{detail}</span>
      </span>
    </button>
  )
}

/** A video, audio file, or image Dex stores (or a chat VM link to one), or a player card for a video elsewhere. */
export function MediaPlayer({ source, title }: { source: VideoSource; title?: string }) {
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const label = title?.trim() || "Video"

  if (source.kind === "own") return <StoredMedia url={source.url} media={source.media} title={title} />
  if (source.kind === "vm") return <VmMedia url={source.url} media={source.media} title={title} />
  if (failed && source.kind === "file") return <PlaybackFailed url={source.url} />

  if (!playing) {
    const host = source.kind === "youtube" ? "YouTube" : source.kind === "vimeo" ? "Vimeo" : (() => new URL(source.url).hostname)()
    return (
      <PlayCard
        title={label === "Video" && source.kind === "file" ? fileName(source.url) : label}
        detail={`${host} · loads when you tap play`}
        thumbnail={source.kind === "youtube" ? `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg` : undefined}
        onPlay={() => setPlaying(true)}
      />
    )
  }

  if (source.kind === "file") {
    return (
      <video controls playsInline autoPlay src={source.url} onError={() => setFailed(true)} className={`${frame} max-h-[70vh]`} aria-label={label} />
    )
  }
  const embed =
    source.kind === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1&playsinline=1&rel=0`
      : `https://player.vimeo.com/video/${source.id}?autoplay=1&dnt=1`
  return (
    <iframe
      src={embed}
      title={label}
      className={`${frame} aspect-video`}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      // Players need scripts; they can't navigate Dex itself.
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
    />
  )
}
