import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"
import { Effect, Option } from "effect"
import { authOptions, viewerFromRequest } from "./auth"
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

/** The signed-in user (if any) and which sign-in methods this deployment offers. */
export const getViewer = createServerFn().handler(async (): Promise<ViewerResult> =>
  serverRuntime(env).runPromise(
    Effect.gen(function*() {
      const viewer = yield* viewerFromRequest(getRequest())
      const options = yield* authOptions
      return {
        viewer: Option.match(viewer, {
          onNone: () => null,
          onSome: ({ id, login, name, avatarUrl }) => ({ id, login, name, avatarUrl })
        }),
        options
      }
    })
  )
)
