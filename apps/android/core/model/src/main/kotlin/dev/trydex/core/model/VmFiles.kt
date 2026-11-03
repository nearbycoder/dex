package dev.trydex.core.model

import kotlinx.serialization.Serializable

/**
 * A chat VM's files, as the `vmFiles` callable returns them (apps/web/src/agent/vm-files.ts): a folder, a file with
 * its version in Git HEAD, or the uncommitted Git changes under a folder. Read-only, and it never wakes the VM.
 */
@Serializable
data class VmFileEntry(
    val path: String,
    val name: String = "",
    val directory: Boolean = false,
    val size: Long = 0,
    val modifiedAt: Long = 0,
    val link: Boolean = false,
)

@Serializable
data class VmFileChange(
    val path: String,
    val previousPath: String? = null,
    /** added, modified, deleted, renamed, or untracked. */
    val status: String = "modified",
) {
    /** The letter the web shows beside it (A, M, D, R, U). */
    val letter: String get() = VmFiles.letter(status)
}

@Serializable
data class VmDirectory(
    val path: String,
    val parent: String = "",
    val entries: List<VmFileEntry> = emptyList(),
    /** The offset of the next page (at most 500 entries a page), or null at the end. */
    val next: Int? = null,
)

@Serializable
data class VmChanges(
    val path: String,
    val repositories: List<String> = emptyList(),
    val changes: List<VmFileChange> = emptyList(),
    val truncated: Boolean = false,
)

@Serializable
data class VmFile(
    val path: String,
    val size: Long = 0,
    val modifiedAt: Long? = null,
    /** The text (the first 64 KB), or null when it's binary or deleted. */
    val content: String? = null,
    /** Its text in Git HEAD, when it's in a repository. */
    val before: String? = null,
    /** How it changed since HEAD (a [VmFileChange.status]), or null when it hasn't. */
    val change: String? = null,
    val binary: Boolean = false,
    val truncated: Boolean = false,
    /** Why there's no preview (binary, or a credential file), instead of the content. */
    val message: String? = null,
)

object VmFiles {
    /** Where browsing starts: a chat's projects are cloned here (the agent falls back to home without one). */
    const val HOME = "~/work"

    /** How many unchanged lines a diff keeps around each change, as @pierre/diffs gets from jsdiff. */
    const val CONTEXT = 4

    fun letter(status: String): String = when (status) {
        "added" -> "A"
        "deleted" -> "D"
        "renamed" -> "R"
        "untracked" -> "U"
        else -> "M"
    }

    /** [path] relative to the folder [root], or as it is when it isn't inside it (`relative` in vm-files.tsx). */
    fun relative(root: String, path: String): String {
        val prefix = if (root == "/") "/" else "$root/"
        return if (path.startsWith(prefix)) path.removePrefix(prefix) else path
    }

    fun name(path: String): String = path.trimEnd('/').substringAfterLast('/').ifEmpty { path }

    // ── Diffs ─────────────────────────────────────────────────────────────────
    // A port of jsdiff 9's diffLines and structuredPatch (what @pierre/diffs runs on the web), so a change reads the
    // same here: the same lines paired, the same hunks.

    /** A run of equal, added, or removed lines, each with its line ending. */
    data class Change(val added: Boolean, val removed: Boolean, val lines: List<String>)

    /** A hunk as structuredPatch makes it: lines start with " ", "+", "-", or are "\ No newline at end of file". */
    data class Hunk(val oldStart: Int, val oldLines: Int, val newStart: Int, val newLines: Int, val lines: List<String>)

    /** Lines, each keeping its "\n" (or "\r\n"); a last line without one is kept as it is. */
    fun lines(text: String): List<String> {
        val result = ArrayList<String>()
        var start = 0
        while (start < text.length) {
            val end = text.indexOf('\n', start)
            if (end < 0) {
                result += text.substring(start)
                break
            }
            result += text.substring(start, end + 1)
            start = end + 1
        }
        return result
    }

    private class Component(val count: Int, val added: Boolean, val removed: Boolean, val previous: Component?)

