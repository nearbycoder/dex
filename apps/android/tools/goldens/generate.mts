// Writes the golden files the Kotlin unit tests compare against, by running the web app's own code on fixed inputs.
// Run from the repo root after `npm install`:  TZ=America/Chicago node apps/android/tools/goldens/generate.mts
import { mkdirSync, writeFileSync } from "node:fs"
import { Predicate } from "effect"
import { load } from "./extract.mts"
import { applyEvent, displayItems, emptyTranscript, fromSnapshot, toolResults } from "../../../web/src/client/lib/transcript.ts"
import { formatBytes, timeAgo } from "../../../web/src/client/lib/format.ts"
import { BUILT_IN_MODELS, clampThinking, daysSinceRelease, findModel, isNewModel, NEW_MODEL_DAYS, supportedThinkingLevels, THINKING_LEVELS, usableModel } from "../../../web/src/shared/models.ts"
import { MEDIA_PREFIX, mediaTypeOf, vmMediaLinks, vmMediaSource } from "../../../web/src/shared/media.ts"
import { githubFullName, normalizeRepoUrl, repoDirName, repoLabel } from "../../../web/src/shared/projects.ts"
import { formatInstalls, invokedSkill, skillSlug } from "../../../web/src/shared/skills.ts"
import { splitUiNotes } from "../../../web/src/shared/ui-notes.ts"
import { attachmentSummary, attachmentTag, splitAttachments } from "../../../web/src/shared/attachments.ts"
import { BODIES, cleanLook, EXTRAS, EYES, LOOK_PRESETS, MOUTHS, sidekickSvg, SKINS } from "../../../web/src/shared/sidekick-look.ts"
import { AGENT_COLORS } from "../../../web/src/shared/agents.ts"
// The jsdiff that @pierre/diffs (the web's Files panel) diffs with.
import { structuredPatch } from "../../../../node_modules/@pierre/diffs/node_modules/diff/libesm/index.js"

const OUT = new URL("../../core/model/src/test/resources/golden/", import.meta.url)
mkdirSync(OUT, { recursive: true })
const write = (name: string, value: unknown) => writeFileSync(new URL(name, OUT), JSON.stringify(value, null, 1) + "\n")

// A fixed clock, so relative times are the same every run.
const NOW = Date.UTC(2026, 9, 19, 22, 8, 30) // Mon Oct 19 2026, 5:08:30 PM in Chicago
// `new Date()` doesn't read Date.now, so the clock is replaced whole: no-argument Dates use the fake now too.
const RealDate = Date
let fakeNow = NOW
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fakeNow)
    else super(...(args as [number]))
  }
  static now() {
    return fakeNow
  }
}
globalThis.Date = FakeDate as DateConstructor

const { videoSource } = load("client/components/media.tsx", ["DIRECT_VIDEO", "videoSource"], { MEDIA_PREFIX, mediaTypeOf, vmMediaSource })
const { summarize, toolActivity } = load("client/components/tool-card.tsx", ["summaryKeys", "summarize", "toolActivity", "activities"], { Predicate })
const { inboxState, snoozeOptions, snoozedLabel } = load("client/components/session-menu.tsx", ["inboxState", "at", "when", "snoozeOptions", "snoozedLabel"])
const { formatTokens, releaseLabel, PERIODS, WITHIN } = load("client/components/model-picker.tsx", ["formatTokens", "releaseLabel", "PERIODS", "WITHIN"])
const { usd, compact } = load("routes/_app.usage.tsx", ["usd", "compact"])

// ── Formatting ───────────────────────────────────────────────────────────────

const offsets = [0, 5_000, 59_000, 60_000, 89_000, 90_000, 3_569_000, 3_570_000, 3_600_000, 7_200_000, 86_399_000, 86_400_000,
  172_800_000, 2_592_000_000, 5_184_000_000, 31_536_000_000, 63_072_000_000]
