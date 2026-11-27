import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { flattenPath } from "../src/agent/sidekick-face.ts"
import { buildMcpEnvFile, buildMcpRunScript, buildMcpSpawnCommand, buildMcpStopCommand, mcpIsolatedDir, mcpLinuxUser } from "../src/agent/mcp-isolation.ts"
import { parsePeek, peekCommand } from "../src/agent/vm-peek.ts"
import { reconcileDexState } from "../src/client/lib/reconcile-state.ts"
import { splitAttachments } from "../src/shared/attachments.ts"
import { avatarHash, avatarUrl, isAvatarUrl, parseAvatarDataUrl } from "../src/shared/avatars.ts"
import { BUILT_IN_MODELS, createModelCatalog, MODELS } from "../src/shared/models.ts"
import type { DexState } from "../src/shared/protocol.ts"
import { AUDIO_UNLOCK_SCRIPT, withAudioUnlock } from "../src/shared/web-audio.ts"

const fixture = realpathSync(mkdtempSync(join(tmpdir(), "dex-security-")))
after(() => rmSync(fixture, { recursive: true, force: true }))

test("vm-peek blocks credential files, symlinks to secrets, virtual devices, and find flag injection", () => {
  // Attempted GNU find flag injection like "-delete" must never delete anything or execute predicates.
  const victim = join(fixture, "keep.txt")
  writeFileSync(victim, "still here\n")
  const listCmd = peekCommand("files", fixture, 50)
  assert.doesNotMatch(listCmd, /\bfind\b/)
  const listed = parsePeek("files", fixture, execFileSync("sh", ["-c", listCmd], { encoding: "utf8", timeout: 5000 }))
  assert.ok("entries" in listed && listed.entries.some((entry) => entry.name === "keep.txt"))
  assert.equal(existsSync(victim), true)

  // Flag-shaped path fails safely without deleting files.
  execFileSync("sh", ["-c", peekCommand("files", "-delete", 50)], { encoding: "utf8", timeout: 5000 })
  assert.equal(existsSync(victim), true)

  // Sensitive credential files and symlinks pointing to them are rejected.
  const secretFile = join(fixture, ".env.production")
  writeFileSync(secretFile, "SECRET=top-secret\n")
  const symlinked = join(fixture, "harmless.log")
  symlinkSync(secretFile, symlinked)
  const dexConfig = join(fixture, ".config", "dex")
  mkdirSync(dexConfig, { recursive: true })
  const dexEnv = join(dexConfig, "env")
  writeFileSync(dexEnv, "export TOKEN=secret\n")

  for (const blocked of [secretFile, symlinked, dexEnv, "/dev/null"]) {
    assert.throws(
      () => execFileSync("sh", ["-c", peekCommand("file", blocked, 20)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }),
      `expected vm-peek file view to reject ${blocked}`
    )
  }

  // Ordinary file still reads cleanly and respects line clamping.
  const okOut = execFileSync("sh", ["-c", peekCommand("file", victim, 20)], { encoding: "utf8", timeout: 5000 })
  assert.equal(okOut, "still here\n")
})

test("flattenPath terminates on Z followed by stray coordinates and produces finite points on degenerate arcs", () => {
  // Previously `M 0 0 L 10 0 L 10 10 Z 5 5` looped forever because `command` stayed "Z" without advancing `i`.
  assert.throws(() => flattenPath("M 0 0 L 10 0 L 10 10 Z 5 5"))
  const closed = flattenPath("M 0 0 L 10 0 L 10 10 Z")
  assert.equal(closed.length, 1)
  // Degenerate zero-radius and coincident-endpoint arcs must not produce NaN.
  const arcs = flattenPath("M 10 10 A 0 0 0 0 1 20 20 A 5 5 0 1 1 20 20 L 10 20 Z")
  assert.ok(arcs.length >= 1)
  for (const poly of arcs) {
    for (const [x, y] of poly) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y))
    }
  }
})

