package dev.trydex.android.testing

import android.app.Application
import androidx.compose.ui.test.SemanticsNodeInteraction

import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.test.core.app.ApplicationProvider
import dev.trydex.android.AppGraph
import dev.trydex.android.data.MemorySessionStore
import dev.trydex.android.notifications.PushTokens
import dev.trydex.android.ui.DexRoot
import dev.trydex.android.ui.LinkInbox
import dev.trydex.android.ui.PipController
import dev.trydex.android.ui.signin.SignInController
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexUser
import dev.trydex.fake.FakeData
import dev.trydex.fake.FakeDex

import java.nio.file.Files

/** The app without its production singletons (Keystore, WorkManager): tests make their own graph. */
class TestApplication : Application()

/**
 * The real app against an in-process fake Dex: a graph with an in-memory session, signed in to FakeDex, rendering
 * [DexRoot] as the activity would.
 */
/** Push tokens without Firebase: a fixed token, and whether it was deleted. */
class FakePushTokens(override val available: Boolean = true, var value: String? = "fcm-test-token-0123456789abcdef") : PushTokens {
    var deleted = 0
    override suspend fun token() = value
    override suspend fun delete() {
        deleted++
    }
}

class Harness(chunkMs: Long = 0, val pushTokens: FakePushTokens = FakePushTokens()) : AutoCloseable {
    val fake = FakeDex(chunkMs = chunkMs)
    val server = fake.start()
    val context: Application = ApplicationProvider.getApplicationContext()
    val graph = AppGraph(context, sessionStore = MemorySessionStore(), cacheDir = Files.createTempDirectory("dex-cache").toFile(), pushTokens = pushTokens)
    val links = LinkInbox()
    val pip = PipController()
    val opened = mutableListOf<String>()

    val session = DexSession(server.toString(), fake.token, DexUser(FakeData.USER_ID, FakeData.LOGIN, "Mona Octocat"), System.currentTimeMillis() + 30L * 86_400_000)

    fun signIn() {
        graph.repository.setVisible(true)
        graph.repository.signIn(session)
    }

    fun setContent(rule: ComposeContentTestRule, signedIn: Boolean = true) {
        if (signedIn) signIn()
        val signIn = SignInController(context, graph.scope, graph.http, graph.repository, graph.preferences) { opened += it }
        rule.setContent {
            DexRoot(graph = graph, links = links, signIn = signIn, pip = pip, inPip = false, openInBrowser = { opened += it })
        }
    }

    override fun close() {
        graph.repository.signOut()
        fake.close()
    }
}

/** Waits (real time: the fake serves over a socket) until a node with this tag exists. */
fun ComposeContentTestRule.awaitTag(tag: String, timeout: Long = 10_000): SemanticsNodeInteraction {
    waitUntil(timeout) { onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    return onNode(hasTestTag(tag), useUnmergedTree = true)
}

fun ComposeContentTestRule.awaitText(text: String, substring: Boolean = false, timeout: Long = 10_000): SemanticsNodeInteraction {
    waitUntil(timeout) { onAllNodes(hasText(text, substring = substring), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    return onAllNodes(hasText(text, substring = substring), useUnmergedTree = true).let { it[0] }
}

