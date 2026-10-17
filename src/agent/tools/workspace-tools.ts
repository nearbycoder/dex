import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { WORKSPACE_ROOT, type Workspace } from "../workspace"

const text = (value: string) => [{ type: "text" as const, text: value }]
const MAX_OUTPUT_CHARS = 30_000

const clip = (value: string) =>
  value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${value.length - MAX_OUTPUT_CHARS} chars]` : value

export const workspaceTools = (workspace: Workspace) => [
  defineTool({
    name: "bash",
    description:
      `Run a shell command in your persistent workspace (${WORKSPACE_ROOT}). This is a simulated bash with ` +
      "coreutils, grep/rg, sed, awk, jq, yq, sqlite3, xan (CSV), tar/gzip, diff, find, and curl with full internet " +
      "access. There is no package manager, compiler, python or node. Files under the workspace persist between calls " +
      "and chats; anything elsewhere (like /tmp) is discarded after the command.",
    parameters: Type.Object({
      command: Type.String({ description: "The bash script to run." }),
      cwd: Type.Optional(Type.String({ description: `Working directory inside ${WORKSPACE_ROOT}.` }))
    }),
    // Calls share the workspace, so they run one at a time.
    executionMode: "sequential",
    execute: async ({ command, cwd }, _api, context) => {
      const result = await workspace.bash(command, { cwd, signal: context.abortSignal })
      const parts = [result.stdout, result.stderr && `[stderr]\n${result.stderr}`, `[exit code ${result.exitCode}]`]
      return { output: text(clip(parts.filter(Boolean).join("\n"))), isError: result.exitCode !== 0 }
    }
  }),

  defineTool({
    name: "read_file",
    description: "Read a text file from the workspace, with line numbers. Use offset/limit to page through long files.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 1, description: "First line to read (1-based)." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, description: "Number of lines. Default 400." }))
    }),
    replay: "safe",
    execute: async ({ path, offset = 1, limit = 400 }) => {
      const content = workspace.readText(path)
      if (content === undefined) return { output: text(`No such file: ${path}`), isError: true }
      const lines = content.split("\n")
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      const numbered = slice.map((line, index) => `${String(offset + index).padStart(5)}\t${line}`).join("\n")
      const more = offset - 1 + limit < lines.length ? `\n… ${lines.length - (offset - 1 + limit)} more lines` : ""
      return { output: text(clip(numbered + more)) }
    }
  }),

  defineTool({
    name: "write_file",
    description: "Create or overwrite a file in the workspace with the given content. Parent directories are implied.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: "safe",
    execute: async ({ path, content }) => {
      workspace.write(path, content)
      return { output: text(`Wrote ${content.length} characters to ${path}`) }
    }
  }),

  defineTool({
    name: "edit_file",
    description:
      "Replace exact text in a workspace file. old_string must match exactly once unless replace_all is true. " +
      "Read the file first so the match is exact, including whitespace.",
    parameters: Type.Object({
      path: Type.String(),
      old_string: Type.String(),
      new_string: Type.String(),
      replace_all: Type.Optional(Type.Boolean())
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      const content = workspace.readText(path)
      if (content === undefined) return { output: text(`No such file: ${path}`), isError: true }
      const count = old_string === "" ? 0 : content.split(old_string).length - 1
      if (count === 0) return { output: text("old_string was not found in the file."), isError: true }
      if (count > 1 && !replace_all) {
        return { output: text(`old_string matches ${count} times; add context or set replace_all.`), isError: true }
      }
      workspace.write(path, replace_all ? content.split(old_string).join(new_string) : content.replace(old_string, () => new_string))
      return { output: text(`Replaced ${replace_all ? count : 1} occurrence(s) in ${path}`) }
    }
  })
]
