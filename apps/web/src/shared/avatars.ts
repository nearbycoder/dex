/**
 * Content-addressed avatar URLs for sidekicks and projects.
 *
 * Instead of serializing ~15–48 KB base64 `data:image/...` strings inside `DexState` on every WebSocket broadcast,
 * `DexAgent` keeps the raw image in SQLite and publishes a tiny immutable `/api/avatars/<kind>/<id>/<hash>` URL.
 * Changing a picture changes its hash, busting caches automatically; unchanged pictures cache privately for a year.
 */

export type AvatarKind = "character" | "project"

const AVATAR_URL_RE = /^\/api\/avatars\/(character|project)\/[A-Za-z0-9._~%-]{1,100}\/[0-9a-f]{16}$/
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/]+=*)$/

/** Fast deterministic 64-bit hex fingerprint (16 chars) of a stored image data URL. */
export function avatarHash(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b1
  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((code + i) & 0xffff), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}

/** Content-addressed URL for a stored character or project image (null if none). */
export function avatarUrl(kind: AvatarKind, id: string, image: string | null | undefined): string | null {
  if (!image) return null
  if (isAvatarUrl(image, kind)) return image
  return `/api/avatars/${kind}/${encodeURIComponent(id)}/${avatarHash(image)}`
}

/** Whether `value` is a Dex avatar endpoint path (optionally restricted to one kind). */
export function isAvatarUrl(value: unknown, kind?: AvatarKind): value is string {
  if (typeof value !== "string") return false
  const match = AVATAR_URL_RE.exec(value)
  return Boolean(match && (!kind || match[1] === kind))
}

/** Parses and Base64-decodes a validated `data:image/...;base64,...` URL into raw bytes. */
export function parseAvatarDataUrl(dataUrl: string): { readonly mimeType: string; readonly bytes: Uint8Array<ArrayBuffer> } | null {
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match) return null
  const mimeType = match[1]!
  const b64 = match[2]!
  try {
    const binary = atob(b64)
    const buffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { mimeType, bytes }
  } catch {
    return null
  }
}
