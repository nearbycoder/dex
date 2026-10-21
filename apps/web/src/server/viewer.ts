import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"
import { activeViewer } from "./active-session"
import { authOptions } from "./auth"
import { serverRuntime } from "./runtime"

export interface Viewer {
  readonly id: string
  readonly login: string
  readonly name: string
  readonly avatarUrl: string | null
}

export interface ViewerResult {
  readonly viewer: Viewer | null
  readonly options: { readonly github: boolean; readonly devLogin: boolean; readonly password: boolean }
}

/** The signed-in user (if any, with a session that hasn't been revoked) and which sign-in methods this deployment offers. */
export const getViewer = createServerFn().handler(async (): Promise<ViewerResult> => {
  const viewer = await activeViewer(getRequest(), env)
  const options = await serverRuntime(env).runPromise(authOptions)
  return { viewer: viewer && { id: viewer.id, login: viewer.login, name: viewer.name, avatarUrl: viewer.avatarUrl }, options }
})

/** This deployment's origin (e.g. https://trydex.dev), for absolute URLs in link previews. */
export const getSiteOrigin = createServerFn().handler(async (): Promise<string> => new URL(getRequest().url).origin)
