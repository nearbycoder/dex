import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import agents from "agents/vite"
import { defineConfig } from "vite"

export default defineConfig({
  server: { port: 5173 },
  resolve: { tsconfigPaths: true },
  plugins: [
    // Transforms @callable() decorators and keeps just-bash Worker-safe.
    agents(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact()
  ]
})
