/** Bounded, read-only filesystem inspection. Paths are data passed to a fixed Python program, never shell code. */
export type VmFilesView = "directory" | "file" | "changes"
export interface VmFileEntry {
  path: string
  name: string
  directory: boolean
  size: number
  modifiedAt: number
  link: boolean
}
export interface VmFileChange {
  path: string
  previousPath: string | null
  status: "added" | "modified" | "deleted" | "renamed" | "untracked"
}
export interface VmDirectory {
  path: string
  parent: string
  entries: VmFileEntry[]
  next: number | null
}
export interface VmChanges {
  path: string
  repositories: string[]
  changes: VmFileChange[]
  truncated: boolean
}
export interface VmFile {
  path: string
  size: number
  modifiedAt: number | null
  content: string | null
  before: string | null
  change: VmFileChange["status"] | null
  binary: boolean
  truncated: boolean
  message: string | null
}
export type VmFilesResult<T> = { running: false; status: string } | { running: true; data: T }

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

// Keep response sizes below the RPC limit, even for binary data, huge repos, unusual filenames and long lines.
// O_NONBLOCK and a regular-file check prevent FIFOs/devices from hanging a read. Never execute file contents.
const INSPECT = String.raw`
import os, sys, json, stat, subprocess, itertools, codecs
view, raw, offset = sys.argv[1], sys.argv[2], int(sys.argv[3])
LIMIT = 64000
path = os.path.abspath(os.path.expanduser(raw))
# Chats without a project may never have created ~/work. Start at home in that case.
if raw == '~/work' and not os.path.isdir(path) and view != 'file': path = os.path.expanduser('~')
def git(folder, *args):
    try:
        p = subprocess.Popen(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', folder, *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={**os.environ, 'GIT_TERMINAL_PROMPT':'0', 'GIT_CONFIG_NOSYSTEM':'1', 'GIT_NO_LAZY_FETCH':'1'})
        try:
            maximum = LIMIT if args and args[0] == 'show' else 350000
            out = p.stdout.read(maximum+1)
            if maximum == LIMIT and len(out) > maximum:
                p.kill()
                return out
            if len(out) > 350000:
                p.kill()
                raise ValueError('Git output is too large; browse a smaller repository.')
            p.wait(timeout=3)
            return out if p.returncode == 0 else None
        finally:
            if p.poll() is None: p.kill()
            p.stdout.close()
            p.wait()
    except (subprocess.TimeoutExpired, OSError):
        return None
def root(folder):
    out = git(folder, 'rev-parse', '--show-toplevel')
    return os.fsdecode(out.rstrip(b'\n')) if out else None
def sensitive(p):
    parts = os.path.realpath(p).split(os.sep)
    return any(x in ('.ssh', '.gnupg', '.aws', '.azure', '.kube') or x == '.env' or x.startswith('.env.') or x.startswith('.dex-env-') for x in parts) or any(x in parts for x in ('gh', 'gcloud')) and '.config' in parts or os.path.basename(p) in ('.netrc', '.npmrc', '.pypirc', '.git-credentials', 'credentials', 'credentials.json', 'application_default_credentials.json', 'id_rsa', 'id_ed25519') or '.git' in parts and os.path.basename(p) in ('config', 'credentials') or os.path.realpath(p).endswith('/.config/dex/env')
def text(data):
    if b'\0' in data: return None
    try: return codecs.getincrementaldecoder('utf-8')().decode(data, final=False)
    except UnicodeDecodeError: return None
def changes(repo):
    out = git(repo, '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    if out is None: raise ValueError('Cannot read Git changes.')
    tokens, result = iter(out.split(b'\0')), []
    for token in tokens:
        if not token: continue
        state, name = token[:2].decode('ascii'), os.fsdecode(token[3:])
        old = os.fsdecode(next(tokens, b'')) if 'R' in state or 'C' in state else None
        kind = 'untracked' if state == '??' else 'renamed' if 'R' in state else 'deleted' if 'D' in state else 'added' if 'A' in state else 'modified'
        result.append(dict(path=os.path.join(repo, name), previousPath=os.path.join(repo, old) if old else None, status=kind))
    return result
def inspect():
    if view == 'directory':
        # Sorting names requires no file reads, and stat is limited to this page.
        with os.scandir(path) as it:
            names = sorted((e.name for e in it), key=lambda s: (s.casefold(), s))
        entries, budget, end = [], 0, offset
        for name in names[offset:offset+500]:
            p = os.path.join(path, name)
            end += 1
            try:
                s = os.stat(p, follow_symlinks=False)
                directory = stat.S_ISDIR(s.st_mode)
                # Symlinks are visible but not recursively followed, so a loop can never expand forever.
                entries.append(dict(path=p, name=name, directory=directory, size=s.st_size, modifiedAt=round(s.st_mtime*1000), link=stat.S_ISLNK(s.st_mode)))
                budget += len(p) + len(name)
                if budget > 80000: break
            except FileNotFoundError: pass
        entries.sort(key=lambda e: (not e['directory'], e['name'].casefold()))
        return dict(path=path, parent=os.path.dirname(path), entries=entries, next=end if end < len(names) else None)
    if view == 'changes':
        repo = root(path)
        repos = [repo] if repo else []
        if not repo:
            # Projects clone sibling repos into ~/work. Discover only immediate children; no filesystem crawl.
            with os.scandir(path) as it:
                for e in itertools.islice(it, 200):
                    if e.is_dir(follow_symlinks=False) and os.path.exists(os.path.join(e.path, '.git')):
                        r = root(e.path)
                        if r and r not in repos: repos.append(r)
        all_changes = []
        for repo in repos[:20]: all_changes.extend(changes(repo))
        clipped, budget = [], 0
        for c in all_changes:
            budget += len(c['path']) + len(c['previousPath'] or '')
            if len(clipped) >= 2000 or budget > 100000: break
            clipped.append(c)
        return dict(path=path, repositories=repos[:20], changes=clipped, truncated=len(clipped)<len(all_changes) or len(repos)>20)
    if sensitive(path):
        return dict(path=path, size=0, modifiedAt=None, content=None, before=None, change=None, binary=False, truncated=False, message='Credential files are not displayed.')
    actual = os.path.realpath(path)
    if any(actual == p or actual.startswith(p+'/') for p in ('/dev','/proc','/sys')):
        raise ValueError('Device and virtual system files cannot be previewed.')
    data, size, modified, exists = b'', 0, None, os.path.lexists(path)
    if exists:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as f:
            s = os.fstat(f.fileno())
            if not stat.S_ISREG(s.st_mode): raise ValueError('Select a regular file to preview.')
            data, size, modified = f.read(LIMIT+1), s.st_size, round(s.st_mtime*1000)
    repo = root(os.path.dirname(path))
    before, kind, truncated = None, None, len(data)>LIMIT
    if repo:
        rel = os.path.relpath(path, repo)
        # Limit status to this path; renames can still compare against the original HEAD name.
        candidates = changes(repo)
        change = next((c for c in candidates if c['path'] == path), None)
        kind = change['status'] if change else None
        old = os.path.relpath(change['previousPath'], repo) if change and change['previousPath'] else rel
        if not sensitive(os.path.join(repo, old)):
            original = git(repo, 'show', 'HEAD:'+old)
            if original is not None:
                truncated = truncated or len(original)>LIMIT
                before = text(original[:LIMIT])
    if not exists and before is None: raise FileNotFoundError('This file no longer exists.')
    content = text(data[:LIMIT]) if exists else None
    binary = exists and content is None
    return dict(path=path, size=size, modifiedAt=modified, content=content, before=before, change=kind, binary=binary, truncated=truncated, message='Binary file; source preview is unavailable.' if binary else None)
try:
    print(json.dumps(dict(data=inspect()), ensure_ascii=True))
except (OSError, ValueError) as e:
    print(json.dumps(dict(error=str(e))))
`

export function vmFilesCommand(view: VmFilesView, path: string, offset = 0) {
  if (!["directory", "file", "changes"].includes(view)) throw new Error("Unknown filesystem view")
  if (!path || path.length > 4096 || path.includes("\0")) throw new Error("Invalid file path")
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("Invalid directory offset")
  return `python3 -c ${quote(INSPECT)} ${quote(view)} ${quote(path)} ${offset}`
}

/** Mask after decoding JSON as well: a credential containing quotes/newlines was escaped on the VM. */
export function parseVmFiles(output: string, mask: (value: string) => string): VmDirectory | VmFile | VmChanges {
  const result = JSON.parse(output) as { error?: string; data: VmDirectory | VmFile | VmChanges }
  if (result.error) throw new Error(mask(result.error))
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return mask(value)
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
    return value
  }
  return redact(result.data) as VmDirectory | VmFile | VmChanges
}
