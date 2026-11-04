package dev.trydex.android.data

import dev.trydex.core.model.UsageGlance
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.runningFold
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * The agent's usage at a glance (`usageGlance`), for the Chats bar's meter and the Settings row: one copy, fetched
 * once however many screens show it (useUsageGlance on the web). While something collects [glance] with the lifecycle,
 * it refreshes when the app comes back on screen, every two minutes, on reconnecting, and when a chat finishes.
 */
class UsageGlances(scope: CoroutineScope, private val repository: DexRepository) {
    /** The last glance, and whose it is (so another account never sees it). */
    private val kept = MutableStateFlow<Pair<String, UsageGlance>?>(null)

    /** Null until it loads, and on an agent from before `usageGlance` (screens show the plain Usage icon). */
    val glance: StateFlow<UsageGlance?> = channelFlow {
        launch { refreshes().collectLatest { load() } }
        combine(kept, repository.session) { kept, session -> kept?.takeIf { it.first == session?.user?.id }?.second }.collect { send(it) }
    }.stateIn(scope, SharingStarted.WhileSubscribed(5_000), null)

    private fun refreshes(): Flow<Unit> = merge(
        // At once when connected (so on coming back on screen too), and after every reconnect.
        repository.connected.filter { it }.map { },
        flow {
            while (true) {
                delay(REFRESH_MS)
                emit(Unit)
            }
        },
        // A reply just finished: its tokens count now.
        repository.state.map { state -> state?.sessions?.count { it.busy } ?: 0 }.distinctUntilChanged()
            .runningFold(0 to 0) { (_, previous), working -> previous to working }
            .filter { (previous, working) -> working < previous }.map { },
    )

    private suspend fun load() {
        repository.connected.first { it }
        val user = repository.userId ?: return
        // Quietly: an older agent has no such method, and a dropped call just waits for the next refresh.
        runCatching { repository.api.usageGlance() }.onSuccess { if (repository.userId == user) kept.value = user to it }
    }

    companion object {
        const val REFRESH_MS = 120_000L
    }
}
