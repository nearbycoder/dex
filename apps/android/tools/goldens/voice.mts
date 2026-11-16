// Writes the voice goldens (core/model's VoiceTest compares against them) from the web's own apps/web/src/shared/voice.ts:
// sentence splitting, the full stop, what of Markdown is read aloud, the streaming cut, and the voice picked from an id.
// It needs nothing installed. Run from the repo root:  node apps/android/tools/goldens/voice.mts
import { mkdirSync, writeFileSync } from "node:fs"
import { finished, sentences, sentenceStream, speakable, voiceOf } from "../../../web/src/shared/voice.ts"

const OUT = new URL("../../core/model/src/test/resources/golden/", import.meta.url)
mkdirSync(OUT, { recursive: true })
const write = (name: string, value: unknown) => writeFileSync(new URL(name, OUT), JSON.stringify(value, null, 1) + "\n")

const texts = [
  "",
  "   ",
  "Hello! This is tiny voca, a small text to speech model that runs on a phone or in a browser.",
  "The meeting moved to 3:30 pm on March 14th, so we have about 45 minutes left.",
  "Did you really think I would forget your birthday? Hey you. What are we making today?",
  "Mr. Smith met Dr. Jones at 5 p.m. on St. Patrick's Day. They talked.",
  "I paid $3.50 for coffee. It was e.g. too much, i.e. a rip-off. Then J. R. R. Tolkien walked in.",
  "She said \"Stop!\" Then she left. (Really.) [Yes.] 'Okay.' Done",
  "Wait… what? No way!! Really?! 42 is the answer. 7 dwarfs.",
  "lowercase after a stop. still one sentence? yes. Yes it is.",
  "MR. BIG arrived. Vs. the rest. etc. And more. no. 5 is a number. Inc. Ltd. Co. done.",
  "Ends without a mark",
  "😀 🎉 ... !!!",
  "Tabs\tand\nnewlines\r\nand nbsp separators. Next one.",
  "A. B. C. D.",
  "U.S. troops arrived. The U.K. too.",
  "It costs 1.5 million. Version 2.0 shipped. Okay.",
  "“Smart quotes.” “Next.” ’Tis fine.",
  "Hello.World. No space after stops.Next."
]

const finishes = [
  "",
  "   ",
  "Hello",
  "Hello.",
  "Hello!",
  "Hello?",
  "Hello…",
  "Hello,",
  "Hello;",
  "Hello:",
  "Hello.\"",
  "Hello!”",
  "Hello?)",
  "(Hello.)",
  "Hello.»",
  "see you :)",
  "see you ;",
  "see you ,",
  "see you :",
  "see you ...",
  "see you !?",
  "see you 😀",
  "see you 🎉!",
  "trailing   ",
  "trailing.   ",
  "  leading words",
  "multi\nline\nend",
  "x",
  "42",
  "42.",
  "end ’",
  "quote\"",
  "she said “hi”"
]

const markdown = [
  "# Heading\n\nSome **bold** and *italic* and __under__ and _em_ and ~~strike~~ text.",
  "Here is code:\n\n```js\nconst x = 1\n```\n\nAnd after it.",
  "Unclosed code\n```python\nprint('hi')",
  "| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter the table.",
  "An image ![alt text](https://example.com/a.png) and a [link to docs](https://docs.example.com/x) here.",
  "Raw url https://example.com/path?x=1 and http://foo.bar too.",
  "Inline `code` stays as code text. <Card title=\"x\" /> gone. <b>bold</b>",
  "- first item\n- second item.\n* third, \n+ fourth :)\n1. numbered\n2) also numbered!\n10. tenth",
  "> quoted line\n> another\n>no space",
  "   ## Indented heading\n####### seven hashes\n#nospace",
  "Line one\n\n\n\nLine two   with    spaces\t\ttabs",
  "**unclosed bold and *mixed* marks\n_a_b_c_ snake_case_name file_name.txt",
  "Text with a footnote[^1].\n\n[^1]: The note.",
  "  \n  leading and trailing whitespace  \n  ",
  "- \n-  \n- item with `code` and [link](x)",
  "Heading\n===\n\nSetext heading above.",
  "Emoji 😀 and **bold 😀** and numbers 3.14.",
  "Mixed\r\nline\rendings here done",
  "1. Step one: open the app\n2. Step two: tap Call\n3. Say hi",
  "A list:\n\n- apples\n- pears\n\nThat's it"
]

/** A reply streaming in pieces, as a call reads it: what each `take` returns, then `rest`. */
const streams = [
  "Hello there. How are you doing today? I hope you're well! Let's get started.",
  "# Plan\n\nFirst, we **open** the app. Then we tap [Call](x). Finally, we talk.\n\n```js\ncode()\n```\n\nDone.",
  "Dr. Smith is here. He says hi. Mr. Brown too",
  "One. Two. Three",
  "- one item\n- two item\n\nAfter the list. End."
]
const chunked = (text: string, size: number) => {
  const pieces: string[] = []
  for (let end = size; end < text.length + size; end += size) pieces.push(text.slice(0, Math.min(end, text.length)))
  return pieces
}

const ids = [
  "",
  "a",
  "atlas",
  "muse",
  "rex",
  "nova",
  "sidekick-1",
  "8f14e45f-ceea-467f-a2a6-2c3b1d2e9f00",
  "Mona's helper",
  "Émile",
  "日本語",
  "😀grin",
  "a😀b🎉c",
  "\ud83d",
  "x".repeat(200),
  "The quick brown fox jumps over the lazy dog"
]

write("voice.json", {
  sentences: texts.map((input) => ({ input, output: sentences(input) })),
  finished: finishes.map((input) => ({ input, output: finished(input) })),
  speakable: markdown.map((input) => ({ input, output: speakable(input) })),
  streams: streams.flatMap((text) =>
    [1, 7, 23].map((size) => {
      const stream = sentenceStream()
      const takes = chunked(text, size).map((partial) => ({ text: partial, taken: stream.take(partial) }))
      return { text, size, takes, rest: stream.rest() }
    })
  ),
  voiceOf: [
    ...ids.map((id) => ({ id, voice: null, output: voiceOf({ id, voice: null }) })),
    { id: "atlas", voice: "M2", output: voiceOf({ id: "atlas", voice: "M2" }) },
    { id: "atlas", voice: "F2", output: voiceOf({ id: "atlas", voice: "F2" }) },
    { id: "atlas", voice: "X9", output: voiceOf({ id: "atlas", voice: "X9" as never }) },
    { id: "muse", voice: "", output: voiceOf({ id: "muse", voice: "" as never }) }
  ]
})

console.log("Voice goldens written to", OUT.pathname)