write("format.json", {
  now: NOW,
  timeAgo: offsets.flatMap((offset) => [NOW - offset, NOW + offset]).map((at) => ({ at, text: timeAgo(at) })),
  bytes: [0, 1, 512, 1023, 1024, 1536, 10_240, 1_048_575, 1_048_576, 5_242_880, 1_288_490_189].map((value) => ({ value, text: formatBytes(value) })),
  installs: [0, 7, 999, 1000, 1234, 1250, 9_999, 10_000, 12_345, 999_999, 1_000_000, 2_500_000, 12_345_678].map((value) => ({ value, text: formatInstalls(value) })),
  tokens: [8_192, 32_768, 128_000, 131_072, 200_000, 262_144, 500_000, 999_999, 1_000_000, 1_048_576, 1_050_000, 2_000_000].map((value) => ({ value, text: formatTokens(value) })),
  usd: [0, 0.001, 0.004, 0.005, 0.01, 0.015, 0.125, 1.005, 3.14159, 9.99, 99.994, 99.996, 100, 1234.5, 98765.4].map((value) => ({ value, text: usd(value) })),
  compact: [0, 7, 950, 999, 1000, 1234, 1250, 1950, 9_999, 12_345, 99_950, 999_999, 1_000_000, 3_456_789, 1_500_000_000].map((value) => ({ value, text: compact(value) }))
})

// ── Models ───────────────────────────────────────────────────────────────────

const connections = [
  { clinepass: true, "opencode-go": true, chatgpt: false, commandcode: false },
  { clinepass: true, "opencode-go": false, chatgpt: false, commandcode: false },
  { clinepass: false, "opencode-go": true, chatgpt: false, commandcode: false },
  { clinepass: false, "opencode-go": false, chatgpt: false, commandcode: false },
  { clinepass: false, "opencode-go": false, chatgpt: true, commandcode: false },
  { clinepass: false, "opencode-go": true, chatgpt: true, commandcode: false },
  { clinepass: true, "opencode-go": true, chatgpt: true, commandcode: false },
  // Command Code has no built-in models, so a chat moved onto it alone keeps its model.
  { clinepass: false, "opencode-go": false, chatgpt: false, commandcode: true },
  { clinepass: false, "opencode-go": false, chatgpt: true, commandcode: true },
  { clinepass: true, "opencode-go": true, chatgpt: true, commandcode: true }
]
write("models.json", {
  models: BUILT_IN_MODELS.map((model) => ({
    id: model.id,
    supported: supportedThinkingLevels(model),
    clamped: Object.fromEntries(THINKING_LEVELS.map((level) => [level, clampThinking(model, level)])),
    usable: connections.map((connected) => usableModel(model.id, connected))
  })),
  unknown: { supported: supportedThinkingLevels(findModel("nope/none")), usable: connections.map((connected) => usableModel("opencode-go/retired", connected)), chatgptUsable: connections.map((connected) => usableModel("chatgpt/retired", connected)),
    // Command Code's apiIds carry their maker, so its ids have two slashes; an unlisted one goes by its prefix.
    commandcodeUsable: connections.map((connected) => usableModel("commandcode/deepseek/retired", connected)) },
  connections
})

// Release dates: days since, the New badge, and the row's label, at the fixed clock and just before its midnight.
const releases = [undefined, "", "soon", "2026-10-19", "2026-10-18", "2026-10-12", "2026-10-05", "2026-10-04", "2026-09-19", "2026-07-21",
  "2026-07-20", "2026-01-01", "2025-12-31", "2025-03-14", "2026-10-20", "2026-12-25", "2026-10-19T23:59:59Z", "2026-02-30", "2026-04-31",
  "2026-13-01", "2026-10-00", "2026-10-32", "2026-1-5", "20261019", "1969-12-31"]
write("releases.json", {
  newDays: NEW_MODEL_DAYS,
  nows: [NOW, Date.UTC(2026, 9, 19, 23, 59, 59, 999), Date.UTC(2027, 0, 1)],
  cases: releases.map((releasedAt) => ({
    releasedAt: releasedAt ?? null,
    at: [NOW, Date.UTC(2026, 9, 19, 23, 59, 59, 999), Date.UTC(2027, 0, 1)].map((now) => {
      fakeNow = now
      return { days: daysSinceRelease({ releasedAt }, now) ?? null, isNew: isNewModel({ releasedAt }, now), label: releaseLabel({ releasedAt }) ?? null }
    })
  })),
  periods: PERIODS.map((period: { days: number; label: string }) => ({ days: Number.isFinite(period.days) ? period.days : null, label: period.label })),
  within: WITHIN
})
fakeNow = NOW

