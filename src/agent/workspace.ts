import { Bash, InMemoryFs } from "just-bash"
import type { WorkspaceFile } from "~/shared/protocol"

export const WORKSPACE_ROOT = "/workspace"
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** `notes/a.md`, `./notes/a.md` and `/workspace/notes/a.md` all name `/workspace/notes/a.md`. */
export const resolveWorkspacePath = (input: string): string => {
  const raw = input.trim().replace(/\\/g, "/")
  const absolute = raw.startsWith("/") ? raw : `${WORKSPACE_ROOT}/${raw}`
  const parts: string[] = []
  for (const part of absolute.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  const path = `/${parts.join("/")}`
  if (path !== WORKSPACE_ROOT && !path.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error(`Path must be inside ${WORKSPACE_ROOT}: ${input}`)
  }
  return path
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index])

export interface BashResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/**
 * The agent's files, kept in the Durable Object's SQLite so they survive
 * restarts. Shell commands run in just-bash, a simulated bash over an
 * in-memory copy of the workspace; changed files are written back afterwards.
 */
export class Workspace {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS dex_files (path TEXT PRIMARY KEY, content BLOB NOT NULL, mtime INTEGER NOT NULL)`)
  }

  list(): WorkspaceFile[] {
    return this.sql
      .exec<{ path: string; size: number; mtime: number }>(
        `SELECT path, length(content) AS size, mtime FROM dex_files ORDER BY path`
      )
      .toArray()
  }

  read(path: string): Uint8Array | undefined {
    const row = this.sql.exec<{ content: ArrayBuffer }>(`SELECT content FROM dex_files WHERE path = ?`, resolveWorkspacePath(path)).toArray()[0]
    return row ? new Uint8Array(row.content) : undefined
  }

  readText(path: string): string | undefined {
    const bytes = this.read(path)
    return bytes && decoder.decode(bytes)
  }

  write(path: string, content: string | Uint8Array) {
    const bytes = typeof content === "string" ? encoder.encode(content) : content
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`File too large (${bytes.length} bytes; limit ${MAX_FILE_BYTES})`)
    const resolved = resolveWorkspacePath(path)
    const existing = this.read(resolved)?.length ?? 0
    if (this.totalBytes() - existing + bytes.length > MAX_WORKSPACE_BYTES) {
      throw new Error(`Workspace is full (limit ${MAX_WORKSPACE_BYTES / 1024 / 1024} MB)`)
    }
    this.sql.exec(
      `INSERT INTO dex_files (path, content, mtime) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET content = excluded.content, mtime = excluded.mtime`,
      resolved,
      bytes,
      Date.now()
    )
  }

  remove(path: string): boolean {
    const resolved = resolveWorkspacePath(path)
    const cursor = this.sql.exec(`DELETE FROM dex_files WHERE path = ? OR path LIKE ?`, resolved, `${resolved}/%`)
    return cursor.rowsWritten > 0
  }

  private totalBytes(): number {
    return this.sql.exec<{ total: number | null }>(`SELECT sum(length(content)) AS total FROM dex_files`).one().total ?? 0
  }

  async bash(command: string, options: { signal?: AbortSignal; cwd?: string } = {}): Promise<BashResult> {
    const before = new Map<string, Uint8Array>()
    const fs = new InMemoryFs()
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true })
    for (const row of this.sql.exec<{ path: string; content: ArrayBuffer }>(`SELECT path, content FROM dex_files`)) {
      const bytes = new Uint8Array(row.content)
      before.set(row.path, bytes)
      fs.mkdirSync(row.path.slice(0, row.path.lastIndexOf("/")) || "/", { recursive: true })
      await fs.writeFile(row.path, bytes)
    }

    const shell = new Bash({
      fs,
      cwd: options.cwd ? resolveWorkspacePath(options.cwd) : WORKSPACE_ROOT,
      env: { HOME: WORKSPACE_ROOT, USER: "dex" },
      // Workers cannot pin DNS answers to connections, so just-bash's private-range guard would refuse
      // every request; Workers' own fetch cannot reach private networks anyway.
      network: { dangerouslyAllowFullInternetAccess: true, denyPrivateRanges: false }
    })
    const result = await shell.exec(command, { signal: options.signal })

    // Write back what changed under the workspace; anything elsewhere (/tmp, …) is scratch.
    const after = new Set<string>()
    for (const path of fs.getAllPaths()) {
      if (!path.startsWith(`${WORKSPACE_ROOT}/`)) continue
      const stat = await fs.lstat(path)
      if (!stat.isFile) continue
      after.add(path)
      const bytes = await fs.readFileBuffer(path)
      const previous = before.get(path)
      if (!previous || !sameBytes(previous, bytes)) this.write(path, bytes)
    }
    for (const path of before.keys()) {
      if (!after.has(path)) this.sql.exec(`DELETE FROM dex_files WHERE path = ?`, path)
    }

    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
  }
}
