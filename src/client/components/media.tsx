import { Film, Play } from "lucide-react"
import { useState } from "react"
import { MEDIA_PREFIX, mediaTypeOf } from "~/shared/media"

/**
 * Inline playback for media in chats. Media Dex stores (shared from a VM) plays straight away; anything from
 * another site loads only when you tap play, so a model-written URL never fetches anything (or leaks anything in
 * its query string) on its own.
 */

export type VideoSource =
  | { readonly kind: "own"; readonly url: string; readonly media: "video" | "audio" | "image" }
  | { readonly kind: "file"; readonly url: string }
  | { readonly kind: "youtube"; readonly id: string; readonly url: string }
  | { readonly kind: "vimeo"; readonly id: string; readonly url: string }

const DIRECT_VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i

/** What kind of playable media a URL is, if any. */
export function videoSource(raw: string): VideoSource | null {
  if (raw.startsWith(MEDIA_PREFIX)) {
    const media = mediaTypeOf(raw)
    return media ? { kind: "own", url: raw, media: media.kind } : null
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

const frame = "my-2 block w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-black"

function PlayCard({ title, detail, thumbnail, onPlay }: { title: string; detail: string; thumbnail?: string; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className={`${frame} group relative aspect-video text-left not-prose`}
      aria-label={`Play ${title}`}
    >
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

/** A video, audio file, or image Dex stores, or a player card for a video elsewhere. */
export function MediaPlayer({ source, title }: { source: VideoSource; title?: string }) {
  const [playing, setPlaying] = useState(false)
  const label = title?.trim() || "Video"

  if (source.kind === "own") {
    if (source.media === "image") return <img src={source.url} alt={title ?? ""} className="my-2 max-h-[70vh] rounded-xl" />
    if (source.media === "audio") return <audio controls preload="metadata" src={source.url} className="my-2 block w-full max-w-xl" />
    return <video controls playsInline preload="metadata" src={source.url} className={`${frame} max-h-[70vh]`} aria-label={label} />
  }

  if (!playing) {
    const host = source.kind === "youtube" ? "YouTube" : source.kind === "vimeo" ? "Vimeo" : (() => new URL(source.url).hostname)()
    return (
      <PlayCard
        title={label === "Video" && source.kind === "file" ? (new URL(source.url).pathname.split("/").pop() ?? label) : label}
        detail={`${host} · loads when you tap play`}
        thumbnail={source.kind === "youtube" ? `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg` : undefined}
        onPlay={() => setPlaying(true)}
      />
    )
  }

  if (source.kind === "file") return <video controls playsInline autoPlay src={source.url} className={`${frame} max-h-[70vh]`} aria-label={label} />
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