// ── Tools, skills, UI notes ──────────────────────────────────────────────────

const toolNames = ["bash", "read_file", "web_search", "vm_exec", "vm_screenshot", "share_media", "app_call", "use_skill", "github__create_issue", "custom_tool", "render_ui"]
const argCases = [
  {}, { command: "npm test\n--watch" }, { path: "/workspace/notes.md" }, { query: "" , url: "https://example.com" }, { prompt: "hi" },
  { name: "deploy", id: "x" }, { operation: "app_list_sessions" }, { count: 3, deep: { a: [1, 2] } }, "not an object", null,
  { long: "x".repeat(200) }
]
write("tools.json", {
  activity: toolNames.map((name) => ({ name, text: toolActivity(name) })),
  summarize: argCases.map((args) => ({ args, text: summarize(args) })),
  invoked: ["/review this", "  /deploy", "/Deploy now", "/a-b-c", "/x", "no /skill", "/bad_name x", "/" + "a".repeat(70), "/ok\nnext"].map((text) => ({ text, skill: invokedSkill(text) })),
  slug: ["Release Notes!", "  --Hello__World--  ", "ÄÖÜ ok", "a".repeat(80), ""].map((text) => ({ text, slug: skillSlug(text) })),
  uiNotes: [
    "plain message",
    "[Done in this chat's UI since my last message]\n- Ran app_stop_vm\n- Saved a filter\n\nWhat changed?",
    "[Done in this chat's UI since my last message]\n- Only notes"
  ].map((input) => ({ input, ...splitUiNotes(input) }))
})

// ── Media and repos ──────────────────────────────────────────────────────────

const urls = [
  "/api/media/user-x/0b4f2c3e-1111-2222-3333-444455556666.mp4", "/api/media/user-x/a.png", "/api/media/user-x/a.txt",
  "https://abc-def-3000.on.boat.dev/out/demo.mp4?_token=secret", "https://abc-3000.on.boat.dev/shot.PNG", "https://abc-3000.on.boat.dev/page.html",
  "http://abc-3000.on.boat.dev/demo.mp4", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
  "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/embed/abc", "https://vimeo.com/123456789",
  "https://player.vimeo.com/video/76979871/", "https://vimeo.com/channels/staff", "https://example.com/clip.webm", "https://example.com/clip.MOV?x=1",
  "http://example.com/clip.mp4", "https://example.com/page", "not a url", "mailto:a@b.c"
]
write("media.json", {
  sources: urls.map((url) => ({ url, source: videoSource(url) })),
  vmLinks: [
    "See https://abc-3000.on.boat.dev/a.mp4 and https://abc-3000.on.boat.dev/a.mp4?_token=1 and (https://xyz-8080.on.boat.dev/img/b.png).",
    "Nothing here https://example.com/a.mp4"
  ].map((text) => ({ text, links: vmMediaLinks(text) })),
  repos: ["owner/repo", "github.com/owner/repo.git", "https://github.com/owner/repo", "https://github.com/owner/repo.git/", "https://gitlab.com/team/app.git",
    "https://user:pw@github.com/a/b", "http://github.com/a/b", "https://github.com/onlyowner", "nonsense", " owner/repo/ "].map((input) => {
    const url = normalizeRepoUrl(input)
    return { input, url, label: repoLabel(url ?? input), dir: repoDirName(url ?? input), fullName: url ? githubFullName(url) : null }
  })
})

// ── Inbox ────────────────────────────────────────────────────────────────────

const days = [0, 1, 2, 3, 4, 5, 6].map((day) => NOW + day * 86_400_000)
const hours = [8, 16, 17, 22]
write("inbox.json", {
  zone: "America/Chicago",
  snooze: days.flatMap((day) =>
    hours.map((hour) => {
      const now = new Date(day)
      now.setHours(hour, 15, 0, 0)
      fakeNow = now.getTime()
      const options = snoozeOptions(now).map((option) => ({ label: option.label, at: option.at.getTime(), until: snoozedLabel(option.at.getTime()) }))
      return { now: now.getTime(), options }
    })
  ),
  states: [
    { snoozedUntil: NOW + 1000, settledAt: null },
    { snoozedUntil: NOW - 1000, settledAt: NOW - 5000 },
    { snoozedUntil: null, settledAt: NOW - 5000 },
    { snoozedUntil: null, settledAt: null },
    { snoozedUntil: NOW + 1000, settledAt: NOW }
  ].map((session) => ({ ...session, state: inboxState(session as never, NOW) }))
})
fakeNow = NOW

