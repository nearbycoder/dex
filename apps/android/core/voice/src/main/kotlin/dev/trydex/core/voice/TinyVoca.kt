package dev.trydex.core.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.Utterance
import dev.trydex.core.model.Voice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.abs

/**
 * tiny-voca (https://huggingface.co/n4ze3m/tiny-voca) loaded with ONNX Runtime: utterances in, 24 kHz mono audio out
 * (apps/web/src/client/voice/tts.worker.ts). Safe to run from several threads at once.
 */
class TinyVocaModel(file: File) : AutoCloseable {
    private val environment = OrtEnvironment.getEnvironment()
    private val session: OrtSession = OrtSession.SessionOptions().use { options -> environment.createSession(file.path, options) }

    fun synthesize(utterance: Utterance, voice: Voice, speed: Float = 1f): FloatArray {
        val count = utterance.ids.size.toLong()
        val inputs = mapOf(
            "tokens" to OnnxTensor.createTensor(environment, LongBuffer.wrap(utterance.ids.toLongArray()), longArrayOf(1, count)),
            "stress" to OnnxTensor.createTensor(environment, LongBuffer.wrap(utterance.stress.toLongArray()), longArrayOf(1, count)),
            "voice" to OnnxTensor.createTensor(environment, LongBuffer.wrap(longArrayOf(voice.index.toLong())), longArrayOf(1)),
            "speed" to scalar(speed),
            "pitch_shift" to scalar(0f),
            "pitch_range" to scalar(1f),
        )
        try {
            session.run(inputs).use { result ->
                val audio = result.get("audio").orElseThrow { IllegalStateException("The voice model gave no audio.") } as OnnxTensor
                val buffer = audio.floatBuffer
                val samples = FloatArray(buffer.remaining())
                buffer.get(samples)
                limitPeak(samples)
                return samples
            }
        } finally {
            inputs.values.forEach { it.close() }
        }
    }

    private fun scalar(value: Float) = OnnxTensor.createTensor(environment, FloatBuffer.wrap(floatArrayOf(value)), longArrayOf(1))

    override fun close() = session.close()

    companion object {
        /** The model can peak a little above 1.0; scaled down then, so it never clips. */
        const val PEAK = 0.99f

        fun limitPeak(samples: FloatArray) {
            var loudest = 0f
            for (sample in samples) loudest = maxOf(loudest, abs(sample))
            if (loudest > PEAK) for (index in samples.indices) samples[index] *= PEAK / loudest
        }
    }
}

/**
 * Their voice in the app: the model from [model] (Dex's file, downloaded once: DexVoice.model), loaded once and kept
 * for later calls, and phonemes from [phonemesOf] (DexVoice.phonemes).
 */
class TinyVoca(
    private val model: suspend (onProgress: (Float) -> Unit) -> File,
    private val phonemesOf: suspend (String) -> PhonemesResponse,
) : Speech {
    private val loading = Mutex()
    @Volatile private var loaded: TinyVocaModel? = null

    override suspend fun load(onProgress: (Float) -> Unit) {
        if (loaded != null) return
        loading.withLock {
            if (loaded != null) return
            val file = model(onProgress)
            loaded = withContext(Dispatchers.Default) {
                try {
                    TinyVocaModel(file)
                } catch (error: Exception) {
                    // A damaged file goes, so the next call downloads it again.
                    file.delete()
                    throw IllegalStateException("Their voice couldn't load. Try again.", error)
                }
            }
        }
    }

    override suspend fun phonemes(text: String): PhonemesResponse = phonemesOf(text)

    override suspend fun synthesize(utterance: Utterance, voice: Voice): FloatArray {
        load()
        val model = loaded!!
        return withContext(Dispatchers.Default) { model.synthesize(utterance, voice) }
    }
}
