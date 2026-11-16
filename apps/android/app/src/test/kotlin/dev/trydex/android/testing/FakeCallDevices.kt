package dev.trydex.android.testing

import dev.trydex.android.voice.CallDevices
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.Utterance
import dev.trydex.core.model.Voice
import dev.trydex.core.voice.CallPlayer
import dev.trydex.core.voice.Recognition
import dev.trydex.core.voice.RecognitionEvent
import dev.trydex.core.voice.Speech

/**
 * Calls without a microphone or the model: tests say what recognition hears, phonemes come from FakeDex's endpoint
 * ([phonemes], set by the harness), each utterance "plays" as one sample, and the speaker finishes when told.
 */
class FakeCallDevices : CallDevices {
    var phonemes: suspend (String) -> PhonemesResponse = { PhonemesResponse() }
    var unavailableReason: String? = null
    val recognitions = mutableListOf<FakeRecognition>()
    val players = mutableListOf<FakePlayer>()
    val synthesized = mutableListOf<Pair<String, Voice>>()
    var claims = 0
    var releases = 0

    override val speech = object : Speech {
        override suspend fun load(onProgress: (Float) -> Unit) = onProgress(1f)
        override suspend fun phonemes(text: String) = phonemes.invoke(text)
        override suspend fun synthesize(utterance: Utterance, voice: Voice): FloatArray {
            synthesized += utterance.phonemes to voice
            return floatArrayOf(0.5f)
        }
    }

    override fun unavailable() = unavailableReason
    override fun recognition() = FakeRecognition().also { recognitions += it }
    override fun player(preview: Boolean) = FakePlayer(preview).also { players += it }
    override fun claimAudio(): () -> Unit {
        claims++
        return { releases++ }
    }

    class FakeRecognition : Recognition {
        private var listener: ((RecognitionEvent) -> Unit)? = null
        val listening get() = listener != null
        var closed = false
        override fun start(onEvent: (RecognitionEvent) -> Unit) {
            listener = onEvent
        }
        override fun cancel() {
            listener = null
        }
        override fun close() {
            listener = null
            closed = true
        }
        /** Call on the main thread. */
        fun hear(vararg events: RecognitionEvent) = events.forEach { event ->
            val current = listener
            // Like Android's, a session is over once it ends.
            if (event == RecognitionEvent.Ended) listener = null
            current?.invoke(event)
        }
    }

    class FakePlayer(val preview: Boolean) : CallPlayer {
        var queued = 0
        var played = 0
        var closed = false
        override var onIdle: (() -> Unit)? = null
        override fun play(samples: FloatArray, onStart: () -> Unit) {
            queued++
            played++
            onStart()
        }
        override fun stop() {
            queued = 0
        }
        override val busy get() = queued > 0
        override fun level() = 0.3f
        override fun close() {
            closed = true
        }
        /** Everything queued has played. Call on the main thread. */
        fun drain() {
            queued = 0
            onIdle?.invoke()
        }
    }
}
