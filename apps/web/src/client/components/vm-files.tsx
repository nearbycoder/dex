import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react"
import { themeToTreeStyles, type FileTreeDirectoryHandle, type GitStatusEntry } from "@pierre/trees"
import darkTheme from "@pierre/theme/pierre-dark"
import lightTheme from "@pierre/theme/pierre-light"
import { File, MultiFileDiff } from "@pierre/diffs/react"
import { ArrowLeft, ArrowUp, FileCode2, FolderOpen, GitCompareArrows, Maximize2, Minimize2, Moon, RefreshCw, Sun, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { VmChanges, VmDirectory, VmFile, VmFilesResult, VmFilesView } from "~/agent/vm-files"
import { useDex } from "~/client/lib/dex"
import { formatBytes } from "~/client/lib/format"
import { VmFilesSkeleton } from "./skeleton"

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not load the VM files."
const relative = (root: string, path: string) => {
  const prefix = root === "/" ? "/" : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}
const inFolder = (root: string, path: string) => `${root === "/" ? "" : root}/${path}`

export default function VmFilesPanel({ sessionId, running, onClose }: { sessionId: string; running: boolean; onClose: () => void }) {
  const { state, stub, connected } = useDex()
  const vm = state?.vms.find((candidate) => candidate.key === sessionId)
  const [folder, setFolder] = useState("~/work")
  const [pathInput, setPathInput] = useState(folder)
  const [directories, setDirectories] = useState<Record<string, VmDirectory>>({})
  const [root, setRoot] = useState<VmDirectory | null>(null)
  const [changes, setChanges] = useState<VmChanges | null>(null)
  const [changesError, setChangesError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<VmFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<"files" | "changes">("files")
  const [view, setView] = useState<"source" | "diff">("source")
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [wide, setWide] = useState(false)
  const generation = useRef(0)
  const directoryCache = useRef(directories)
  directoryCache.current = directories
  const requests = useRef(new Set<string>())
  const wasRunning = useRef(running)
  const loadedFolder = useRef<string | null>(null)

  useEffect(() => {
    if (connected) void stub.vmRefresh(sessionId).catch((error) => setError(errorMessage(error)))
  }, [stub, sessionId, connected])

  // Refresh when the agent finishes work; opening Files never starts or keeps a VM awake.
  useEffect(() => {
    if (wasRunning.current && !running) setRevision((value) => value + 1)
    wasRunning.current = running
  }, [running])

  const inspect = useCallback(async <T,>(kind: VmFilesView, path: string, offset = 0): Promise<T> => {
    const result = await stub.vmFiles(sessionId, kind, path, offset) as VmFilesResult<T>
    if (!result.running) throw new Error("The VM is stopped. Start it to browse its files.")
    return result.data
  }, [stub, sessionId])

  const loadDirectory = useCallback(async (path: string, offset = 0) => {
    const requestGeneration = generation.current
    const key = `${requestGeneration}:${path}:${offset}`
    if (requests.current.has(key)) return
    requests.current.add(key)
    setPending((value) => value + 1)
    try {
      const result = await inspect<VmDirectory>("directory", path, offset)
      if (requestGeneration !== generation.current) return
      setDirectories((current) => ({ ...current, [result.path]: offset && current[result.path]
        ? { ...result, entries: [...current[result.path]!.entries, ...result.entries] }
        : result }))
      setError(null)
    } catch (error) {
      if (requestGeneration === generation.current) setError(errorMessage(error))
    } finally {
      requests.current.delete(key)
      setPending((value) => value - 1)
    }
  }, [inspect])

  useEffect(() => {
    const current = ++generation.current
    setRoot(null)
    setDirectories({})
    setChanges(null)
    setSelected(null)
    setError(null)
    requests.current.clear()
    return () => { if (generation.current === current) generation.current++ }
  }, [folder])

  useEffect(() => {
    if (!connected || vm?.status !== "running") return
    let cancelled = false
    setPending((value) => value + 1)
    // Independent directory/Git requests: one failure must not hide the other view.
    void inspect<VmDirectory>("directory", folder).then((result) => {
      if (cancelled) return
      setRoot(result)
      setPathInput(result.path)
      setDirectories((current) => ({ ...current, [result.path]: result }))
      setError(null)
    }).catch((error) => { if (!cancelled) setError(errorMessage(error)) })
      .finally(() => setPending((value) => value - 1))
    void inspect<VmChanges>("changes", folder).then((result) => {
      if (!cancelled) { setChanges(result); setChangesError(null) }
    }).catch((error) => { if (!cancelled) { setChanges(null); setChangesError(errorMessage(error)) } })
    // Refresh folders the user has opened too, so newly created/deleted children show up.
    const children = loadedFolder.current === folder ? Object.keys(directoryCache.current).filter((path) => path !== root?.path) : []
    loadedFolder.current = folder
    void (async () => {
      for (const path of children) {
        if (cancelled) break
        await loadDirectory(path)
      }
    })()
    return () => { cancelled = true }
    // root is the resolved version of folder, not another request trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, vm?.status, folder, revision, inspect, loadDirectory])

  useEffect(() => {
    setFile(null)
    setFileError(null)
    if (!selected || !connected || vm?.status !== "running") return
    let cancelled = false
    void inspect<VmFile>("file", selected).then((result) => {
      if (!cancelled) setFile(result)
    }).catch((error) => { if (!cancelled) setFileError(errorMessage(error)) })
    return () => { cancelled = true }
  }, [selected, revision, inspect, connected, vm?.status])

  const select = useCallback((path: string, changed = false) => {
    setSelected(path)
    setView(changed ? "diff" : "source")
  }, [])
  const navigate = (path: string) => { setFolder(path); setPathInput(path) }
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose() }
    }
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("keydown", escape)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [onClose])

  const themeObject = theme === "dark" ? darkTheme : lightTheme
  return (
    <aside aria-label="VM files" className={`${wide ? "absolute inset-0" : "absolute inset-0 xl:relative xl:inset-auto xl:w-[55%] xl:shrink-0"} z-20 flex min-h-0 min-w-0 flex-col border-l border-zinc-800 bg-zinc-950`}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <FolderOpen className="size-4 text-zinc-400" />
        <h2 className="text-sm font-medium">Files</h2>
        <span className="truncate text-xs text-zinc-400">Session VM</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Refresh files" aria-label="Refresh files" disabled={!connected || vm?.status !== "running" || pending > 0} onClick={() => setRevision((value) => value + 1)} className="rounded p-2 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"><RefreshCw className={`size-4 ${pending > 0 ? "animate-spin" : ""}`} /></button>
          <button type="button" title={theme === "dark" ? "Pierre Light" : "Pierre Dark"} aria-label={theme === "dark" ? "Use Pierre Light theme" : "Use Pierre Dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="rounded p-2 text-zinc-400 hover:bg-zinc-800">{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
          <button type="button" title={wide ? "Restore panel" : "Expand panel"} aria-label={wide ? "Restore panel" : "Expand panel"} onClick={() => setWide(!wide)} className="hidden rounded p-2 text-zinc-400 hover:bg-zinc-800 xl:block">{wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
          <button ref={closeButton} type="button" title="Close files" aria-label="Close files" onClick={onClose} className="rounded p-2 text-zinc-400 hover:bg-zinc-800"><X className="size-4" /></button>
        </div>
      </div>
      {vm?.status !== "running" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-400">
          <FolderOpen className="size-8 text-zinc-600" />
          <p>{vm?.status === "starting" ? "The VM is starting…" : "Start this session’s VM to browse its files."}</p>
          {vm?.status !== "starting" && <button type="button" disabled={!connected} onClick={() => void stub.vmStart(sessionId).catch((error) => setError(errorMessage(error)))} className="rounded-lg bg-zinc-800 px-4 py-2 text-zinc-100 disabled:opacity-50">Start VM</button>}
          {error && <p role="alert" className="text-red-400">{error}</p>}
        </div>
      ) : (
        <>
          <form className="flex shrink-0 items-center gap-1 border-b border-zinc-800 p-2" onSubmit={(event) => { event.preventDefault(); if (pathInput.trim()) navigate(pathInput.trim()) }}>
            <button type="button" aria-label="Parent folder" title="Parent folder" disabled={!root || root.path === root.parent} onClick={() => root && navigate(root.parent)} className="rounded p-2 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"><ArrowUp className="size-4" /></button>
            <input aria-label="VM folder path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} spellCheck={false} className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-base text-zinc-300 focus:border-zinc-600 focus:outline-none md:text-xs" />
            <button type="submit" className="rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">Go</button>
          </form>
          {!connected && <p role="status" className="px-3 py-2 text-xs text-amber-300">Reconnecting… files may be out of date.</p>}
          {error && <p role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-red-400">{error}<button type="button" onClick={() => setRevision((value) => value + 1)} className="ml-auto underline">Retry</button></p>}
          <div className="flex min-h-0 flex-1" style={{ background: themeObject.colors["editor.background"], color: themeObject.colors["editor.foreground"], colorScheme: theme }}>
            <div className={`${selected ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-r border-current/10 md:w-56 md:shrink-0`}>
              <div role="tablist" aria-label="File list" className="flex h-10 shrink-0 gap-1 border-b border-current/10 px-2">
                {([ ["files", "All files"], ["changes", `Changes${changes ? ` ${changes.changes.length}${changes.truncated ? "+" : ""}` : ""}`] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-2 text-xs ${tab === value ? "border-emerald-500" : "border-transparent opacity-60 hover:opacity-100"}`}>{label}</button>)}
              </div>
              {tab === "files" ? root ? (
                <>
                  <DirectoryTree key={root.path} root={root.path} directories={directories} changes={changes} theme={theme} revision={revision} activePath={selected} onSelect={select} onExpand={loadDirectory} />
                  {Object.values(directories).filter((dir) => dir.next !== null).map((dir) => <button key={dir.path} type="button" disabled={pending > 0} onClick={() => void loadDirectory(dir.path, dir.next!)} className="shrink-0 border-t border-current/10 p-2 text-xs underline">Load more in {relative(root.path, dir.path) || dir.path}</button>)}
                  {root.entries.length === 0 && <p className="px-3 py-4 text-xs opacity-60">This folder is empty.</p>}
                </>
              ) : <VmFilesSkeleton treeOnly /> : (
                <div role="tabpanel" className="scrollbar-thin min-h-0 flex-1 overflow-auto p-2">
                  <p className="px-2 py-2 text-[11px] opacity-60">Staged, unstaged, and new files · compared with HEAD</p>
                  {changesError ? <p role="alert" className="p-2 text-xs text-red-400">{changesError}</p> : !changes ? <VmFilesSkeleton treeOnly /> : !changes.repositories.length ? <p className="p-2 text-xs opacity-60">No Git repository here. Open a repository folder to inspect changes.</p> : changes.changes.length === 0 ? <p className="p-2 text-xs opacity-60">No uncommitted changes.</p> : changes.changes.map((change) => (
                    <button key={change.path} type="button" title={`${change.status}: ${change.path}${change.previousPath ? ` (from ${change.previousPath})` : ""}`} onClick={() => select(change.path, true)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-current/10 ${selected === change.path ? "bg-current/10" : ""}`}>
                      <span className={`w-3 shrink-0 font-mono ${change.status === "deleted" ? "text-red-400" : change.status === "modified" ? "text-amber-500" : "text-emerald-500"}`}>{({ added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U" })[change.status]}</span>
                      <span className="min-w-0 break-all font-mono">{relative(root?.path ?? folder, change.path)}</span>
                    </button>
                  ))}
                  {changes?.truncated && <p className="p-2 text-xs text-amber-500">More changes exist. Open an individual repository to narrow the list.</p>}
                </div>
              )}
            </div>
            <div className={`${selected ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
              {selected ? <>
                <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-current/10 px-2">
                  <button type="button" aria-label="Back to file list" onClick={() => setSelected(null)} className="rounded p-2 hover:bg-current/10 md:hidden"><ArrowLeft className="size-4" /></button>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={selected}>{selected.split("/").at(-1)}</span>
                  {file && <span className="shrink-0 text-[10px] opacity-50">{formatBytes(file.size)}</span>}
                  {file?.change && !file.binary && <div role="tablist" aria-label="File view" className="flex gap-0.5 text-xs">
                    <button type="button" role="tab" aria-selected={view === "source"} aria-label="Source" title="Source" onClick={() => setView("source")} className={`rounded p-2 ${view === "source" ? "bg-current/10" : "opacity-50"}`}><FileCode2 className="size-4" /></button>
                    <button type="button" role="tab" aria-selected={view === "diff"} aria-label="Changes" title="Changes" onClick={() => setView("diff")} className={`rounded p-2 ${view === "diff" ? "bg-current/10" : "opacity-50"}`}><GitCompareArrows className="size-4" /></button>
                  </div>}
                </div>
                <p className="shrink-0 break-all border-b border-current/10 px-3 py-1.5 font-mono text-[10px] opacity-50">{selected}</p>
                {fileError ? <p role="alert" className="p-4 text-sm text-red-400">{fileError}</p> : !file || file.path !== selected ? <VmFilesSkeleton /> : <SourceView file={file} view={view} theme={theme} />}
              </> : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm opacity-50"><FileCode2 className="size-8" /><p>Select a file to inspect it.</p></div>}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

function DirectoryTree({ root, directories, changes, theme, revision, activePath, onSelect, onExpand }: {
  root: string
  directories: Record<string, VmDirectory>
  changes: VmChanges | null
  theme: "light" | "dark"
  revision: number
  activePath: string | null
  onSelect: (path: string) => void
  onExpand: (path: string) => Promise<void>
}) {
  const paths = useMemo(() => {
    const paths: string[] = []
    const folders = [root]
    // Follow current parent listings, so refreshing a deleted folder also removes its cached children.
    for (let index = 0; index < folders.length; index++) {
      for (const entry of directories[folders[index]!]?.entries ?? []) {
        paths.push(relative(root, entry.path) + (entry.directory ? "/" : ""))
        if (entry.directory && directories[entry.path]) folders.push(entry.path)
      }
    }
    return paths
  }, [directories, root])
  const gitStatus = useMemo<GitStatusEntry[]>(() => changes?.changes.filter((change) => change.path.startsWith(`${root}/`)).map((change) => ({ path: relative(root, change.path), status: change.status })) ?? [], [changes, root])
  const { model } = useFileTree({ paths, gitStatus, search: true, initialExpansion: "closed", flattenEmptyDirectories: false, density: "default" })
  const selectedPath = useFileTreeSelection(model).at(-1)
  const latest = useRef({ directories, onExpand })
  latest.current = { directories, onExpand }
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    const expanded = paths.filter((path) => {
      const item = path.endsWith("/") ? model.getItem(path) : null
      return item?.isDirectory() && (item as FileTreeDirectoryHandle).isExpanded()
    })
    model.resetPaths(paths, { initialExpandedPaths: expanded })
  }, [model, paths])
  useEffect(() => { model.setGitStatus(gitStatus) }, [model, gitStatus])
  useEffect(() => {
    // Going back on a phone must let the same row open its file again.
    if (activePath === null) for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
  }, [model, activePath])
  useEffect(() => {
    attempted.current.clear()
  }, [revision])
  useEffect(() => {
    if (selectedPath && !selectedPath.endsWith("/")) onSelect(inFolder(root, selectedPath))
  }, [selectedPath, root, onSelect])
  useEffect(() => {
    const loadExpanded = () => {
      for (const dir of Object.values(latest.current.directories)) {
        for (const entry of dir.entries) {
          if (!entry.directory || latest.current.directories[entry.path] || attempted.current.has(entry.path)) continue
          const item = model.getItem(`${relative(root, entry.path)}/`)
          if (item?.isDirectory() && (item as FileTreeDirectoryHandle).isExpanded()) {
            attempted.current.add(entry.path)
            void latest.current.onExpand(entry.path)
          }
        }
      }
    }
    loadExpanded()
    return model.subscribe(loadExpanded)
  }, [model, root, directories, revision])
  const treeStyle = useMemo(() => themeToTreeStyles(theme === "dark" ? darkTheme : lightTheme), [theme])
  return <FileTree model={model} className="min-h-0 flex-1" style={treeStyle} />
}

function SourceView({ file, view, theme }: { file: VmFile; view: "source" | "diff"; theme: "dark" | "light" }) {
  const oldFile = useMemo(() => file.before === null ? null : { name: file.path, contents: file.before }, [file.path, file.before])
  const newFile = useMemo(() => file.content === null ? null : { name: file.path, contents: file.content }, [file.path, file.content])
  const options = useMemo(() => ({ theme: { dark: "pierre-dark", light: "pierre-light" }, themeType: theme, disableFileHeader: true, overflow: "wrap" as const, diffStyle: "unified" as const }), [theme])
  return <>
    {file.truncated && <p className="shrink-0 border-b border-current/10 px-3 py-2 text-xs text-amber-500">Preview limited to the first 64 KB. Diff may be incomplete.</p>}
    {file.message ? <p className="p-4 text-sm opacity-60">{file.message}</p> : <div className="scrollbar-thin min-h-0 flex-1 overflow-auto text-xs" style={{ "--diffs-font-size": "12px" } as React.CSSProperties}>
      {view === "diff" && file.change && (oldFile || newFile) ? newFile ? <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} /> : oldFile && <MultiFileDiff oldFile={oldFile} newFile={null} options={options} /> : newFile ? <File file={newFile} options={options} /> : <p className="p-4 opacity-60">This file was deleted. Select Changes to see its previous content.</p>}
    </div>}
  </>
}
