import assert from "node:assert/strict"
import { test } from "node:test"
import { finished, sentences, sentenceStream, speakable, voiceOf } from "../src/shared/voice.ts"

const reply = `Sure! Here's the **plan**:\n\n1. Wake up at 7 a.m. and stretch.\n2. Read [the docs](https://x.y) for Dr. Smith.\n\n\`\`\`js\nconsole.log(1)\n\`\`\`\n| a | b |\n|---|---|\nThat's it. See https://example.com for more`

test("speakable keeps what can be heard", () => {
  assert.equal(speakable(reply).replace(/\s+/g, " "), "Sure! Here's the plan: Wake up at 7 a.m. and stretch. Read the docs for Dr. Smith. That's it. See a link for more")
})

test("sentences don't break after titles, initials, or times", () => {
  assert.deepEqual(sentences("Ask Dr. Smith. It's at 7 a.m. Today! J. R. R. Tolkien wrote it. 3.5 percent."), [
    "Ask Dr. Smith.",
    "It's at 7 a.m. Today!",
    "J. R. R. Tolkien wrote it.",
    "3.5 percent."
  ])
})

test("finished adds a full stop only where the text has no mark", () => {
  assert.equal(finished("Hi there"), "Hi there.")
  assert.equal(finished("Wait,"), "Wait,")
  assert.equal(finished("see you :)"), "see you :).")
  assert.equal(finished("Really?”"), "Really?”")
})

test("a streamed reply is cut into the same sentences as the whole one, each once", () => {
  for (const step of [1, 3, 7, 40]) {
    const stream = sentenceStream()
    const said: string[] = []
    for (let end = step; end < reply.length; end += step) said.push(...stream.take(reply.slice(0, end)))
    said.push(...stream.rest(reply))
    assert.deepEqual(said, sentences(speakable(reply)), `in steps of ${step}`)
  }
})

test("voiceOf keeps a chosen voice and picks one from the id otherwise", () => {
  assert.equal(voiceOf({ id: "anything", voice: "F2" }), "F2")
  assert.equal(voiceOf({ id: "muse-abc123" }), voiceOf({ id: "muse-abc123", voice: null }))
  const picked = new Set(Array.from({ length: 20 }, (_, index) => voiceOf({ id: `sidekick-${index}` })))
  assert.deepEqual([...picked].sort(), ["F2", "M2"])
})
