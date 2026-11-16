package dev.trydex.android.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import dev.trydex.core.model.Voices
import dev.trydex.core.voice.CallPlayer
import java.util.concurrent.Executors
import kotlin.math.sqrt

/**
 * Their voice through an AudioTrack (24 kHz mono float, streamed): each piece is written right after the one before,
 * so sentences run on without gaps. A call plays as voice communication, so the platform treats it as a call (echo
 * cancellation where the device applies it, the call's volume); a voice preview plays as media.
 */
class TrackPlayer(private val usage: Int = AudioAttributes.USAGE_VOICE_COMMUNICATION) : CallPlayer {
    private val writer = Executors.newSingleThreadExecutor { Thread(it, "dex-voice").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var track: AudioTrack? = null
    /** Bumped by stop: writes queued before it are dropped. */
    private var generation = 0
    /** Frames written to the track so far (pieces and the silence after the last one). */
    private var written = 0L
    private var queued = 0
    private val pieces = ArrayDeque<Piece>()
    private var closed = false

    private class Piece(val start: Long, val samples: FloatArray, var onStart: (() -> Unit)?)

    override var onIdle: (() -> Unit)? = null

    override fun play(samples: FloatArray, onStart: () -> Unit) {
        if (samples.isEmpty()) return
        val generation = synchronized(lock) {
            if (closed) return
            pieces += Piece(written, samples, onStart)
            written += samples.size
            queued++
            generation
        }
        writer.execute {
            val track = synchronized(lock) { if (generation != this.generation) return@execute; trackLocked() }
            track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
            // The last piece for now: a little silence after it, so the track plays it out rather than waiting for more.
            val tail = synchronized(lock) {
                if (generation != this.generation) return@execute
                queued--
                if (queued == 0) TAIL.also { written += it.size } else null
            }
            tail?.let { track.write(it, 0, it.size, AudioTrack.WRITE_BLOCKING) }
        }
        watch()
    }

    private fun trackLocked(): AudioTrack = track ?: AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(
            AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(Voices.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(Voices.SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT), Voices.SAMPLE_RATE / 5 * 4))
        .build()
        .also {
            it.play()
            track = it
        }

    /** Frames the track has played. */
    private fun headLocked(): Long = track?.playbackHeadPosition?.toLong()?.and(0xFFFF_FFFFL) ?: 0L

    override val busy: Boolean get() = synchronized(lock) { queued > 0 || (track != null && headLocked() < written) }

    /** Tells the call when everything queued has played, checking a few times a second while something plays. */
    private fun watch() {
        main.removeCallbacks(check)
        main.postDelayed(check, CHECK_MS)
    }

    private val check = object : Runnable {
        override fun run() {
            // Pieces the track has reached: they've started.
            val started = synchronized(lock) {
                val head = headLocked()
                pieces.filter { it.onStart != null && it.start <= head }.mapNotNull { piece -> piece.onStart.also { piece.onStart = null } }
            }
            started.forEach { it() }
            if (busy) main.postDelayed(this, CHECK_MS) else onIdle?.invoke()
        }
    }

    override fun level(): Float = synchronized(lock) {
        val head = headLocked()
        while (pieces.isNotEmpty() && pieces.first().onStart == null && pieces.first().start + pieces.first().samples.size < head) pieces.removeFirst()
        val piece = pieces.firstOrNull { head >= it.start && head < it.start + it.samples.size } ?: return 0f
        val at = (head - piece.start).toInt()
        val from = maxOf(0, at - WINDOW / 2)
        val to = minOf(piece.samples.size, at + WINDOW / 2)
        if (to <= from) return 0f
        var sum = 0.0
        for (index in from until to) sum += piece.samples[index] * piece.samples[index]
        minOf(1f, sqrt(sum / (to - from)).toFloat() * 4)
    }

    override fun stop() {
        val old = synchronized(lock) {
            generation++
            pieces.clear()
            written = 0
            queued = 0
            track.also { track = null }
        }
        main.removeCallbacks(check)
        old?.let {
            // Pausing unblocks a write in progress; the writer releases it after that write.
            runCatching { it.pause(); it.flush() }
            writer.execute { runCatching { it.release() } }
        }
    }

    override fun close() {
        stop()
        synchronized(lock) { closed = true }
        writer.shutdown()
    }

    private companion object {
        const val CHECK_MS = 40L
        /** About 20 ms either side of what's playing, for the face's movement. */
        const val WINDOW = 1_024
        val TAIL = FloatArray(Voices.SAMPLE_RATE / 10)
    }
}
