package dev.trydex.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.ceil

/** The chat list works like an inbox: chats you settle or snooze move out of it until something new happens. */
enum class InboxState { Inbox, Snoozed, Settled }

fun inboxState(session: SessionMeta, now: Long): InboxState = when {
    session.snoozedUntil != null && session.snoozedUntil > now -> InboxState.Snoozed
    session.settledAt != null -> InboxState.Settled
    else -> InboxState.Inbox
}

data class InboxGroups(val inbox: List<SessionMeta>, val snoozed: List<SessionMeta>, val settled: List<SessionMeta>) {
    val isEmpty: Boolean get() = inbox.isEmpty() && snoozed.isEmpty() && settled.isEmpty()
}

/** Inbox in the agent's order (newest activity first), Snoozed soonest first, Settled most recently settled first. */
fun inboxGroups(sessions: List<SessionMeta>, now: Long): InboxGroups {
    val byState = sessions.groupBy { inboxState(it, now) }
    return InboxGroups(
        inbox = byState[InboxState.Inbox].orEmpty(),
        snoozed = byState[InboxState.Snoozed].orEmpty().sortedBy { it.snoozedUntil ?: 0 },
        settled = byState[InboxState.Settled].orEmpty().sortedByDescending { it.settledAt ?: 0 },
    )
}

data class SnoozeOption(val label: String, val at: Long)

object Snooze {
    private fun at(base: ZonedDateTime, days: Long, hour: Int): ZonedDateTime =
        base.toLocalDate().plusDays(days).atTime(hour, 0).atZone(base.zone)

    /** The snooze menu's presets, in local time (snoozeOptions on the web). */
    fun options(now: Long, zone: ZoneId = ZoneId.systemDefault()): List<SnoozeOption> {
        val current = Instant.ofEpochMilli(now).atZone(zone)
        val options = mutableListOf(SnoozeOption("In 1 hour", now + 60 * 60_000))
        val evening = at(current, 0, 18).toInstant().toEpochMilli()
        if (evening - now > 90 * 60_000) options += SnoozeOption("This evening", evening)
        options += SnoozeOption("Tomorrow", at(current, 1, 9).toInstant().toEpochMilli())
        // JavaScript's getDay: 0 = Sunday … 6 = Saturday.
        val day = current.dayOfWeek.value % 7
        if (day in 1..4) options += SnoozeOption("This weekend", at(current, (6 - day).toLong(), 9).toInstant().toEpochMilli())
        val toMonday = ((8 - day) % 7).let { if (it == 0) 7 else it }
        options += SnoozeOption("Next week", at(current, toMonday.toLong(), 9).toInstant().toEpochMilli())
        return options
    }

    /** "6:00 PM" today, else "Mon 9:00 AM". */
    fun whenLabel(millis: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
        val date = Instant.ofEpochMilli(millis).atZone(zone)
        val today: LocalDate = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val time = Format.timeOfDay(millis, zone)
        return if (date.toLocalDate() == today) time else "${date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.US)} $time"
    }

    fun untilLabel(millis: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()) =
        "until ${whenLabel(millis, now, zone)}"
}

object Vms {
    fun statusLabel(status: VmStatus): String = when (status) {
        VmStatus.None -> "No VM yet"
        VmStatus.Starting -> "Starting"
        VmStatus.Running -> "Running"
        VmStatus.Stopping -> "Stopping"
        VmStatus.Stopped -> "Stopped · disk saved"
        VmStatus.Error -> "Error"
    }

    /** "in use", "stops when idle in 3 min", or "idle, stopping any moment now". */
    fun idleText(vm: VmInfo, minutes: Int, now: Long): String {
        if (vm.busy) return "in use"
        val left = ceil(((vm.lastActiveAt ?: now) + minutes * 60_000L - now) / 60_000.0).toLong()
        return if (left > 0) "stops when idle in $left min" else "idle, stopping any moment now"
    }

    /** Running VMs first, then the most recently used. */
    val byRecentUse: Comparator<VmInfo> = compareByDescending<VmInfo> { it.running }.thenByDescending { it.lastActiveAt ?: 0 }

    data class Label(val title: String, val subtitle: String?, val agent: AgentProfile?, val project: ProjectProfile?)

    fun label(state: DexState, key: String): Label = when (key) {
        SHARED_VM -> Label("Shared VM", "Not linked to a chat (from before VMs were per chat)", null, null)
        MCP_VM -> Label("MCP servers", "Runs your local MCP servers; starts when a chat uses one", null, null)
        else -> {
            val session = state.session(key)
            Label(session?.title ?: "Deleted chat", null, state.agent(session?.agentId), state.project(session?.projectId))
        }
    }

    val SIZES = listOf("small" to "Small · 2 vCPU · 4 GB", "default" to "Default · 4 vCPU · 8 GB", "large" to "Large · 8 vCPU · 16 GB")
    val IDLE_MINUTES = listOf(5, 10, 15, 30, 60)
}

/**
 * Messages just sent that the agent hasn't recorded yet, shown at once. They're matched to the user entries the agent
 * records by count (skills and secrets rewrite the text), dropped when anything queues, and dropped after 20 s.
 */
data class PendingMessage(val text: String, val after: Int, val at: Long)

object Pending {
    const val TTL_MS = 20_000L

    fun reconcile(list: List<PendingMessage>, userCount: Int, queueLength: Int, now: Long): List<PendingMessage> {
        val recorded = maxOf(0, userCount - (list.firstOrNull()?.after ?: userCount))
        val next = list.drop(recorded).filter { now - it.at < TTL_MS }
        return if (queueLength > 0 && next.isNotEmpty()) emptyList() else if (next.size == list.size) list else next
    }

    fun add(list: List<PendingMessage>, text: String, userCount: Int, now: Long) =
        list + PendingMessage(text, userCount + list.size, now)
}