// ── Transcript ───────────────────────────────────────────────────────────────

const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  role: "assistant", content, api: "openai-completions", provider: "clinepass", model: "glm-5.3", usage, stopReason: "stop", timestamp: NOW - 60_000, ...extra
})
const user = (id: number, text: string) => ({ id, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: text, timestamp: NOW - 70_000 }] })
const entry = (id: number, kind: string, message: unknown) => ({ id, conversationId: 1, kind, model: [message] })

const snapshot = {
  type: "snapshot",
  entries: [
    { id: 1, conversationId: 1, kind: "pi.system", model: [] },
    user(2, "Summarize the repo"),
    entry(3, "pi.assistant", assistant([{ type: "thinking", thinking: "Let me look.\n**Plan**: read files" }, { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls -la\npwd" } }], { stopReason: "toolUse", durationMs: 2_000 })),
    entry(4, "pi.toolResult", { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "README.md\nsrc" }], isError: false, timestamp: NOW - 55_000 }),
    entry(5, "pi.assistant", assistant([{ type: "text", text: "It has a README and src." }], { timestamp: NOW - 54_000, durationMs: 1_500 })),
    { id: 6, conversationId: 1, kind: "pi.compaction", model: [{ role: "user", content: "Summary of earlier messages", timestamp: NOW - 50_000 }] },
    { id: 7, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text: "[Done in this chat's UI since my last message]\n- Ran x\n\nAnd now?" }, { type: "image", data: "", mimeType: "image/png", ref: "7:0:1" }], timestamp: NOW - 40_000 }] }
  ],
  tools: [],
  nestedTools: [],
  compactions: [],
  inbox: [],
  agent: {},
  usage: {}
}

const batches = [
  [snapshot],
  [{ type: "run_start", inputs: [9] }, { type: "inbox_update", items: [{ id: 9, mode: "followUp" }] }],
  [{ type: "message_start", message: assistant([], { timestamp: NOW - 30_000, stopReason: "pending" }) }],
  [{ type: "message_update", usage, changes: [{ type: "thinking_start", contentIndex: 0, block: { type: "thinking", thinking: "" } }, { type: "thinking_delta", contentIndex: 0, delta: "Checking " }, { type: "thinking_delta", contentIndex: 0, delta: "the tests" }] }],
  [{ type: "message_update", usage, changes: [{ type: "toolcall_start", contentIndex: 1, block: { type: "toolCall", id: "call_2", name: "vm_exec", arguments: {} } }, { type: "toolcall_delta", contentIndex: 1, path: ["command"], delta: "npm " }, { type: "toolcall_delta", contentIndex: 1, path: ["command"], delta: "test" }, { type: "toolcall_delta", contentIndex: 1, path: ["options", "env", "CI"], delta: "1" }] }],
  [{ type: "message_end", entry: entry(8, "pi.assistant", assistant([{ type: "thinking", thinking: "Checking the tests" }, { type: "toolCall", id: "call_2", name: "vm_exec", arguments: { command: "npm test" } }], { timestamp: NOW - 30_000, durationMs: 4_000, stopReason: "toolUse" })) }],
  [{ type: "tool_execution_start", toolCallId: "call_2", toolName: "vm_exec", args: { command: "npm test" } }, { type: "tool_execution_start", toolCallId: "call_2/1", toolName: "inner", parentToolCallId: "call_2", args: {} }],
  [{ type: "tool_execution_update", toolCallId: "call_2", toolName: "vm_exec", output: { append: "PASS a\n" } }, { type: "tool_execution_update", toolCallId: "call_2", toolName: "vm_exec", output: { trimStart: 2, append: "PASS b\n" }, details: { pid: 4 } }],
  [{ type: "tool_execution_update", toolCallId: "call_2", toolName: "vm_exec", output: { set: "all passed\n" } }, { type: "auto_retry_start", attempt: 1, at: NOW + 5_000, errorMessage: "429 rate limited" }],
  [{ type: "tool_execution_end", toolCallId: "call_2", toolName: "vm_exec", entry: entry(9, "pi.toolResult", { role: "toolResult", toolCallId: "call_2", toolName: "vm_exec", content: [{ type: "text", text: "all passed" }], isError: false, timestamp: NOW - 20_000 }) }, { type: "auto_retry_end", attempt: 1 }],
  [{ type: "message_start", message: { role: "user", content: "ignored", timestamp: NOW } }, { type: "message_start", message: assistant([], { timestamp: NOW - 15_000, stopReason: "pending" }) }, { type: "message_update", usage, changes: [{ type: "text_start", contentIndex: 0, block: { type: "text", text: "" } }, { type: "text_delta", contentIndex: 0, delta: "All tests " }, { type: "text_delta", contentIndex: 0, delta: "pass." }, { type: "text_delta", contentIndex: 3, delta: "lost" }] }],
  [{ type: "entry_appended", entry: entry(9, "pi.toolResult", { role: "toolResult", toolCallId: "dup", toolName: "x", content: [], timestamp: NOW }) }, { type: "turn_end" }, { type: "usage_changed", usage: {} }],
  [{ type: "message_update", usage, changes: [{ type: "message", message: assistant([{ type: "text", text: "All tests pass. Done." }], { timestamp: NOW - 15_000, stopReason: "pending" }) }] }],
  [{ type: "message_end", entry: entry(10, "pi.assistant", assistant([{ type: "text", text: "All tests pass. Done." }], { timestamp: NOW - 15_000, durationMs: 3_000 })) }, { type: "task_failed", taskId: 3, kind: "x", message: "Something broke" }],
  [{ type: "run_end", inputs: [9] }, { type: "inbox_update", items: [] }]
]

