import { createFileRoute } from "@tanstack/react-router"
import { ArrowLeft, File, FilePlus, RefreshCw, Save, SquareTerminal, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"
import { Bone } from "~/client/components/skeleton"
import { useCachedFetch } from "~/client/lib/cache"
import { useDex } from "~/client/lib/dex"
import { formatBytes, timeAgo } from "~/client/lib/format"
import type { WorkspaceFile } from "~/shared/protocol"

export const Route = createFileRoute("/_app/files")({ component: FilesPage })

interface OpenFile {
  readonly path: string
  readonly content: string | null
  readonly size: number
  readonly draft: string
}

function FilesPage() {
  const { stub, connected } = useDex()
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState("")
  const [terminal, setTerminal] = useState<{ command: string; output: string; exitCode: number }[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    const value = command.trim()
    if (!value) return
    setRunning(true)
    setCommand("")
    try {
      const result = await stub.runCommand(value)
      setTerminal((lines) => [...lines.slice(-20), { command: value, output: result.stdout + result.stderr, exitCode: result.exitCode }])
      await refresh()
    } catch (cause) {
      setTerminal((lines) => [...lines, { command: value, output: String(cause), exitCode: 1 }])
    } finally {
      setRunning(false)
    }
  }

  const listFiles = useCallback(() => stub.listFiles() as Promise<WorkspaceFile[]>, [stub])
  const { data: files, refresh } = useCachedFetch("files", listFiles, connected)

  const select = async (path: string) => {
    setError(null)
    try {
      const file = await stub.readFile(path)
      setOpen({ ...file, draft: file.content ?? "" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`${open ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-zinc-900 md:w-80 md:border-r`}>
        <div className="flex h-12 items-center gap-2 border-b border-zinc-900 px-4">
          <span className="text-sm font-medium">/workspace</span>
          <button type="button" title="Refresh" onClick={() => void refresh()} className="ml-auto p-1 text-zinc-500 hover:text-zinc-200">
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
            title="New file"
            onClick={async () => {
              const path = prompt("New file path", "notes.md")
              if (!path) return
              await stub.writeFile(path, "")
              await refresh()
              await select(path.startsWith("/") ? path : `/workspace/${path}`)
            }}
            className="p-1 text-zinc-500 hover:text-zinc-200"
          >
            <FilePlus className="size-4" />
          </button>
        </div>
        <ul className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {!files &&
            [70, 55, 82, 46, 64].map((width, index) => (
              <li key={index} className="flex items-center gap-2 px-2 py-2">
                <Bone className="size-3.5 shrink-0" />
                <Bone className="h-3" style={{ width: `${width}%` }} />
              </li>
            ))}
          {files?.length === 0 && (
            <li className="px-2 py-1 text-xs text-zinc-600">Empty. Files Dex creates with its tools show up here.</li>
          )}
          {files?.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => void select(file.path)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  open?.path === file.path ? "bg-zinc-900 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900/60"
                }`}
              >
                <File className="size-3.5 shrink-0 text-zinc-600" />
                <span className="truncate font-mono text-xs">{file.path.replace(/^\/workspace\//, "")}</span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{formatBytes(file.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={`${open ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {error && <p className="p-4 text-sm text-red-400">{error}</p>}
        {open ? (
          <>
            <div className="flex h-12 items-center gap-3 border-b border-zinc-900 px-4">
              <button type="button" title="Back" onClick={() => setOpen(null)} className="-ml-1.5 p-1.5 text-zinc-400 md:hidden">
                <ArrowLeft className="size-4" />
              </button>
              <span className="truncate font-mono text-xs text-zinc-300">{open.path}</span>
              <span className="hidden text-xs text-zinc-600 sm:inline">{timeAgo(files?.find((file) => file.path === open.path)?.mtime ?? Date.now())}</span>
              <div className="ml-auto flex items-center gap-1">
                {open.content !== null && (
                  <button
                    type="button"
                    disabled={open.draft === open.content}
                    onClick={async () => {
                      await stub.writeFile(open.path, open.draft)
                      setOpen({ ...open, content: open.draft })
                      await refresh()
                    }}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    <Save className="size-3.5" /> Save
                  </button>
                )}
                <button
                  type="button"
                  title="Delete"
                  onClick={async () => {
                    if (!confirm(`Delete ${open.path}?`)) return
                    await stub.deleteFile(open.path)
                    setOpen(null)
                    await refresh()
                  }}
                  className="p-1.5 text-zinc-500 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            {open.content === null ? (
              <p className="p-4 text-sm text-zinc-500">Binary file ({formatBytes(open.size)}).</p>
            ) : (
              <textarea
                value={open.draft}
                onChange={(event) => setOpen({ ...open, draft: event.target.value })}
                spellCheck={false}
                className="scrollbar-thin flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-200 focus:outline-none"
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">Select a file</div>
        )}
        <div className="border-t border-zinc-900 bg-zinc-950">
          {terminal.length > 0 && (
            <div className="scrollbar-thin max-h-64 overflow-y-auto px-4 pt-3 font-mono text-xs">
              {terminal.map((line, index) => (
                <div key={index} className="mb-2">
                  <div className="text-emerald-400">$ {line.command}</div>
                  <pre className={`whitespace-pre-wrap ${line.exitCode === 0 ? "text-zinc-300" : "text-red-300"}`}>{line.output}</pre>
                </div>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-2 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
            onSubmit={(event) => {
              event.preventDefault()
              void run()
            }}
          >
            <SquareTerminal className="size-4 text-zinc-500" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              disabled={running || !connected}
              placeholder={running ? "Running…" : "Run a command (bash, jq, curl, rg…)"}
              className="min-w-0 flex-1 bg-transparent font-mono text-base text-zinc-200 placeholder:text-zinc-600 focus:outline-none md:text-xs"
            />
          </form>
        </div>
      </div>
    </div>
  )
}