test("splitAttachments keeps valid media keys and drops traversal or arbitrary keys", () => {
  const validKey = "dXNlcg/0b6f2e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.mp3"
  const malicious = [
    `<attachment name="ok.mp3" type="audio/mpeg" key="${validKey}" />`,
    `<attachment name="up.txt" type="text/plain" key="../etc/passwd" />`,
    `<attachment name="nested.txt" type="text/plain" key="a/../0b6f2e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.txt" />`,
    `<attachment name="query.txt" type="text/plain" key="${validKey}?download=1" />`
  ].join("\n")
  const { files } = splitAttachments(malicious)
  assert.equal(files.length, 4)
  assert.equal(files[0]!.key, validKey)
  assert.equal(files[1]!.key, undefined)
  assert.equal(files[2]!.key, undefined)
  assert.equal(files[3]!.key, undefined)
})

test("withAudioUnlock matches <head> with a word boundary instead of <header>", () => {
  const html = "<html><header><h1>Title</h1></header><head><title>App</title></head><body>Hi</body></html>"
  const out = withAudioUnlock(html)
  assert.ok(out.includes(`<head>${AUDIO_UNLOCK_SCRIPT}<title>App</title></head>`))
  assert.ok(out.includes("<header><h1>Title</h1></header>"))
  // Idempotent when already unlocked.
  assert.equal(withAudioUnlock(out), out)
})

test("createModelCatalog isolates per-agent catalogs without mutating global MODELS", () => {
  const baselineCount = MODELS.length
  const customA = { ...BUILT_IN_MODELS[0]!, id: "commandcode/tenant-a", apiId: "tenant-a", provider: "commandcode" as const, name: "Tenant A" }
  const customB = { ...BUILT_IN_MODELS[0]!, id: "openrouter/tenant-b", apiId: "tenant-b", provider: "openrouter" as const, name: "Tenant B" }
  const catA = createModelCatalog([...BUILT_IN_MODELS, customA])
  const catB = createModelCatalog([...BUILT_IN_MODELS, customB])
  assert.equal(catA.findModel("commandcode/tenant-a")?.name, "Tenant A")
  assert.equal(catA.findModel("openrouter/tenant-b"), undefined)
  assert.equal(catB.findModel("openrouter/tenant-b")?.name, "Tenant B")
  assert.equal(catB.findModel("commandcode/tenant-a"), undefined)
  assert.equal(MODELS.length, baselineCount)
})

