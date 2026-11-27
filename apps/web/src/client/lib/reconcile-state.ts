import type { DexState } from "~/shared/protocol"

/** Deep value equality for plain JSON-serializable state structures (fast-path reference equality). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]!
    if (!Object.prototype.hasOwnProperty.call(bo, key) || !jsonEqual(ao[key], bo[key])) return false
  }
  return true
}

/**
 * Reconciles an array of keyed items, reusing identical item references from `prev` and returning `prev` itself when
 * every item and its order match. Makes fine-grained selectors (`sessions.find(s => s.id === id)`) referentially stable
 * across unrelated WebSocket broadcasts.
 */
function reconcileKeyed<T>(
  prev: ReadonlyArray<T> | undefined,
  next: ReadonlyArray<T> | undefined,
  keyOf: (item: T) => string
): ReadonlyArray<T> | undefined {
  if (!next || !prev || prev === next) return next
  if (prev.length === 0 && next.length === 0) return prev
  const byKey = new Map<string, T>()
  for (let i = 0; i < prev.length; i++) byKey.set(keyOf(prev[i]!), prev[i]!)
  let same = prev.length === next.length
  const out = new Array<T>(next.length)
  for (let i = 0; i < next.length; i++) {
    const item = next[i]!
    const prior = byKey.get(keyOf(item))
    if (prior !== undefined && jsonEqual(prior, item)) {
      out[i] = prior
      if (same && prev[i] !== prior) same = false
    } else {
      out[i] = item
      same = false
    }
  }
  return same ? prev : out
}

function reconcileValue<T>(prev: T, next: T): T {
  return jsonEqual(prev, next) ? prev : next
}

/**
 * Structural sharing across `DexState` snapshots received over WebSocket (`JSON.parse` allocates fresh objects on every
 * broadcast). Preserves unchanged slice and entity references so Zustand/useSyncExternalStore selectors skip renders
 * when unrelated sessions, VMs, or settings change.
 */
export function reconcileDexState(prev: DexState | undefined, next: DexState): DexState {
  if (!prev || prev === next) return next
  const sessions = reconcileKeyed(prev.sessions, next.sessions, (s) => s.id) ?? next.sessions
  const vms = reconcileKeyed(prev.vms, next.vms, (v) => v.key) ?? next.vms
  const projects = reconcileKeyed(prev.projects, next.projects, (p) => p.id) ?? next.projects
  const agents = reconcileKeyed(prev.agents, next.agents, (a) => a.id) ?? next.agents
  const characters = reconcileKeyed(prev.characters, next.characters, (c) => c.id) ?? next.characters
  const spaces = reconcileKeyed(prev.spaces, next.spaces, (s) => s.id)
  const vmHelpers = reconcileKeyed(prev.vmHelpers, next.vmHelpers, (h) => `${h.chatId}:${h.vm}`)
  const mcp = reconcileKeyed(prev.mcp, next.mcp, (m) => m.id) ?? next.mcp
  const skills = reconcileKeyed(prev.skills, next.skills, (s) => s.id) ?? next.skills
  const secrets = reconcileKeyed(prev.secrets, next.secrets, (s) => s.name) ?? next.secrets
  const vpns = reconcileKeyed(prev.vpns, next.vpns, (v) => v.id)
  const webhooks = reconcileKeyed(prev.webhooks, next.webhooks, (w) => w.id)
  const pending = reconcileKeyed(prev.access.pending, next.access.pending, (p) => p.id) ?? next.access.pending
  const tokens = reconcileKeyed(prev.access.tokens, next.access.tokens, (t) => t.id) ?? next.access.tokens
  const audit = reconcileValue(prev.access.audit, next.access.audit)
  const access =
    pending === prev.access.pending && tokens === prev.access.tokens && audit === prev.access.audit
      ? prev.access
      : { ...next.access, pending, tokens, audit }

  const reconciled: DexState = {
    cline: reconcileValue(prev.cline, next.cline),
    opencode: reconcileValue(prev.opencode, next.opencode),
    chatgpt: reconcileValue(prev.chatgpt, next.chatgpt),
    commandcode: reconcileValue(prev.commandcode, next.commandcode),
    openrouter: reconcileValue(prev.openrouter, next.openrouter),
    boat: reconcileValue(prev.boat, next.boat),
    settings: reconcileValue(prev.settings, next.settings),
    sessions,
    vms,
    vmConfigured: next.vmConfigured,
    projects,
    github: reconcileValue(prev.github, next.github),
    push: reconcileValue(prev.push, next.push),
    agents,
    characters,
    ...(spaces !== undefined && { spaces }),
    ...(vmHelpers !== undefined && { vmHelpers }),
    mcp,
    access,
    secrets,
    ...(vpns !== undefined && { vpns }),
    skills,
    ...(webhooks !== undefined && { webhooks }),
    ...(next.build !== undefined && { build: next.build }),
    ...(next.models !== undefined && { models: reconcileValue(prev.models, next.models) })
  }

  // If every single top-level field kept its prior reference, return `prev` unchanged.
  if (
    reconciled.cline === prev.cline &&
    reconciled.opencode === prev.opencode &&
    reconciled.chatgpt === prev.chatgpt &&
    reconciled.commandcode === prev.commandcode &&
    reconciled.openrouter === prev.openrouter &&
    reconciled.boat === prev.boat &&
    reconciled.settings === prev.settings &&
    reconciled.sessions === prev.sessions &&
    reconciled.vms === prev.vms &&
    reconciled.vmConfigured === prev.vmConfigured &&
    reconciled.projects === prev.projects &&
    reconciled.github === prev.github &&
    reconciled.push === prev.push &&
    reconciled.agents === prev.agents &&
    reconciled.characters === prev.characters &&
    reconciled.spaces === prev.spaces &&
    reconciled.vmHelpers === prev.vmHelpers &&
    reconciled.mcp === prev.mcp &&
    reconciled.access === prev.access &&
    reconciled.secrets === prev.secrets &&
    reconciled.vpns === prev.vpns &&
    reconciled.skills === prev.skills &&
    reconciled.webhooks === prev.webhooks &&
    reconciled.build === prev.build &&
    reconciled.models === prev.models
  ) {
    return prev
  }
  return reconciled
}
