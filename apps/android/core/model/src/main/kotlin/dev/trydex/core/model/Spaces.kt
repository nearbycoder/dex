package dev.trydex.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * A space (SpaceProfile in apps/web/src/shared/spaces.ts): one conversation with a coordinator whose job is to start and
 * direct other chats (its threads) for you. Its chat is an ordinary chat ([sessionId]) with extra tools; its threads are
 * ordinary chats with `SessionMeta.spaceId` set.
 */
@Serializable
data class SpaceProfile(
    val id: String,
    val name: String = "",
    /** What the work is for; the coordinator keeps the threads pointed at it. May be empty. */
    val goal: String = "",
    /** The project the threads work in (each gets its own VM with the repos), if any. */
    val projectId: String? = null,
    /** The coordinator's chat. */
    val sessionId: String = "",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

/** Where a thread is, for its card and the space's thread list (ThreadStatus and THREAD_STATUS_LABELS). */
enum class ThreadStatus(val id: String, val label: String) {
    Working("working", "Working"),
    NeedsYou("needs_you", "Needs you"),
    Failed("failed", "Failed"),
    Done("done", "Done"),
    New("new", "Not started"),
}

/** A thread the coordinator started, from its `space_start_thread` result (`details.thread`). */
data class StartedThread(val id: String, val title: String)

/** What the coordinator was told when one thread's run ended (ParsedSpaceUpdate). */
data class SpaceUpdate(val threadId: String, val title: String, val outcome: Outcome, val body: String) {
    enum class Outcome(val id: String) {
        Finished("finished"),
        Failed("failed"),
        Stopped("stopped");

        companion object {
            fun fromId(id: String): Outcome? = entries.firstOrNull { it.id == id }
        }
    }
}

object Spaces {
    const val MAX_NAME = 60
    const val MAX_GOAL = 2_000

    /** The tool the coordinator starts a thread with; its result's `details.thread` is `{ id, title }`. */
    const val START_THREAD_TOOL = "space_start_thread"
    const val UPDATE_PREFIX = "[Space update] "
    const val UPDATE_SEPARATOR = "\n\n---\n\n"

    /** What the empty coordinator chat says. */
    const val EMPTY_HINT = "Tell Dex what to work on. It starts threads for each piece of work and reports back here."

    /** Status order in the thread list: what needs attention first (THREAD_STATUS_ORDER). */
    val ORDER = listOf(ThreadStatus.NeedsYou, ThreadStatus.Working, ThreadStatus.Failed, ThreadStatus.Done, ThreadStatus.New)

    /** The coordinator's notes: a running summary, decisions, and a ledger of the work, kept in the workspace. */
    fun notesPath(id: String) = "/workspace/spaces/$id/NOTES.md"

    /**
     * A thread's status: needs you while it waits on your confirmation; working while it runs; failed when its last reply
     * hit a problem; done once it has replied; new before that.
     */
    fun threadStatus(session: SessionMeta, pending: List<PendingAction> = emptyList()): ThreadStatus = when {
        pending.any { it.sessionId == session.id && it.status == "pending" } -> ThreadStatus.NeedsYou
        session.busy -> ThreadStatus.Working
        session.failed -> ThreadStatus.Failed
        session.repliedAt != null -> ThreadStatus.Done
        else -> ThreadStatus.New
    }

    /** A space's threads: its chats other than the coordinator's, newest first. */
    fun threads(space: SpaceProfile, sessions: List<SessionMeta>): List<SessionMeta> =
        sessions.filter { it.spaceId == space.id && it.id != space.sessionId }.sortedByDescending { it.createdAt }

    /** Threads grouped by status in [ORDER], empty groups left out. */
    fun grouped(threads: List<SessionMeta>, pending: List<PendingAction>): List<Pair<ThreadStatus, List<SessionMeta>>> {
        val byStatus = threads.groupBy { threadStatus(it, pending) }
        return ORDER.mapNotNull { status -> byStatus[status]?.let { status to it } }
    }

    /** A space's row in the chat list: "2 working · 1 needs you", else its goal (first line), else "No threads yet". */
    fun summary(space: SpaceProfile, threads: List<SessionMeta>, pending: List<PendingAction>): String {
        val counts = threads.groupingBy { threadStatus(it, pending) }.eachCount()
        val parts = listOf(ThreadStatus.Working, ThreadStatus.NeedsYou, ThreadStatus.Failed).mapNotNull { status ->
            counts[status]?.let { "$it ${status.label.lowercase()}" }
        }
        return when {
            parts.isNotEmpty() -> parts.joinToString(" · ")
            space.goal.isNotBlank() -> space.goal.trim().lineSequence().first()
            threads.isEmpty() -> "No threads yet"
            else -> "${threads.size} ${if (threads.size == 1) "thread" else "threads"}"
        }
    }

    /** The thread a `space_start_thread` result started, if it says. */
    fun startedThread(details: JsonElement?): StartedThread? {
        val thread = details.obj?.get("thread").obj ?: return null
        val id = thread["id"].str?.takeIf { it.isNotEmpty() } ?: return null
        return StartedThread(id, thread["title"].str ?: "")
    }

    /** The message the coordinator gets when a thread's run ends (spaceUpdate). */
    fun update(threadId: String, title: String, outcome: SpaceUpdate.Outcome, body: String): String =
        "${UPDATE_PREFIX}Thread “${title.replace(Regex("[“”]"), "\"")}” ($threadId) ${outcome.id}." + body.trim().let { if (it.isEmpty()) "" else "\n\n$it" }

    private val updatePattern = Regex("^\\[Space update] Thread “(.*?)” \\(([^)\\s]+)\\) (finished|failed|stopped)\\.(?:\\n\\n([\\s\\S]*))?$")

    /** The thread updates in a coordinator message, or null if it isn't one (parseSpaceUpdates). */
    fun parseUpdates(text: String): List<SpaceUpdate>? {
        if (!text.startsWith(UPDATE_PREFIX)) return null
        return text.split(UPDATE_SEPARATOR).mapNotNull { part ->
            val match = updatePattern.find(part.trim()) ?: return@mapNotNull null
            SpaceUpdate(match.groupValues[2], match.groupValues[1], SpaceUpdate.Outcome.fromId(match.groupValues[3])!!, match.groups[4]?.value ?: "")
        }
    }
}
