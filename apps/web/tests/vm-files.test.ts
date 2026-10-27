import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { parseVmFiles, vmFilesCommand, type VmChanges, type VmDirectory, type VmFile, type VmFilesView } from "../src/agent/vm-files.ts"

const fixture = mkdtempSync(join(tmpdir(), "dex-files-"))
after(() => rmSync(fixture, { recursive: true, force: true }))
const repo = join(fixture, "repo")
mkdirSync(repo)
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
git("init", "-q")
git("config", "user.email", "test@example.invalid")
git("config", "user.name", "Dex tests")
for (const name of ["edit.ts", "delete.txt", "rename.txt"]) writeFileSync(join(repo, name), `original ${name}\n`)
writeFileSync(join(repo, "large.txt"), "a".repeat(400000))
git("add", ".")
git("commit", "-qm", "baseline")
writeFileSync(join(repo, "edit.ts"), "export const value = 2\n")
unlinkSync(join(repo, "delete.txt"))
renameSync(join(repo, "rename.txt"), join(repo, "renamed.txt"))
git("add", "-A")
writeFileSync(join(repo, "new file.txt"), "new file\n")

function inspect<T>(view: VmFilesView, path: string, offset = 0, mask = (value: string) => value): T {
  const output = execFileSync("sh", ["-c", vmFilesCommand(view, path, offset)], { encoding: "utf8", timeout: 5000, maxBuffer: 2_000_000 })
  return parseVmFiles(output, mask) as T
}

test("lists hidden files, pages large folders and preserves unusual filenames without executing them", () => {
  const folder = join(fixture, "files")
  mkdirSync(folder)
  const unusual = "a'$(touch PWNED)\n日本語.txt"
  writeFileSync(join(folder, unusual), "hello")
  writeFileSync(join(folder, ".hidden"), "hidden")
  mkdirSync(join(folder, "nested"))
  for (let i = 0; i < 510; i++) writeFileSync(join(folder, `file-${i}`), "")
  const first = inspect<VmDirectory>("directory", folder)
  assert.equal(first.entries.length, 500)
  assert.equal(first.next, 500)
  assert.ok(first.entries.some((entry) => entry.name === unusual))
  assert.ok(first.entries.some((entry) => entry.name === ".hidden"))
  const second = inspect<VmDirectory>("directory", folder, first.next!)
  assert.equal(second.next, null)
  assert.equal(first.entries.length + second.entries.length, 513)
  assert.equal(existsSync(join(process.cwd(), "PWNED")), false)
  assert.equal(inspect<VmFile>("file", join(folder, unusual)).content, "hello")
})

test("includes staged, renamed, deleted and untracked files and compares against HEAD", () => {
  const statusBefore = git("status", "--porcelain=v1")
  const result = inspect<VmChanges>("changes", repo)
  assert.equal(result.changes.find((file) => file.path.endsWith("/edit.ts"))?.status, "modified")
  assert.equal(result.changes.find((file) => file.path.endsWith("/delete.txt"))?.status, "deleted")
  const renamed = result.changes.find((file) => file.path.endsWith("/renamed.txt"))!
  assert.equal(renamed.status, "renamed")
  assert.equal(renamed.previousPath, join(repo, "rename.txt"))
  assert.equal(result.changes.find((file) => file.path.endsWith("/new file.txt"))?.status, "untracked")
  const edit = inspect<VmFile>("file", join(repo, "edit.ts"))
  assert.equal(edit.before, "original edit.ts\n")
  assert.equal(edit.content, "export const value = 2\n")
  const deleted = inspect<VmFile>("file", join(repo, "delete.txt"))
  assert.equal(deleted.content, null)
  assert.equal(deleted.before, "original delete.txt\n")
  assert.equal(inspect<VmFile>("file", renamed.path).before, "original rename.txt\n")
  assert.equal(inspect<VmFile>("file", join(repo, "new file.txt")).before, null)
  assert.equal(git("status", "--porcelain=v1"), statusBefore)
})

test("discovers project repositories in the workspace and works outside Git", () => {
  assert.deepEqual(inspect<VmChanges>("changes", fixture).repositories, [repo])
  const folder = join(fixture, "plain")
  mkdirSync(folder)
  assert.deepEqual(inspect<VmChanges>("changes", folder).repositories, [])
  writeFileSync(join(folder, "note.txt"), "plain text")
  assert.equal(inspect<VmFile>("file", join(folder, "note.txt")).content, "plain text")
  const output = execFileSync("sh", ["-c", vmFilesCommand("directory", "~/work")], { encoding: "utf8", env: { ...process.env, HOME: fixture } })
  assert.equal((parseVmFiles(output, (value) => value) as VmDirectory).path, fixture)
})

test("bounds large files and Git originals; handles binary files and partial UTF-8", () => {
  const big = inspect<VmFile>("file", join(repo, "large.txt"))
  assert.equal(big.truncated, true)
  assert.equal(big.before?.length, 64000)
  assert.equal(big.content?.length, 64000)
  const binary = join(fixture, "binary")
  writeFileSync(binary, Buffer.from([0, 1, 2]))
  assert.equal(inspect<VmFile>("file", binary).binary, true)
  const unicode = join(fixture, "unicode.txt")
  writeFileSync(unicode, "日".repeat(30000))
  const result = inspect<VmFile>("file", unicode)
  assert.equal(result.binary, false)
  assert.ok(result.content?.startsWith("日日"))
})

test("hides credential files including symlink targets and masks decoded secrets", () => {
  const env = join(fixture, ".env.local")
  writeFileSync(env, "TOKEN=private")
  const linked = join(fixture, "innocent.txt")
  symlinkSync(env, linked)
  for (const path of [env, linked]) {
    const file = inspect<VmFile>("file", path)
    assert.equal(file.content, null)
    assert.match(file.message!, /Credential/)
  }
  const dexConfig = join(fixture, ".config", "dex")
  mkdirSync(dexConfig, { recursive: true })
  writeFileSync(join(dexConfig, "env"), "export DEX_SECRET='private'")
  assert.equal(inspect<VmFile>("file", join(dexConfig, "env")).content, null)
  const secret = 'a"quoted\nsecret'
  const source = join(fixture, "redacted.txt")
  writeFileSync(source, `prefix ${secret} suffix`)
  const file = inspect<VmFile>("file", source, 0, (value) => value.replaceAll(secret, "[redacted]"))
  assert.equal(file.content, "prefix [redacted] suffix")
})

test("rejects special files, invalid paths and missing files without blocking", () => {
  const fifo = join(fixture, "pipe")
  execFileSync("mkfifo", [fifo])
  assert.throws(() => inspect("file", fifo), /regular file/)
  assert.throws(() => inspect("file", "/dev/zero"), /virtual system files/)
  assert.throws(() => inspect("file", join(fixture, "missing")), /no longer exists/)
  assert.throws(() => vmFilesCommand("directory", "bad\0path"), /Invalid file path/)
  assert.throws(() => vmFilesCommand("directory", fixture, -1), /offset/)
  assert.ok(readFileSync(join(repo, "edit.ts"), "utf8").includes("value = 2"))
})
