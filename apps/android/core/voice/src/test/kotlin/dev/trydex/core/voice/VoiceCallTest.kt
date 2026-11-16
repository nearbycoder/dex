package dev.trydex.core.voice

import com.google.common.truth.Truth.assertThat
import dev.trydex.core.client.VoiceException
import dev.trydex.core.model.CallReply
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.SpokenSentence
import dev.trydex.core.model.Utterance
import dev.trydex.core.model.Voice
import dev.trydex.core.model.Voices
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** A call's turn-taking, talking over them, and the order of what they say, with a scripted recognizer, voice, and speaker. */
class VoiceCallTest {
    private class FakeRecognition : Recognition {
        var listener: ((RecognitionEvent) -> Unit)? = null
        var starts = 0
        var cancels = 0
        var closed = false
        override fun start(onEvent: (RecognitionEvent) -> Unit) {
            starts++
            listener = onEvent
        }
        override fun cancel() {
            cancels++
            listener = null
        }
        override fun close() {
            closed = true
        }
        fun hear(event: RecognitionEvent) = listener!!.invoke(event)
    }

    /** Each sentence is one utterance; its audio is one sample, the sentence's number, so what played can be read back. */
    private class FakeSpeech : Speech {
        val requests = mutableListOf<String>()
        val synthesized = mutableListOf<Pair<String, Voice>>()
        val gates = mutableMapOf<String, CompletableDeferred<Unit>>()
        var loadError: Exception? = null
        val load = CompletableDeferred<Unit>().apply { complete(Unit) }
        override suspend fun load(onProgress: (Float) -> Unit) {
            onProgress(0.5f)
            load.await()
            loadError?.let { throw it }
        }
        override suspend fun phonemes(text: String): PhonemesResponse {
            requests += text
            gates[text]?.await()
            return PhonemesResponse(Voices.sentences(text).map { SpokenSentence(it, listOf(Utterance(listOf(1, 2), listOf(0, 0), it))) })
        }
        override suspend fun synthesize(utterance: Utterance, voice: Voice): FloatArray {
            synthesized += utterance.phonemes to voice
            return floatArrayOf(synthesized.size.toFloat())
        }
    }

    private class FakePlayer : CallPlayer {
        val queued = mutableListOf<Float>()
        val played = mutableListOf<Float>()
        var stops = 0
        var closed = false
        override var onIdle: (() -> Unit)? = null
        override fun play(samples: FloatArray) {
            queued += samples.toList()
            played += samples.toList()
        }
        override fun stop() {
            stops++
            queued.clear()
        }
        override val busy get() = queued.isNotEmpty()
        override fun level() = 0.5f
        override fun close() {
            closed = true
        }
        /** Everything queued has played. */
        fun drain() {
            queued.clear()
            onIdle?.invoke()
        }
    }

    private class Setup(scope: TestScope) {
        val recognition = FakeRecognition()
        val speech = FakeSpeech()
        val player = FakePlayer()
        val sent = mutableListOf<String>()
        val call = VoiceCall(Voice.M2, { sent += it }, recognition, speech, player, scope.backgroundScope) { scope.testScheduler.currentTime }
        val phase get() = call.state.value.phase
        /** What was said aloud, in order. */
        fun said() = player.played.map { speech.synthesized[it.toInt() - 1].first }
    }

    private fun TestScope.started(): Setup = Setup(this).also {
        it.call.start()
        runCurrent()
    }

