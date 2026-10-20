// Pulls pure helpers out of the web app's .tsx components (which Node can't import: they're JSX), strips their types,
// and evaluates them, so the goldens come from the web's own code rather than a copy of it.
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"

const WEB = new URL("../../../web/src/", import.meta.url)

/** The source of a top-level declaration: `export function name`, `export const name =`, or `const name =`. */
function declaration(source: string, name: string): string {
  const start = new RegExp(`^(export )?(function ${name}\\b|const ${name}\\b)`, "m").exec(source)
  if (!start) throw new Error(`No declaration ${name}`)
  let index = start.index
  let depth = 0
  let seen = false
  let quote: string | null = null
  for (; index < source.length; index++) {
    const char = source[index]!
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === "`") quote = char
    else if (char === "{" || char === "(" || char === "[") {
      depth++
      seen = true
    } else if (char === "}" || char === ")" || char === "]") depth--
    else if (char === "\n" && seen && depth === 0) {
      // A declaration ends at a newline once its brackets close, unless the next line is indented (continues it).
      if (!/^[ \t]/.test(source.slice(index + 1))) break
    }
  }
  return source.slice(start.index, index).replace(/^export /, "")
}

/** Evaluates declarations from a web file, with `scope` in reach, and returns them by name. */
export function load(file: string, names: string[], scope: Record<string, unknown> = {}): Record<string, any> {
  const source = readFileSync(new URL(file, WEB), "utf8")
  const code = names.map((name) => declaration(source, name)).join("\n")
  const js = stripTypeScriptTypes(code)
  const body = `${js}\nreturn { ${names.join(", ")} }`
  return new Function(...Object.keys(scope), body)(...Object.values(scope))
}
