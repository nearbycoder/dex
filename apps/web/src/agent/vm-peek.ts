/**
 * Read-only views of a chat's VM for live UIs (and the app_vm_peek operation): a folder, the end of a file, listening
 * ports, the busiest processes, and a repo's git status. Each is one fixed command whose output is parsed here, so
 * nothing a UI passes is run as shell beyond a quoted path.
 */

export type VmPeekView = "files" | "file" | "ports" | "processes" | "git"

export const VM_PEEK_VIEWS: ReadonlyArray<VmPeekView> = ["files", "file", "ports", "processes", "git"]

const MAX_FILE_CHARS = 64_000

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/** A path for the shell: `~/…` stays relative to the home folder, everything else is single-quoted. */
const shellPath = (path: string) => {
  if (!path || path.length > 4096 || path.includes("\0")) throw new Error("Invalid path")
  if (path === "~") return `"$HOME"`
  if (path.startsWith("~/")) return `"$HOME"/${quote(path.slice(2))}`
  return quote(path)
}

/**
 * Bounded Python helper for `files` and `file` peeks: avoids GNU `find` flag/predicate injection (e.g. `-delete`),
 * blocks credential files and virtual device/FIFO reads, and bounds memory/output.
 */
const PEEK_PY = String.raw`
import os, sys, stat, collections
view, raw, lines = sys.argv[1], sys.argv[2], max(1, min(int(sys.argv[3]), 2000))
path = os.path.abspath(os.path.expanduser(raw))
def sensitive(p):
    real = os.path.realpath(p)
    parts = real.split(os.sep)
    names = {os.path.basename(p), os.path.basename(real)}
    secret_names = {'.netrc', '.npmrc', '.pypirc', '.git-credentials', 'credentials', 'credentials.json', 'application_default_credentials.json', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', '.dex-gh-token'}
    if any(x in ('.ssh', '.gnupg', '.aws', '.azure', '.kube') or x == '.env' or x.startswith('.env.') or x.startswith('.dex-env-') for x in parts): return True
    if '.config' in parts and any(x in ('gh', 'gcloud', 'dex') for x in parts): return True
    if names & secret_names: return True
    if '.git' in parts and (names & {'config', 'credentials'}): return True
    if real.startswith('/home/user/mcp/') or real == '/home/user/mcp' or real.startswith('/var/lib/dex-mcp/') or real == '/var/lib/dex-mcp': return True
    if real.startswith('/tmp/.dex-') or (real.startswith('/tmp/dex-browse-') and real.endswith('.js')): return True
    return False
if view == 'files':
    try:
        with os.scandir(path) as it:
            names = sorted((e.name for e in it))[:500]
        for name in names:
            p = os.path.join(path, name)
            try:
                s = os.stat(p, follow_symlinks=False)
                t = 'd' if stat.S_ISDIR(s.st_mode) else 'l' if stat.S_ISLNK(s.st_mode) else 'f' if stat.S_ISREG(s.st_mode) else 'o'
                print(f'{t}\t{s.st_size}\t{s.st_mtime}\t{name}')
            except OSError:
                pass
    except OSError:
        pass
elif view == 'file':
    if sensitive(path):
        sys.stderr.write('Credential files cannot be inspected.\n')
        sys.exit(1)
    real = os.path.realpath(path)
    if any(real == p or real.startswith(p + '/') for p in ('/dev', '/proc', '/sys')):
        sys.stderr.write('Device and virtual system files cannot be inspected.\n')
        sys.exit(1)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode):
            sys.stderr.write('Not a regular file.\n')
            sys.exit(1)
        if s.st_size > 262144:
            f.seek(s.st_size - 262144)
        data = f.read(262144)
    text = data.decode('utf-8', errors='replace')
    tail = collections.deque(text.splitlines(keepends=True), maxlen=lines)
    sys.stdout.write(''.join(tail)[-64000:])
`

export const peekCommand = (view: VmPeekView, path: string, lines: number) => {
  if (!path || path.length > 4096 || path.includes("\0")) throw new Error("Invalid path")
  const clampedLines = Math.max(1, Math.min(Math.trunc(Number.isFinite(lines) ? lines : 80), 2000))
  switch (view) {
    case "files":
    case "file":
      return `python3 -c ${quote(PEEK_PY)} ${quote(view)} ${quote(path)} ${clampedLines}`
    case "ports":
      return `ss -ltnpH 2>/dev/null`
    case "processes":
      return `ps -eo pid=,pcpu=,pmem=,etimes=,comm= --sort=-pcpu | head -30`
    case "git":
      return `cd -- ${shellPath(path)} && GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_NO_LAZY_FETCH=1 git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -b 2>&1 && echo '@@log@@' && GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 git --no-optional-locks -c core.fsmonitor=false log -n 10 --format='%h%x09%an%x09%at%x09%s' 2>/dev/null`
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
