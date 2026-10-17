import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import agents from "agents/vite"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  server: { port: 5173 },
  resolve: {
    tsconfigPaths: true,
    alias: [
      // OpenUI's code blocks import the full highlighter (every Prism language, ~750 KB) and every theme; use light builds.
      { find: /^react-syntax-highlighter$/, replacement: fileURLToPath(new URL("./src/client/openui/shims/syntax-highlighter.ts", import.meta.url)) },
      {
        find: /^react-syntax-highlighter\/dist\/cjs\/styles\/prism(\/index\.js)?$/,
        replacement: fileURLToPath(new URL("./src/client/openui/shims/syntax-styles.ts", import.meta.url))
      }
    ]
  },
  plugins: [
    // Transforms @callable() decorators and keeps just-bash Worker-safe.
    agents(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact()
  ]
})
