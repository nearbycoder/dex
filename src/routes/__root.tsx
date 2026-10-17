import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"
import styles from "~/styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover: draw edge to edge (safe areas are padded in CSS). resizes-content: on Android the
      // layout shrinks above the on-screen keyboard instead of being covered by it.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { name: "theme-color", content: "#09090b" },
      { name: "color-scheme", content: "dark" },
      // Home-screen app: full screen, content under a translucent status bar.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Dex" },
      { name: "application-name", content: "Dex" },
      { name: "format-detection", content: "telephone=no" },
      { title: "Dex" }
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" }
    ],
    // Runs before the app: mark installed-app mode, keep Android's install prompt for the Install button,
    // and register the service worker (not in dev, where it would fight Vite's module reloading).
    scripts: [
      {
        children: `(function () {
    var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (standalone) document.documentElement.dataset.standalone = "true";
    addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      window.__dexInstallPrompt = event;
      dispatchEvent(new Event("dex-install-available"));
    });
    if ("serviceWorker" in navigator && location.hostname !== "localhost") {
      addEventListener("load", function () { navigator.serviceWorker.register("/sw.js"); });
    }
  })();`
      }
    ]
  }),
  component: RootComponent
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
