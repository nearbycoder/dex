package dev.trydex.core.voice

import dev.trydex.core.model.CallReply
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.SentenceStream
import dev.trydex.core.model.Utterance
import dev.trydex.core.model.Voice
import dev.trydex.core.model.Voices
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One voice call with a sidekick (apps/web/src/client/voice/call.ts): speech recognition hears you, what you say goes
 * to their conversation ([send]), and their reply, fed in with [reply] as it streams, is spoken a sentence at a time
 * by tiny-voca. Talking over them stops them.
 *
 * Everything runs on [scope]'s thread (the main thread in the app, where Android's recognizer lives): the recognizer's
 * events come there, and the model and the network work off it inside [Speech].
 */
class VoiceCall(
    private val voice: Voice,
    private val send: suspend (String) -> Unit,
    private val recognition: Recognition,
    private val speech: Speech,
    private val player: CallPlayer,
    scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val job = SupervisorJob(scope.coroutineContext[Job])
    private val work = CoroutineScope(scope.coroutineContext + job)

    private val snapshot = MutableStateFlow(CallSnapshot())
    val state: StateFlow<CallSnapshot> = snapshot.asStateFlow()

    private var listening = false
    /** Bumped when a recognition session is dropped: its late events are ignored. */
    private var session = 0
    private var finalText = ""
    private var interim = ""
    private var turnTimer: Job? = null
    /** Bumped when they're cut off: work for an older reply is dropped. */
    private var generation = 0
    private var pending = 0
    private var speaker: Job? = null
    private var batches = Channel<Batch>(Channel.UNLIMITED)
    private var stream = SentenceStream()
    private var replyKey: String? = null
    private var unsaid: String? = null
    private var replyDone = true
    private var waitingForReply = false
    /** What they said in the last while, so the microphone hearing the speaker isn't taken for you. */
    private val recentlySaid = ArrayDeque<Said>()

    private class Batch(val text: String, val generation: Int)
    private class Said(val words: List<String>, val at: Long)

    init {
        player.onIdle = { work.launch { settle() } }
    }

    private val over get() = snapshot.value.over

    /** Starts the call: listening at once, and their voice loading (downloaded the first time). */
    fun start() {
        listen()
        work.launch {
            try {
                speech.load { fraction -> update { copy(downloading = fraction) } }
                if (over) return@launch
                update { copy(downloading = null, phase = if (speaking()) CallPhase.Speaking else if (waitingForReply) CallPhase.Thinking else CallPhase.Listening) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                fail(error.message ?: "Their voice couldn't load.")
            }
        }
    }

    /** The reply after your latest words; call it whenever the chat changes. */
    fun reply(reply: CallReply?) {
        if (reply == null || over) return
        // One you cut off (or one from before the call) stays unsaid, however much more of it streams in.
        if (reply.key == unsaid) return
        if (reply.key != replyKey) {
            val before = replyKey == null && !waitingForReply
            replyKey = reply.key
            stream = SentenceStream()
            if (before) {
                unsaid = reply.key
                return
            }
        }
        replyDone = reply.done
        val sentences = if (reply.done) stream.take(reply.text) + stream.rest(reply.text) else stream.take(reply.text)
        if (sentences.isNotEmpty() || reply.done) waitingForReply = false
        if (sentences.isNotEmpty()) say(sentences.joinToString(" "))
        settle()
    }

    fun setMuted(muted: Boolean) {
        if (over) return
        update { copy(muted = muted) }
        if (muted) stopListening() else listen()
    }

    /** Stops everything. */
    fun end() = finish(null)

    /** How loud they are right now, 0 to 1, for the face. */
    fun level(): Float = if (player.busy) player.level() else 0f

    private fun update(change: CallSnapshot.() -> CallSnapshot) = snapshot.update { current ->
        val next = current.change()
        // Once over, it stays over.
        if (current.over) next.copy(phase = current.phase) else next
    }

    private fun fail(message: String) = finish(message)

    private fun finish(error: String?) {
        if (over) return
        snapshot.update { it.copy(phase = if (error != null) CallPhase.Failed else CallPhase.Ended, error = error ?: it.error, downloading = null) }
        generation++
        turnTimer?.cancel()
        silence()
        stopListening()
        recognition.close()
        player.close()
        job.cancel()
    }

    // ── Hearing you ─────────────────────────────────────────────────────────────

    private fun listen() {
        if (listening || snapshot.value.muted || over) return
        val id = ++session
        listening = true
        recognition.start { event -> if (id == session) heard(event) }
    }

    private fun stopListening() {
        if (!listening) return
        session++
        listening = false
        recognition.cancel()
    }

    private fun heard(event: RecognitionEvent) {
        when (event) {
            is RecognitionEvent.Partial -> {
                interim = if (isEcho(event.text)) "" else event.text.trim()
                hearing()
            }
            is RecognitionEvent.Final -> {
                if (!isEcho(event.text)) finalText = "$finalText ${event.text}".trim()
                interim = ""
                hearing()
            }
            // Recognition stops after each utterance (and after a silence); it's started again for the whole call.
            RecognitionEvent.Ended -> {
                session++
                listening = false
                if (finalText.isNotEmpty() || interim.isNotEmpty()) endTurn()
                relisten()
            }
            is RecognitionEvent.Failed -> fail(event.message)
        }
    }

    private fun relisten() {
        work.launch {
            delay(RESTART_MS)
            listen()
        }
    }

    private fun hearing() {
        val heard = "$finalText $interim".trim()
        if (heard.isEmpty()) return
        // You talking over them: they stop.
        if (speaking() && Voices.words(heard).size >= 2) cutOff()
        update { copy(heard = heard) }
        turnTimer?.cancel()
        turnTimer = work.launch {
            delay(END_OF_TURN_MS)
            // What's still coming for these words would come back as a new turn: this session goes, and a new one starts.
            if (listening) {
                stopListening()
                relisten()
            }
            endTurn()
        }
    }

    /** Whether recognized words are mostly what they've just been saying (the speaker heard through the microphone). */
    private fun isEcho(text: String): Boolean {
        val heard = Voices.words(text)
        if (heard.isEmpty()) return false
        val now = clock()
        recentlySaid.removeAll { now - it.at >= 15_000 }
        if (!speaking() && recentlySaid.none { now - it.at < 2_000 }) return false
        val said = recentlySaid.flatMapTo(HashSet()) { it.words }
        return heard.count { it in said }.toDouble() / heard.size >= 0.6
    }

    /** You've stopped talking: what you said goes to them. */
    private fun endTurn() {
        turnTimer?.cancel()
        turnTimer = null
        val text = "$finalText $interim".trim()
        finalText = ""
        interim = ""
        if (text.isEmpty() || over) return
        cutOff()
        waitingForReply = true
        replyDone = false
        update { copy(heard = text, saying = "", phase = if (downloading != null) CallPhase.Starting else CallPhase.Thinking) }
        work.launch {
            try {
                send(text)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                waitingForReply = false
                update { copy(error = error.message ?: "That didn't send.", phase = CallPhase.Listening) }
            }
        }
    }

    // ── Their voice ─────────────────────────────────────────────────────────────

    private fun speaking() = player.busy || pending > 0

    /** Reads text out after whatever is already queued; the next batch's phonemes come while this one plays. */
    private fun say(text: String) {
        pending++
        update { copy(phase = CallPhase.Speaking) }
        batches.trySend(Batch(text, generation))
        if (speaker == null) {
            val queue = batches
            speaker = work.launch { for (batch in queue) speak(batch) }
        }
    }

    private suspend fun speak(batch: Batch) {
        try {
            if (batch.generation != generation) return
            val response: PhonemesResponse = speech.phonemes(batch.text)
            for (sentence in response.sentences) {
                for (utterance in sentence.utterances) {
                    val samples = speech.synthesize(utterance, voice)
                    if (batch.generation != generation || over) return
                    recentlySaid += Said(Voices.words(sentence.text), clock())
                    update { copy(saying = sentence.text) }
                    player.play(samples)
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (batch.generation == generation) update { copy(error = error.message ?: "Their voice isn't available right now.") }
        } finally {
            if (batch.generation == generation) {
                pending--
                settle()
            }
        }
    }

    private fun silence() {
        speaker?.cancel()
        speaker = null
        batches.close()
        batches = Channel(Channel.UNLIMITED)
        pending = 0
        player.stop()
    }

    /** You spoke over them: the rest of their reply goes unsaid. */
    private fun cutOff() {
        if (!speaking()) return
        generation++
        silence()
        unsaid = replyKey
        replyDone = true
        update { copy(saying = "", phase = CallPhase.Listening) }
    }

    /** Back to listening once they've said everything and the reply is over. */
    private fun settle() {
        if (over || speaking()) return
        val phase = snapshot.value.phase
        if (waitingForReply || !replyDone) {
            if (phase != CallPhase.Starting) update { copy(phase = CallPhase.Thinking, saying = "") }
            return
        }
        if (phase != CallPhase.Listening && phase != CallPhase.Starting) update { copy(phase = CallPhase.Listening, saying = "") }
    }

    companion object {
        /** How long after your last words a pause counts as the end of what you're saying. */
        const val END_OF_TURN_MS = 900L
        /** The pause before recognition starts again after it stops. */
        const val RESTART_MS = 250L
    }
}

enum class CallPhase { Starting, Listening, Thinking, Speaking, Ended, Failed }

data class CallSnapshot(
    val phase: CallPhase = CallPhase.Starting,
    /** What you're saying now (recognition's running guess), or just said. */
    val heard: String = "",
    /** The sentence they're saying. */
    val saying: String = "",
    val muted: Boolean = false,
    /** The voice's first download, 0 to 1, while it's under way. */
    val downloading: Float? = null,
    val error: String? = null,
) {
    val over: Boolean get() = phase == CallPhase.Ended || phase == CallPhase.Failed
}

/** What recognition reports: your words as they come, the final words of an utterance, its end, or that it can't go on. */
sealed interface RecognitionEvent {
    data class Partial(val text: String) : RecognitionEvent
    data class Final(val text: String) : RecognitionEvent
    data object Ended : RecognitionEvent
    data class Failed(val message: String) : RecognitionEvent
}

/** The device's speech recognition: one session at a time, ending on its own after each utterance ([RecognitionEvent.Ended]). */
interface Recognition {
    /** Starts a session; its events come on the call's thread until it ends or is cancelled. */
    fun start(onEvent: (RecognitionEvent) -> Unit)
    /** Drops the session without further events. */
    fun cancel()
    fun close()
}

/** Their voice: text to phonemes (Dex's endpoint) and phonemes to audio (the model). */
interface Speech {
    /** Gets the model ready, downloading it the first time ([onProgress] from 0 to 1). */
    suspend fun load(onProgress: (Float) -> Unit = {})
    suspend fun phonemes(text: String): PhonemesResponse
    /** One utterance as 24 kHz mono samples. */
    suspend fun synthesize(utterance: Utterance, voice: Voice): FloatArray
}

/** Plays their voice: each piece right after the one before, without gaps. */
interface CallPlayer {
    fun play(samples: FloatArray)
    /** Stops at once and drops what's queued. */
    fun stop()
    /** Whether anything is playing or queued. */
    val busy: Boolean
    /** How loud what's playing now is, 0 to 1. */
    fun level(): Float
    /** Called (on any thread) when everything queued has played. */
    var onIdle: (() -> Unit)?
    fun close()
}
