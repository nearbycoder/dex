export const readCookie = (header: string | null, name: string): string | undefined => {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    if (part.slice(0, index).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

export interface CookieOptions {
  readonly maxAge?: number
  readonly secure: boolean
}

export const serializeCookie = (name: string, value: string, { maxAge, secure }: CookieOptions) =>
  [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : undefined,
    maxAge === undefined ? undefined : `Max-Age=${maxAge}`
  ]
    .filter(Boolean)
    .join("; ")

export const clearCookie = (name: string, secure: boolean) => serializeCookie(name, "", { maxAge: 0, secure })

export const isSecureRequest = (request: Request) => new URL(request.url).protocol === "https:"
