import { createRouter } from "@tanstack/react-router"
import { CurrentRouteSkeleton } from "./client/components/skeleton"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Pages render from the agent's synced state, so nothing waits on loaders. A page whose code is still on its way
    // after 100ms shows its skeleton (for at least 200ms, so it doesn't flash); usually the code is preloaded.
    defaultPendingComponent: CurrentRouteSkeleton,
    defaultPendingMs: 100,
    defaultPendingMinMs: 200,
    // Cross-fades pages where the browser supports View Transitions (styled in styles.css).
    defaultViewTransition: true
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
