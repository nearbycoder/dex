import { createFileRoute, redirect } from "@tanstack/react-router"
import { getViewer } from "~/server/viewer"

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { viewer } = await getViewer()
    throw redirect({ to: viewer ? "/chat" : "/login" })
  }
})