    @Test fun youTalkAPauseSendsItAndTheirReplyIsReadAsItStreams() = runTest {
        val s = started()
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
        assertThat(s.recognition.starts).isEqualTo(1)

        s.recognition.hear(RecognitionEvent.Partial("what are we"))
        advanceTimeBy(800)
        s.recognition.hear(RecognitionEvent.Partial("what are we making"))
        assertThat(s.call.state.value.heard).isEqualTo("what are we making")
        advanceTimeBy(899)
        runCurrent()
        assertThat(s.sent).isEmpty()
        // 0.9 s after the last words: sent.
        advanceTimeBy(2)
        runCurrent()
        assertThat(s.sent).containsExactly("what are we making")
        assertThat(s.phase).isEqualTo(CallPhase.Thinking)
        // That session goes (its late results would come back as a new turn) and a fresh one starts.
        assertThat(s.recognition.cancels).isEqualTo(1)
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        assertThat(s.recognition.starts).isEqualTo(2)

        s.call.reply(CallReply("r1", "Hey you. What are", done = false))
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Speaking)
        assertThat(s.call.state.value.saying).isEqualTo("Hey you.")
        assertThat(s.speech.synthesized.map { it.second }.distinct()).containsExactly(Voice.M2)
        s.call.reply(CallReply("r1", "Hey you. What are we making today? A game", done = false))
        s.call.reply(CallReply("r1", "Hey you. What are we making today? A game for **Mia**!", done = true))
        runCurrent()
        assertThat(s.said()).containsExactly("Hey you.", "What are we making today?", "A game for Mia!").inOrder()
        // Back to listening once it's all played.
        s.player.drain()
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
        assertThat(s.call.state.value.saying).isEmpty()
    }

    @Test fun theReplyFromBeforeTheCallStaysUnsaid() = runTest {
        val s = started()
        s.call.reply(CallReply("old", "Hello there. How are you?", done = true))
        s.call.reply(CallReply("old", "Hello there. How are you? More.", done = true))
        runCurrent()
        assertThat(s.speech.requests).isEmpty()
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
        // Your words with no reply yet, then theirs.
        s.recognition.hear(RecognitionEvent.Final("hi"))
        s.recognition.hear(RecognitionEvent.Ended)
        runCurrent()
        assertThat(s.sent).containsExactly("hi")
        s.call.reply(null)
        s.call.reply(CallReply("new", "Hi!", done = true))
        runCurrent()
        assertThat(s.said()).containsExactly("Hi!")
    }

    @Test fun talkingOverThemStopsThemAndTheRestGoesUnsaid() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Final("tell me a story"))
        s.recognition.hear(RecognitionEvent.Ended)
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        s.call.reply(CallReply("r1", "Once upon a time. There was a cat. It", done = false))
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Speaking)
        val played = s.player.played.size

        // One word isn't enough to cut them off.
        s.recognition.hear(RecognitionEvent.Partial("wait"))
        assertThat(s.player.stops).isEqualTo(0)
        s.recognition.hear(RecognitionEvent.Partial("wait stop"))
        assertThat(s.player.stops).isEqualTo(1)
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
        assertThat(s.call.state.value.saying).isEmpty()

        // The rest of that reply isn't read, however much more of it comes.
        s.call.reply(CallReply("r1", "Once upon a time. There was a cat. It sat. The end.", done = true))
        runCurrent()
        assertThat(s.player.played.size).isEqualTo(played)
        advanceTimeBy(VoiceCall.END_OF_TURN_MS + 1)
        assertThat(s.sent).containsExactly("tell me a story", "wait stop").inOrder()
        s.call.reply(CallReply("r2", "Okay, stopping.", done = true))
        runCurrent()
        assertThat(s.said().last()).isEqualTo("Okay, stopping.")
    }

    @Test fun theirOwnVoiceInTheMicrophoneIsntYou() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Final("hello"))
        s.recognition.hear(RecognitionEvent.Ended)
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        s.call.reply(CallReply("r1", "What are we making today? Tell me", done = false))
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Speaking)
        // The speaker leaking into the microphone: their words, not yours.
        s.recognition.hear(RecognitionEvent.Partial("what are we making"))
        s.recognition.hear(RecognitionEvent.Final("are we making today"))
        assertThat(s.player.stops).isEqualTo(0)
        assertThat(s.call.state.value.heard).isEqualTo("hello")
        advanceTimeBy(VoiceCall.END_OF_TURN_MS + 1)
        assertThat(s.sent).containsExactly("hello")
        // Shortly after they stop, an echo is still theirs; yours is yours.
        s.call.reply(CallReply("r1", "What are we making today? Tell me.", done = true))
        runCurrent()
        s.player.drain()
        advanceTimeBy(500)
        s.recognition.hear(RecognitionEvent.Partial("tell me"))
        assertThat(s.call.state.value.heard).isEqualTo("hello")
        s.recognition.hear(RecognitionEvent.Partial("a robot game"))
        assertThat(s.call.state.value.heard).isEqualTo("a robot game")
    }

    @Test fun sentencesPlayInOrderAndTheNextAreFetchedWhileOnesPlay() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Final("go"))
        s.recognition.hear(RecognitionEvent.Ended)
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        val slow = CompletableDeferred<Unit>()
        s.speech.gates["First one."] = slow
        s.call.reply(CallReply("r1", "First one. Second", done = false))
        s.call.reply(CallReply("r1", "First one. Second one. Third", done = false))
        runCurrent()
        // The second batch waits for the first: nothing out of order.
        assertThat(s.speech.requests).containsExactly("First one.")
        assertThat(s.player.played).isEmpty()
        slow.complete(Unit)
        runCurrent()
        assertThat(s.speech.requests).containsExactly("First one.", "Second one.").inOrder()
        // The first is still playing when the second is fetched and queued behind it.
        assertThat(s.player.busy).isTrue()
        s.call.reply(CallReply("r1", "First one. Second one. Third one.", done = true))
        runCurrent()
        assertThat(s.said()).containsExactly("First one.", "Second one.", "Third one.").inOrder()
        assertThat(s.phase).isEqualTo(CallPhase.Speaking)
        s.player.drain()
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
    }

    @Test fun mutedItDoesntListen() = runTest {
        val s = started()
        val old = s.recognition.listener!!
        s.call.setMuted(true)
        assertThat(s.recognition.cancels).isEqualTo(1)
        assertThat(s.call.state.value.muted).isTrue()
        // A late result from before muting is ignored, and nothing restarts while muted.
        old(RecognitionEvent.Final("ignored words"))
        old(RecognitionEvent.Ended)
        advanceTimeBy(5_000)
        assertThat(s.sent).isEmpty()
        assertThat(s.recognition.starts).isEqualTo(1)
        s.call.setMuted(false)
        assertThat(s.recognition.starts).isEqualTo(2)
    }

    @Test fun anUtteranceThatEndsIsSentAtOnceAndListeningGoesOn() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Partial("good"))
        s.recognition.hear(RecognitionEvent.Final("good morning"))
        s.recognition.hear(RecognitionEvent.Ended)
        assertThat(s.sent).isEmpty()
        runCurrent()
        assertThat(s.sent).containsExactly("good morning")
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        assertThat(s.recognition.starts).isEqualTo(2)
        // Silence ends a session too: it just starts again.
        s.recognition.hear(RecognitionEvent.Ended)
        advanceTimeBy(VoiceCall.RESTART_MS + 1)
        assertThat(s.recognition.starts).isEqualTo(3)
        assertThat(s.sent).hasSize(1)
    }

    @Test fun whileTheVoiceLoads() = runTest {
        val s = Setup(this)
        val gate = CompletableDeferred<Unit>()
        val speech = object : Speech by s.speech {
            override suspend fun load(onProgress: (Float) -> Unit) {
                onProgress(0.25f)
                gate.await()
            }
        }
        val call = VoiceCall(Voice.F2, { s.sent += it }, s.recognition, speech, s.player, backgroundScope) { testScheduler.currentTime }
        call.start()
        runCurrent()
        assertThat(call.state.value.phase).isEqualTo(CallPhase.Starting)
        assertThat(call.state.value.downloading).isEqualTo(0.25f)
        // It already hears you.
        s.recognition.hear(RecognitionEvent.Final("hello"))
        s.recognition.hear(RecognitionEvent.Ended)
        runCurrent()
        assertThat(s.sent).containsExactly("hello")
        assertThat(call.state.value.phase).isEqualTo(CallPhase.Starting)
        gate.complete(Unit)
        runCurrent()
        assertThat(call.state.value.downloading).isNull()
        assertThat(call.state.value.phase).isEqualTo(CallPhase.Thinking)
    }

    @Test fun aVoiceThatCantLoadEndsTheCall() = runTest {
        val s = Setup(this)
        s.speech.loadError = VoiceException("Sign in again to use calls.", 401)
        s.call.start()
        runCurrent()
        assertThat(s.phase).isEqualTo(CallPhase.Failed)
        assertThat(s.call.state.value.error).isEqualTo("Sign in again to use calls.")
        assertThat(s.recognition.closed).isTrue()
    }

    @Test fun phonemesThatFailSayWhyAndTheCallGoesOn() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Final("hi"))
        s.recognition.hear(RecognitionEvent.Ended)
        runCurrent()
        val failing = CompletableDeferred<Unit>().apply { completeExceptionally(VoiceException("Their voice isn't available right now.", 500)) }
        s.speech.gates["Hello."] = failing
        s.call.reply(CallReply("r1", "Hello.", done = true))
        runCurrent()
        assertThat(s.call.state.value.error).isEqualTo("Their voice isn't available right now.")
        assertThat(s.phase).isEqualTo(CallPhase.Listening)
    }

    @Test fun endingStopsEverything() = runTest {
        val s = started()
        s.recognition.hear(RecognitionEvent.Final("hi"))
        s.recognition.hear(RecognitionEvent.Ended)
        runCurrent()
        s.call.reply(CallReply("r1", "One. Two", done = false))
        runCurrent()
        s.call.end()
        assertThat(s.phase).isEqualTo(CallPhase.Ended)
        assertThat(s.player.closed).isTrue()
        assertThat(s.recognition.closed).isTrue()
        assertThat(s.call.level()).isEqualTo(0f)
        val played = s.player.played.size
        s.call.reply(CallReply("r1", "One. Two. Three.", done = true))
        advanceTimeBy(5_000)
        assertThat(s.player.played.size).isEqualTo(played)
        assertThat(s.phase).isEqualTo(CallPhase.Ended)
    }
}
