/**
 * Media a chat can share: videos, audio, and images made on its VM, stored privately in R2 and served by Dex at
 * /api/media/<key>. Only these types are stored or served, and the type always comes from the extension, never
 * from the upload, so nothing that could run as a page (HTML, SVG, PDF) is ever served from Dex's origin.
 */

export type MediaKind = "video" | "audio" | "image"

export const MEDIA_TYPES: Readonly<Record<string, { readonly type: string; readonly kind: MediaKind }>> = {
  mp4: { type: "video/mp4", kind: "video" },
  m4v: { type: "video/mp4", kind: "video" },
  mov: { type: "video/quicktime", kind: "video" },
  webm: { type: "video/webm", kind: "video" },
  ogv: { type: "video/ogg", kind: "video" },
  mp3: { type: "audio/mpeg", kind: "audio" },
  m4a: { type: "audio/mp4", kind: "audio" },
  wav: { type: "audio/wav", kind: "audio" },
  ogg: { type: "audio/ogg", kind: "audio" },
  png: { type: "image/png", kind: "image" },
  jpg: { type: "image/jpeg", kind: "image" },
  jpeg: { type: "image/jpeg", kind: "image" },
  gif: { type: "image/gif", kind: "image" },
  webp: { type: "image/webp", kind: "image" }
}

/** Uploads go through a Worker request body, which is capped at 100 MB on workers.dev. */
export const MAX_MEDIA_BYTES = 95 * 1024 * 1024

export const MEDIA_PREFIX = "/api/media/"

export const extensionOf = (path: string) => /\.([a-z0-9]+)$/i.exec(path.split(/[?#]/)[0] ?? "")?.[1]?.toLowerCase()

export const mediaTypeOf = (path: string) => {
  const extension = extensionOf(path)
  return extension ? MEDIA_TYPES[extension] : undefined
}

/** `/api/media/…` URLs (relative, or on this origin) as their key; anything else is null. */
export const ownMediaKey = (url: string, origin?: string): string | null => {
  const path = origin && url.startsWith(origin) ? url.slice(origin.length) : url
  return path.startsWith(MEDIA_PREFIX) ? path.slice(MEDIA_PREFIX.length).split(/[?#]/)[0] ?? null : null
}

/** A file a chat put in front of you, stored in Dex (`source` is the VM link it was saved from, if any). */
export interface ChatArtifact {
  readonly key: string
  readonly url: string
  readonly name: string
  readonly kind: MediaKind
  readonly size: number
  readonly source: string | null
  readonly createdAt: number
}

const VM_PORT_HOST = /^[a-z0-9-]+-(\d{2,5})\.on\.boat\.dev$/

/**
 * A media file served from a chat VM's port (`https://<box>-<port>.on.boat.dev/<path>`), as the key Dex saves it
 * under: host and path, without the query (which carries the port's access token). Null for anything else.
 */
export const vmMediaSource = (raw: string): { readonly source: string; readonly port: number; readonly path: string } | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const port = VM_PORT_HOST.exec(url.hostname.toLowerCase())?.[1]
  if (url.protocol !== "https:" || !port || !mediaTypeOf(url.pathname)) return null
  return { source: `${url.hostname.toLowerCase()}${url.pathname}`, port: Number(port), path: url.pathname }
}

/** Every VM-served media link in some Markdown, deduplicated by source. */
export const vmMediaLinks = (text: string): string[] => {
  const found = new Map<string, string>()
  for (const match of text.matchAll(/https:\/\/[a-z0-9-]+\.on\.boat\.dev\/[^\s)<>"'\]]+/gi)) {
    const source = vmMediaSource(match[0])
    if (source && !found.has(source.source)) found.set(source.source, match[0])
  }
  return [...found.values()]
}