    private class Path(var oldPos: Int, var last: Component?)

    /** jsdiff's Myers diff over lines, with its tie-breaking (prefers removing before adding). */
    fun diffLines(old: String, new: String): List<Change> {
        val oldTokens = lines(old)
        val newTokens = lines(new)
        val oldLen = oldTokens.size
        val newLen = newTokens.size
        val maxEditLength = oldLen + newLen
        val offset = maxEditLength + 1
        val best = arrayOfNulls<Path>(2 * offset + 1)

        fun extractCommon(path: Path, diagonal: Int): Int {
            var oldPos = path.oldPos
            var newPos = oldPos - diagonal
            var common = 0
            while (newPos + 1 < newLen && oldPos + 1 < oldLen && oldTokens[oldPos + 1] == newTokens[newPos + 1]) {
                newPos++
                oldPos++
                common++
            }
            if (common > 0) path.last = Component(common, added = false, removed = false, previous = path.last)
            path.oldPos = oldPos
            return newPos
        }

        fun addToPath(path: Path, added: Boolean, removed: Boolean, oldPosInc: Int): Path {
            val last = path.last
            return if (last != null && last.added == added && last.removed == removed) {
                Path(path.oldPos + oldPosInc, Component(last.count + 1, added, removed, last.previous))
            } else {
                Path(path.oldPos + oldPosInc, Component(1, added, removed, last))
            }
        }

        fun build(last: Component?): List<Change> {
            val components = generateSequence(last) { it.previous }.toList().asReversed()
            var newPos = 0
            var oldPos = 0
            return components.map { component ->
                if (!component.removed) {
                    val lines = newTokens.subList(newPos, newPos + component.count)
                    newPos += component.count
                    if (!component.added) oldPos += component.count
                    Change(component.added, false, lines)
                } else {
                    val lines = oldTokens.subList(oldPos, oldPos + component.count)
                    oldPos += component.count
                    Change(false, true, lines)
                }
            }
        }

        val start = Path(-1, null)
        best[offset] = start
        var newPos = extractCommon(start, 0)
        if (start.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return build(start.last)

        var minDiagonal = Int.MIN_VALUE
        var maxDiagonal = Int.MAX_VALUE
        var editLength = 1
        while (editLength <= maxEditLength) {
            var diagonal = maxOf(minDiagonal, -editLength)
            while (diagonal <= minOf(maxDiagonal, editLength)) {
                val removePath = best[offset + diagonal - 1]
                val addPath = best[offset + diagonal + 1]
                if (removePath != null) best[offset + diagonal - 1] = null
                val canAdd = addPath != null && (addPath.oldPos - diagonal).let { it in 0 until newLen }
                val canRemove = removePath != null && removePath.oldPos + 1 < oldLen
                if (!canAdd && !canRemove) {
                    best[offset + diagonal] = null
                    diagonal += 2
                    continue
                }
                val path = if (!canRemove || (canAdd && removePath!!.oldPos < addPath!!.oldPos)) {
                    addToPath(addPath!!, added = true, removed = false, oldPosInc = 0)
                } else {
                    addToPath(removePath!!, added = false, removed = true, oldPosInc = 1)
                }
                newPos = extractCommon(path, diagonal)
                if (path.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return build(path.last)
                best[offset + diagonal] = path
                if (path.oldPos + 1 >= oldLen) maxDiagonal = minOf(maxDiagonal, diagonal - 1)
                if (newPos + 1 >= newLen) minDiagonal = maxOf(minDiagonal, diagonal + 1)
                diagonal += 2
            }
            editLength++
        }
        return build(null)
    }

    /** jsdiff's structuredPatch hunks between two texts, with [context] unchanged lines around each change. */
    fun hunks(old: String, new: String, context: Int = CONTEXT): List<Hunk> {
        val diff = diffLines(old, new) + Change(added = false, removed = false, lines = emptyList())
        val hunks = ArrayList<Hunk>()
        var oldRangeStart = 0
        var newRangeStart = 0
        var range = ArrayList<String>()
        var oldLine = 1
        var newLine = 1
        for ((i, current) in diff.withIndex()) {
            val lines = current.lines
            if (current.added || current.removed) {
                if (oldRangeStart == 0) {
                    val previous = diff.getOrNull(i - 1)
                    oldRangeStart = oldLine
                    newRangeStart = newLine
                    if (previous != null) {
                        range = if (context > 0) ArrayList(previous.lines.takeLast(context).map { " $it" }) else ArrayList()
                        oldRangeStart -= range.size
                        newRangeStart -= range.size
                    }
                }
                for (line in lines) range += (if (current.added) "+" else "-") + line
                if (current.added) newLine += lines.size else oldLine += lines.size
            } else {
                if (oldRangeStart != 0) {
                    if (lines.size <= context * 2 && i < diff.size - 2) {
                        for (line in lines) range += " $line"
                    } else {
                        val contextSize = minOf(lines.size, context)
                        for (line in lines.take(contextSize)) range += " $line"
                        hunks += Hunk(oldRangeStart, oldLine - oldRangeStart + contextSize, newRangeStart, newLine - newRangeStart + contextSize, range)
                        oldRangeStart = 0
                        newRangeStart = 0
                        range = ArrayList()
                    }
                }
                oldLine += lines.size
                newLine += lines.size
            }
        }
        return hunks.map { hunk ->
            val tidy = ArrayList<String>()
            for (line in hunk.lines) {
                if (line.endsWith("\n")) {
                    tidy += line.dropLast(1)
                } else {
                    tidy += line
                    tidy += NO_NEWLINE
                }
            }
            hunk.copy(lines = tidy)
        }
    }

    const val NO_NEWLINE = "\\ No newline at end of file"

    /** One row of a unified diff on screen. */
    sealed interface Row {
        /** A line: unchanged (both numbers), added (new only), or removed (old only), without its line ending. */
        data class Line(val kind: Kind, val text: String, val oldNumber: Int?, val newNumber: Int?) : Row

        /** Unchanged lines left out between hunks (or before the first, after the last), which can be shown. */
        data class Gap(val oldStart: Int, val newStart: Int, val count: Int) : Row
    }

    enum class Kind { Context, Added, Removed }

    /**
     * A unified diff to show: [hunks] as numbered lines, with the unchanged stretches between them as [Row.Gap]s to
     * expand ("\ No newline" markers are left out; a line that changed only in its ending shows as removed and added).
     */
    fun rows(old: String, new: String, context: Int = CONTEXT): List<Row> {
        val oldCount = lines(old).size
        val rows = ArrayList<Row>()
        var nextOld = 1
        var nextNew = 1
        for (hunk in hunks(old, new, context)) {
            if (hunk.oldStart > nextOld) rows += Row.Gap(nextOld, nextNew, hunk.oldStart - nextOld)
            var oldNumber = hunk.oldStart
            var newNumber = hunk.newStart
            for (line in hunk.lines) {
                val text = line.substring(1).removeSuffix("\r")
                when {
                    line == NO_NEWLINE -> Unit
                    line.startsWith("+") -> rows += Row.Line(Kind.Added, text, null, newNumber++)
                    line.startsWith("-") -> rows += Row.Line(Kind.Removed, text, oldNumber++, null)
                    else -> rows += Row.Line(Kind.Context, text, oldNumber++, newNumber++)
                }
            }
            nextOld = oldNumber
            nextNew = newNumber
        }
        if (rows.isNotEmpty() && oldCount >= nextOld) rows += Row.Gap(nextOld, nextNew, oldCount - nextOld + 1)
        return rows
    }

    /** The unchanged lines a [Row.Gap] stands for, numbered, from the new text. */
    fun expand(gap: Row.Gap, new: String): List<Row.Line> =
        lines(new).drop(gap.newStart - 1).take(gap.count).mapIndexed { i, line ->
            Row.Line(Kind.Context, line.removeSuffix("\n").removeSuffix("\r"), gap.oldStart + i, gap.newStart + i)
        }
}
