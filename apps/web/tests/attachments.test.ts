import assert from "node:assert/strict"
import { test } from "node:test"
import { attachmentTag, splitAttachments } from "../src/shared/attachments.ts"

test("a stored file's tag carries its size and key, and the apps read them back", () => {
  const tag = attachmentTag(
    { kind: "file", name: `Song "live".mp3`, mimeType: "audio/mpeg", size: 1234567, key: "dXNlcg/0b6f2e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.mp3" },
    "(A file the user attached.)"
  )
  assert.equal(
    tag,
    `<attachment name="Song &quot;live&quot;.mp3" type="audio/mpeg" size="1234567" key="dXNlcg/0b6f2e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.mp3">\n(A file the user attached.)\n</attachment>`
  )
  const { text, files } = splitAttachments(`Listen to this\n\n${tag}`)
  assert.equal(text, "Listen to this")
  assert.deepEqual(files, [{ name: `Song "live".mp3`, mimeType: "audio/mpeg", key: "dXNlcg/0b6f2e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.mp3" }])
})

test("text and image tags are unchanged and have no key", () => {
  const { files } = splitAttachments(`${attachmentTag({ kind: "text", name: "a.md", mimeType: "text/markdown" }, "# A")}${attachmentTag({ kind: "image", name: "b.png", mimeType: "image/png" })}`)
  assert.deepEqual(files, [
    { name: "a.md", mimeType: "text/markdown" },
    { name: "b.png", mimeType: "image/png" }
  ])
})
