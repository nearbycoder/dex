import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { activeViewer } from "~/server/active-session"
import { startNativeSignIn } from "~/server/native-auth"

/** The native apps' sign-in starts here, in a browser sheet (see server/native-auth.ts). */
export const Route = createFileRoute("/auth/native/start")({
  server: {
    handlers: {
      GET: async ({ request }) => startNativeSignIn(request, (await activeViewer(request, env)) !== null)
    }
  }
})
