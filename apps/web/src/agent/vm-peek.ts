/**
 * Read-only views of a chat's VM for live UIs (and the app_vm_peek operation): a folder, the end of a file, listening
 * ports, the busiest processes, and a repo's git status. Each is one fixed command whose output is parsed here, so
 * nothing a UI passes is run as shell beyond a quoted path.
 */

export type VmPeekView = "files" | "file" | "ports" | "processes" | "git"

export const VM_PEEK_VIEWS: ReadonlyArray<VmPeekView> = ["files", "file", "ports", "processes", "git"]

const MAX_FILE_CHARS = 64_000

/** A path for the shell: `~/…` stays relative to the home folder, everything else is single-quoted. */
const shellPath = (path: string) => {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  if (path === "~") return `"$HOME"`
  if (path.startsWith("~/")) return `"$HOME"/${quote(path.slice(2))}`
  return quote(path)
}

export const peekCommand = (view: VmPeekView, path: string, lines: number) => {
  const at = shellPath(path)
  switch (view) {
    case "files":
      return `find ${at} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null | sort -t "$(printf '\\t')" -k4 | head -500`
    case "file":
      return `tail -n ${lines} ${at}`
    case "ports":
      return `ss -ltnpH 2>/dev/null`
    case "processes":
      return `ps -eo pid=,pcpu=,pmem=,etimes=,comm= --sort=-pcpu | head -30`
    case "git":
      return `cd ${at} && git status --porcelain=v1 -b 2>&1 && echo '@@log@@' && git log -n 10 --format='%h%x09%an%x09%at%x09%s' 2>/dev/null`
  }
}

const TYPES: Readonly<Record<string, string>> = { d: "dir", f: "file", l: "link" }

/** The command's output as data for the view. */
export const parsePeek = (view: VmPeekView, path: string, output: string) => {
  const rows = output.split("\n").filter((line) => line.trim())
  switch (view) {
    case "files":
      return {
        path,
        entries: rows.map((line) => {
          const [type = "", size = "0", modified = "0", ...name] = line.split("\t")
          return { name: name.join("\t"), type: TYPES[type] ?? "other", size: Number(size), modifiedAt: Math.round(Number(modified) * 1000) }
        })
      }
    case "file":
      return { path, content: output.length > MAX_FILE_CHARS ? output.slice(-MAX_FILE_CHARS) : output }
    case "ports":
      return {
        ports: rows.flatMap((line) => {
          const fields = line.trim().split(/\s+/)
          const port = Number(fields[3]?.split(":").at(-1))
          if (!Number.isFinite(port)) return []
          const process = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? null
          return [{ port, address: fields[3] ?? "", process }]
        })
      }
    case "processes":
      return {
        processes: rows.map((line) => {
          const [pid = "0", cpu = "0", mem = "0", seconds = "0", ...command] = line.trim().split(/\s+/)
          return { pid: Number(pid), cpu: Number(cpu), memory: Number(mem), seconds: Number(seconds), command: command.join(" ") }
        })
      }
    case "git": {
      const [status = "", log = ""] = output.split("@@log@@")
      const lines = status.split("\n").filter(Boolean)
      if (lines[0] && !lines[0].startsWith("##")) return { path, repo: false, error: lines.join("\n").slice(0, 500) }
      const branch = lines[0]?.replace(/^## /, "") ?? ""
      return {
        path,
        repo: true,
        branch: branch.split("...")[0] ?? branch,
        tracking: branch.includes("...") ? branch.split("...")[1] : null,
        changes: lines.slice(1).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) })),
        commits: log
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash = "", author = "", at = "0", ...subject] = line.split("\t")
            return { hash, author, at: Number(at) * 1000, subject: subject.join("\t") }
          })
      }
    }
  }
}
