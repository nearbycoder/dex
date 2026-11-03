package dev.trydex.fake

import dev.trydex.core.model.VmChanges
import dev.trydex.core.model.VmDirectory
import dev.trydex.core.model.VmFile
import dev.trydex.core.model.VmFileChange
import dev.trydex.core.model.VmFileEntry

/**
 * The files on the demo's running VM, as `vmFiles` shows them: a Git checkout in ~/work/dex with a few uncommitted
 * changes (modified, added, deleted, untracked), a binary, a credential file, and a note outside the repository.
 */
internal class FakeVmFiles(private val now: Long) {
    private class Node(val content: String?, val before: String? = content, val status: String? = null, val binary: Boolean = false)

    private val home = "/home/user"
    private val repo = "$home/work/dex"

    private val serverBefore = """
        |import { Hono } from "hono"
        |import { agent } from "./agent/dex-agent"
        |
        |const app = new Hono()
        |
        |app.get("/health", (c) => c.text("ok"))
        |
        |app.get("/api/sessions", async (c) => {
        |  const sessions = await agent.sessions()
        |  return c.json(sessions)
        |})
        |
        |app.post("/api/sessions", async (c) => {
        |  const body = await c.req.json()
        |  const session = await agent.createSession(body)
        |  return c.json(session, 201)
        |})
        |
        |app.delete("/api/sessions/:id", async (c) => {
        |  await agent.deleteSession(c.req.param("id"))
        |  return c.body(null, 204)
        |})
        |
        |export default app
        |""".trimMargin()

    private val serverAfter = serverBefore
        .replace("app.get(\"/health\", (c) => c.text(\"ok\"))", "app.get(\"/health\", (c) => c.json({ ok: true, build: process.env.BUILD_ID ?? \"dev\", startedAt: new Date(startedAt).toISOString() }))")
        .replace("const app = new Hono()\n", "const app = new Hono()\nconst startedAt = Date.now()\n")
        .replace("  const body = await c.req.json()\n", "  const body = await c.req.json().catch(() => ({}))\n  if (typeof body.title !== \"string\") return c.json({ error: \"A title is required.\" }, 400)\n")

    private val files: Map<String, Node> = linkedMapOf(
        "$repo/README.md" to Node(
            "# Dex\n\nA personal agent harness.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n\nTests: `npm test` (the flaky one is fixed).\n",
            "# Dex\n\nA personal agent harness.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n",
            "modified",
        ),
        "$repo/package.json" to Node("{\n  \"name\": \"dex\",\n  \"private\": true,\n  \"scripts\": {\n    \"dev\": \"vite dev\",\n    \"test\": \"vitest run\"\n  }\n}\n"),
        "$repo/src/server.ts" to Node(serverAfter, serverBefore, "modified"),
        "$repo/src/agent/dex-agent.ts" to Node("export const agent = {\n  async sessions() {\n    return []\n  },\n}\n"),
        "$repo/src/flaky.test.ts" to Node(
            "import { expect, test } from \"vitest\"\n\ntest(\"waits for the clock\", async () => {\n  const start = Date.now()\n  await new Promise((resolve) => setTimeout(resolve, 20))\n  expect(Date.now() - start).toBeGreaterThanOrEqual(20)\n})\n",
            null,
            "added",
        ),
        "$repo/docs/old-notes.md" to Node(null, "# Old notes\n\nThese moved to the wiki.\n", "deleted"),
        "$repo/scripts/deploy.mjs" to Node("#!/usr/bin/env node\nconsole.log(\"Deploying…\")\n", null, "untracked"),
        "$repo/assets/logo.png" to Node(null, null, binary = true),
        "$repo/.env" to Node("API_KEY=secret"),
        "$home/work/notes.txt" to Node("Remember: run the tests twice before calling it fixed.\n"),
    )

    private fun expand(path: String) = when {
        path == "~" -> home
        path.startsWith("~/") -> home + path.removePrefix("~")
        else -> path
    }.trimEnd('/').ifEmpty { "/" }

    /** What's on disk: deleted files are only in Git. */
    private val existing get() = files.filter { (_, node) -> node.content != null || node.binary }.keys

    private fun isFolder(path: String) = path == "/" || existing.any { it.startsWith("$path/") }

    private fun parentOf(path: String) = path.substringBeforeLast('/').ifEmpty { "/" }

    fun directory(raw: String, offset: Int): VmDirectory {
        val path = expand(raw)
        if (!isFolder(path)) error("[Errno 20] Not a directory: '$path'")
        val prefix = if (path == "/") "/" else "$path/"
        val names = existing.filter { it.startsWith(prefix) }
            .map { it.removePrefix(prefix).substringBefore('/') }.distinct()
        val entries = names.map { name ->
            val child = prefix + name
            val node = files[child]
            VmFileEntry(child, name, directory = node == null, size = node?.content?.length?.toLong() ?: if (node?.binary == true) 18_342 else 4096, modifiedAt = now - 3_600_000)
        }.sortedWith(compareBy<VmFileEntry> { !it.directory }.thenBy { it.name.lowercase() })
        return VmDirectory(path, parentOf(path), entries.drop(offset), null)
    }

    fun changes(raw: String): VmChanges {
        val path = expand(raw)
        val inRepo = path == repo || path.startsWith("$repo/")
        val repositories = if (inRepo || parentOf(repo) == path) listOf(repo) else emptyList()
        val changes = if (repositories.isEmpty()) emptyList() else files.filter { it.value.status != null }.map { (file, node) -> VmFileChange(file, null, node.status!!) }
        return VmChanges(path, repositories, changes, truncated = false)
    }

    fun file(raw: String): VmFile {
        val path = expand(raw)
        val node = files[path] ?: error("This file no longer exists.")
        if (path.endsWith("/.env")) return VmFile(path, message = "Credential files are not displayed.")
        if (node.binary) return VmFile(path, size = 18_342, modifiedAt = now - 3_600_000, binary = true, message = "Binary file; source preview is unavailable.")
        val inRepo = path.startsWith("$repo/")
        return VmFile(
            path,
            size = node.content?.length?.toLong() ?: 0,
            modifiedAt = if (node.content != null) now - 600_000 else null,
            content = node.content,
            before = if (inRepo && node.status != "untracked") node.before else null,
            change = node.status,
        )
    }
}