let state = emptyTranscript
const steps = batches.map((events) => {
  state = events.reduce(applyEvent as never, state)
  return {
    events,
    state: {
      entries: state.entries.map((e) => e.id),
      streaming: state.streaming,
      tools: state.tools,
      running: state.running,
      queued: state.queued,
      retry: state.retry,
      error: state.error,
      loaded: state.loaded
    },
    items: displayItems(state).map((item) =>
      item.kind === "assistant"
        ? { kind: item.kind, id: item.id, streaming: item.streaming, endedAt: item.endedAt, messages: item.messages.length, blocks: item.messages.flatMap((m) => m.content.map((b) => b.type)) }
        : item
    ),
    results: [...toolResults(state.entries).keys()]
  }
})
const midSnapshot = { ...snapshot, run: { inputs: [1] }, generation: { attempt: 1, message: assistant([{ type: "text", text: "partial" }]), retry: { at: NOW, error: "busy" } }, tools: [{ callId: "c", name: "bash", status: "running", output: "out" }], inbox: [{ id: 1, mode: "steer" }] }
const mid = fromSnapshot(midSnapshot as never)
write("transcript.json", {
  steps,
  midRun: { snapshot: midSnapshot, running: mid.running, streaming: mid.streaming, retry: mid.retry, tools: mid.tools, queued: mid.queued }
})

// ── Attachments ──────────────────────────────────────────────────────────────

const pdf = { kind: "text" as const, name: "Q3 report.pdf", mimeType: "application/pdf", converted: true }
const notes = { kind: "text" as const, name: "notes \"draft\" <1>.md", mimeType: "text/markdown", truncated: true }
const photo = { kind: "image" as const, name: "IMG_0036.png", mimeType: "image/png" }
const attachmentCases = [
  "plain message, no files",
  `What does this say?\n${attachmentTag(pdf, "# Q3\nRevenue up 12%.")}`,
  `${attachmentTag(notes, "line one\n\n\n\nline two")}`,
  `Look at this\n${attachmentTag(photo)}`,
  `${attachmentTag(photo)}\n${attachmentTag(pdf, "text")}\n\n\n\nAnd these two`,
  attachmentTag(photo, "(An image the user attached. This chat's model reads text only, so it can't see it.)"),
  '<attachment name="broken" type="text/plain">no closing tag',
  "  spaced text with no tags  "
]
const attachmentEntries = [
  { id: 1, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: attachmentCases[1], timestamp: NOW - 30_000 }] },
  {
    id: 2,
    conversationId: 1,
    kind: "pi.user",
    model: [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these" },
          { type: "text", text: attachmentTag(photo) },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          { type: "text", text: attachmentTag({ ...photo, name: "big.jpg", mimeType: "image/jpeg" }) },
          { type: "image", data: "", mimeType: "image/jpeg", ref: "2:0:4" },
          { type: "text", text: attachmentTag(pdf) }
        ],
        timestamp: NOW - 20_000
      }
    ]
  }
]
const attachmentSnapshot = { ...snapshot, entries: attachmentEntries }
const withAttachments = fromSnapshot(attachmentSnapshot as never)
write("attachments.json", {
  snapshot: attachmentSnapshot,
  split: attachmentCases.map((input) => ({ input, ...splitAttachments(input) })),
  summary: [[], ["a.png"], ["a.png", "b.pdf"], ["a.png", "b.pdf", "c.txt"]].map((names) => ({ names, text: attachmentSummary(names.map((name) => ({ name }))) })),
  items: displayItems(withAttachments)
})