test("mcp-isolation builds per-server OS users, mode-0700/0600 paths, and cleanup scripts", () => {
  const userA = mcpLinuxUser("github-123456")
  const userB = mcpLinuxUser("linear-abcdef")
  assert.match(userA, /^dexmcp-[0-9a-f]{12}$/)
  assert.notEqual(userA, userB)
  assert.equal(mcpIsolatedDir("github-123456"), "/var/lib/dex-mcp/github-123456")
  assert.throws(() => mcpLinuxUser("../escape"))

  const envFile = buildMcpEnvFile({ API_KEY: "s'ecret", "BAD-NAME": "ignored" })
  assert.equal(envFile, "API_KEY='s'\\''ecret'\n")

  const runScript = buildMcpRunScript({ command: "npx -y @example/mcp", port: 18080, supergatewayVersion: "3.4.3" })
  assert.match(runScript, /TMPDIR="\$HOME\/tmp"/)
  assert.match(runScript, /chmod 700 "\$TMPDIR"/)
  assert.match(runScript, /--port 18080/)

  const spawn = buildMcpSpawnCommand(
    { serverId: "github-123456", command: "npx -y @example/mcp", port: 18080, supergatewayVersion: "3.4.3", env: { API_KEY: "secret" }, scrubCommand: "true" },
    "/home/user/mcp/github-123456"
  )
  assert.match(spawn, /useradd --system --no-create-home/)
  assert.match(spawn, /install -d -m 700 -o 'dexmcp-/)
  assert.match(spawn, /install -m 600 -o 'dexmcp-/)
  assert.match(spawn, /hidepid=2/)
  assert.match(spawn, /sudo -n -u 'dexmcp-/)

  const dockerSpawn = buildMcpSpawnCommand(
    { serverId: "oci-123456", command: "docker run -i --rm ghcr.io/org/mcp", port: 18081, supergatewayVersion: "3.4.3", env: {}, scrubCommand: "true" },
    "/home/user/mcp/oci-123456"
  )
  assert.doesNotMatch(dockerSpawn, /useradd/)
  assert.match(dockerSpawn, /install -d -m 700 -o user -g user/)

  const stopDelete = buildMcpStopCommand("github-123456", 18080, true)
  assert.match(stopDelete, /pkill -u 'dexmcp-/)
  assert.match(stopDelete, /userdel 'dexmcp-/)
  assert.match(stopDelete, /rm -rf '\/var\/lib\/dex-mcp\/github-123456'/)
})

test("content-addressed avatar URLs validate image data URLs and reject non-image payloads", () => {
  const png = "data:image/png;base64,iVBORw0KGgo="
  const url = avatarUrl("character", "muse-123456", png)!
  assert.equal(url, `/api/avatars/character/muse-123456/${avatarHash(png)}`)
  assert.equal(isAvatarUrl(url, "character"), true)
  assert.equal(isAvatarUrl(url, "project"), false)
  assert.equal(avatarUrl("character", "muse-123456", url), url)
  assert.equal(avatarUrl("character", "muse-123456", null), null)

  const parsed = parseAvatarDataUrl(png)
  assert.ok(parsed && parsed.mimeType === "image/png" && parsed.bytes.byteLength === 8)
  assert.equal(parseAvatarDataUrl("data:text/html;base64,PHNjcmlwdD4="), null)
  assert.equal(isAvatarUrl("/api/avatars/character/../evil/0123456789abcdef"), false)
})

test("reconcileDexState preserves unchanged slices and keyed entity references across broadcasts", () => {
  const base = {
    cline: { connected: true, source: "user", keyHint: "abc", verifiedAt: 1 },
    opencode: { connected: false, source: null, keyHint: null, verifiedAt: null },
    chatgpt: { connected: false, source: null, keyHint: null, verifiedAt: null },
    commandcode: { connected: false, source: null, keyHint: null, verifiedAt: null },
    openrouter: { connected: false, source: null, keyHint: null, verifiedAt: null },
    boat: { connected: true, source: "user", keyHint: "xyz" },
    settings: { defaultModel: "cline-pass/glm-5.3", defaultThinking: "low", instructions: "", vmSize: "small", vmMinutes: 5 },
    sessions: [
      { id: "s1", title: "Chat A", model: "cline-pass/glm-5.3", thinking: "low", createdAt: 1, updatedAt: 1, busy: false, agentId: null, mcpServers: [], projectId: null, characterId: null, muted: false, settledAt: null, snoozedUntil: null },
      { id: "s2", title: "Chat B", model: "cline-pass/glm-5.3", thinking: "low", createdAt: 2, updatedAt: 2, busy: false, agentId: null, mcpServers: [], projectId: null, characterId: null, muted: false, settledAt: null, snoozedUntil: null }
    ],
    vms: [],
    vmConfigured: true,
    projects: [],
    github: { connected: false, login: null },
    push: { configured: false, publicKey: null, devices: [] },
    agents: [],
    characters: [],
    mcp: [],
    access: { tokens: [], pending: [], audit: [] },
    secrets: [],
    skills: []
  } as unknown as DexState

  const cloned = JSON.parse(JSON.stringify(base)) as DexState
  // Identical broadcast returns the exact prior root reference.
  assert.equal(reconcileDexState(base, cloned), base)

  // Updating Chat B keeps Chat A's exact reference and keeps every other top-level slice identical.
  const updated = JSON.parse(JSON.stringify(base)) as DexState
  ;(updated.sessions[1] as { busy: boolean }).busy = true
  const reconciled = reconcileDexState(base, updated)
  assert.notEqual(reconciled, base)
  assert.equal(reconciled.sessions[0], base.sessions[0])
  assert.notEqual(reconciled.sessions[1], base.sessions[1])
  assert.equal(reconciled.settings, base.settings)
  assert.equal(reconciled.vms, base.vms)
  assert.equal(reconciled.projects, base.projects)
  assert.equal(reconciled.access, base.access)
})
