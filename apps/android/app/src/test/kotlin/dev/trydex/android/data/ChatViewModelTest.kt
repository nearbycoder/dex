package dev.trydex.android.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.ui.chat.ChatViewModel
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.TimeUnit

/** The open chat's model against the fake Dex: its transcript, pending messages, and queue actions. */
@RunWith(AndroidJUnit4::class)
class ChatViewModelTest {
    private val harness = Harness(chunkMs = 40)

    @After fun tearDown() = harness.close()

    /** Runs the main thread until [done] or the time runs out (the fake answers over a real socket). */
    private fun await(timeout: Long = 10_000, done: () -> Boolean) {
        val until = System.currentTimeMillis() + timeout
        while (!done()) {
            check(System.currentTimeMillis() < until) { "Timed out" }
            ShadowLooper.idleMainLooper(20, TimeUnit.MILLISECONDS)
            Thread.sleep(20)
        }
    }

    @Test fun loadsTheTranscriptAndShowsPendingUntilRecorded() {
        harness.signIn()
        await { harness.graph.repository.connected.value }
        val model = ChatViewModel("chat-research", harness.graph.repository)
        await { model.transcript.value.loaded }
        val before = model.transcript.value.userCount
        model.send("  What about pgvector?  ")
        // Shown at once, trimmed, while the agent hasn't recorded it.
        assertThat(model.pending.value.map { it.text }).containsExactly("What about pgvector?")
        await { model.transcript.value.userCount > before }
        await { model.pending.value.isEmpty() }
        await { !model.transcript.value.running }
        assertThat(harness.fake.calls.map { it.first }).contains("sendMessage")
    }

    @Test fun sendsAttachmentsAndShowsThem() {
        harness.signIn()
        await { harness.graph.repository.connected.value }
        val repository = harness.graph.repository
        val model = ChatViewModel("chat-research", repository)
        await { model.transcript.value.loaded }
        val photo = kotlinx.coroutines.runBlocking { repository.uploadAttachment(byteArrayOf(1, 2), "shot.png", "image/png") }
        val notes = kotlinx.coroutines.runBlocking { repository.uploadAttachment("# Notes".toByteArray(), "notes.md", "text/markdown") }
        val before = model.transcript.value.userCount
        model.send("", listOf(photo, notes))
        // A message of only files shows their names while it's sent.
        assertThat(model.pending.value.map { it.text }).containsExactly("Attached: shot.png and 1 more")
        await { model.transcript.value.userCount > before }
        val sent = dev.trydex.core.model.displayItems(model.transcript.value).filterIsInstance<dev.trydex.core.model.DisplayItem.User>().last()
        assertThat(sent.files.map { it.name }).containsExactly("shot.png", "notes.md").inOrder()
        assertThat(sent.imageParts).hasSize(1)
        assertThat(sent.text).isEmpty()
        await { !model.transcript.value.running }
    }

    @Test fun aMessageWhileRunningQueuesInsteadOfPending() {
        harness.signIn()
        await { harness.graph.repository.connected.value }
        val model = ChatViewModel("chat-research", harness.graph.repository)
        await { model.transcript.value.loaded }
        model.send("First")
        await { model.transcript.value.running }
        model.send("Second, after that")
        await { model.transcript.value.queue.isNotEmpty() }
        assertThat(model.pending.value.map { it.text }).doesNotContain("Second, after that")
        val queued = model.transcript.value.queue.single()
        model.steerQueued(queued.id)
        await { model.transcript.value.queue.isEmpty() }
        model.stop()
        await { !model.transcript.value.running }
    }
}