// ── VM files ─────────────────────────────────────────────────────────────────

const { relative } = load("client/components/vm-files.tsx", ["relative"])
const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}\n`).join("")
const diffCases: Array<[string, string]> = [
  ["", ""],
  ["", "x\ny\n"],
  ["x\ny\n", ""],
  ["a\nb\nc\n", "a\nB\nc\n"],
  ["a\nb\nc", "a\nb\nc\nd"],
  ["a\nb\nc\n", "a\nb\nc"],
  ["a\r\nb\r\n", "a\r\nc\r\n"],
  [base, base.replace("line 3\n", "line three\n").replace("line 25\n", "")],
  [base, base.replace("line 10\n", "line ten\n").replace("line 13\n", "line 13\nnew\n")],
  [base, "header\n" + base + "footer\n"],
  ["one\ntwo\nthree\nfour\n", "four\nthree\ntwo\none\n"],
  ["same\nsame\nsame\n", "same\nother\nsame\nsame\nsame\n"],
  ["fun a() {\n  return 1\n}\n\nfun b() {\n  return 2\n}\n", "fun a() {\n  return 1\n}\n\nfun c() {\n  return 3\n}\n\nfun b() {\n  return 2\n}\n"]
]
write("vmfiles.json", {
  relative: [["/home/u/work", "/home/u/work/dex/src/a.ts"], ["/home/u/work", "/home/u/workshop/a"], ["/", "/etc/hosts"], ["/home/u/work", "/home/u/work"]]
    .map(([root, path]) => ({ root, path, text: relative(root, path) })),
  diffs: diffCases.map(([before, after]) => ({ before, after, hunks: structuredPatch("a", "b", before, after, undefined, undefined, { context: 4 }).hunks }))
})

// ── Sidekick looks ───────────────────────────────────────────────────────────

const background = (color: string) => AGENT_COLORS[color as keyof typeof AGENT_COLORS][0]
const lookVariants = [
  ...BODIES.map((body) => ({ ...LOOK_PRESETS[0]!.look, body })),
  ...EYES.map((eyes) => ({ ...LOOK_PRESETS[1]!.look, eyes })),
  ...MOUTHS.map((mouth) => ({ ...LOOK_PRESETS[2]!.look, mouth })),
  ...EXTRAS.flatMap((extra) => BODIES.map((body) => ({ ...LOOK_PRESETS[4]!.look, body, extra }))),
  ...Object.keys(SKINS).map((skin) => ({ ...LOOK_PRESETS[5]!.look, skin, blush: !LOOK_PRESETS[5]!.look.blush }))
]
write("sidekicks.json", {
  presets: LOOK_PRESETS.map((preset) => ({ key: preset.key, background: background(preset.color), svg: sidekickSvg(preset.look, background(preset.color)) })),
  looks: lookVariants.map((look, i) => {
    const color = Object.keys(AGENT_COLORS)[i % 8]!
    return { look, background: background(color), svg: sidekickSvg(look, background(color)) }
  }),
  clean: [{}, { body: "cube", skin: "teal", eyes: "visor", mouth: "o", extra: "crown", blush: true }, { body: "dragon", skin: "plaid", eyes: "laser", mouth: "", extra: "cape", blush: false }]
    .map((input) => ({ input, look: cleanLook(input) }))
})

console.log("Goldens written to", OUT.pathname)
