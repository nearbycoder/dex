package dev.trydex.android

import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexUser
import dev.trydex.fake.FakeData
import dev.trydex.fake.FakeDex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The debug build's demo: a fake Dex running inside the app, with sample chats, machines, and generated UIs, so the
 * app can be tried (and screenshotted) without a deployment or any real account.
 */
object Demo {
    const val available = true
    private const val PORT = 47_123
    private const val SERVER = "http://127.0.0.1:$PORT/"
    private var fake: FakeDex? = null

    private fun ensureRunning() {
        if (fake == null) fake = FakeDex().also { it.start(PORT) }
    }

    /** Starts the fake and signs in to it. */
    suspend fun start(graph: AppGraph) {
        withContext(Dispatchers.IO) { ensureRunning() }
        graph.repository.signIn(
            DexSession(SERVER, fake!!.token, DexUser(FakeData.USER_ID, FakeData.LOGIN, "Mona Octocat"), System.currentTimeMillis() + 30L * 86_400_000),
        )
    }

    /** After a restart, a demo session needs its fake again. */
    fun resume(graph: AppGraph) {
        if (graph.repository.session.value?.server == SERVER) Thread { ensureRunning() }.start()
    }
}
