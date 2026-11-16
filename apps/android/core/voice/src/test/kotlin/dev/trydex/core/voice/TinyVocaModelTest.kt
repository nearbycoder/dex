package dev.trydex.core.voice

import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.Voice
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * tiny-voca run here on the phonemes Dex's endpoint gave for four sentences (resources/voice/phonemes.json), against
 * what onnxruntime-web made of them (reference.json): the same number of samples, and about the same loudness (the
 * model adds noise of its own, so samples aren't identical). The 21 MB model isn't in the repo: point DEX_VOICE_MODEL
 * at a copy (Dex serves it at /api/voice/model/model.onnx); without one the test is skipped.
 */
class TinyVocaModelTest {
    private fun resource(name: String) = javaClass.getResourceAsStream("/voice/$name")!!.bufferedReader().use { it.readText() }

    private val modelFile = listOfNotNull(
        System.getenv("DEX_VOICE_MODEL"),
        "/private/tmp/claude-501/-Users-nearby-Sites-dex/8dcdda47-fe60-4cf9-b92d-01c72fb6e6fe/scratchpad/voca/fixture/model.onnx",
    ).map(::File).firstOrNull { it.isFile }

    @Test fun matchesTheWebsVoice() {
        assumeTrue("No tiny-voca model here (set DEX_VOICE_MODEL)", modelFile != null)
        val phonemes = DexJson.decodeFromString(PhonemesResponse.serializer(), resource("phonemes.json"))
        val reference = DexJson.parseToJsonElement(resource("reference.json")).jsonArray.map { it.jsonObject }
        TinyVocaModel(modelFile!!).use { model ->
            for (expected in reference) {
                val text = expected["text"]!!.jsonPrimitive.content
                val voice = Voice.entries[expected["voice"]!!.jsonPrimitive.int]
                val sentence = phonemes.sentences.first { it.text == text }
                val samples = sentence.utterances.map { model.synthesize(it, voice) }.reduce(FloatArray::plus)
                val peak = samples.maxOf { abs(it) }
                val rms = sqrt(samples.sumOf { it.toDouble() * it } / samples.size)
                val label = "$voice: $text"
                assertWithMessage("samples, $label").that(samples.size).isEqualTo(expected["samples"]!!.jsonPrimitive.int)
                assertWithMessage("peak, $label").that(peak.toDouble()).isWithin(0.12).of(expected["peak"]!!.jsonPrimitive.double)
                assertWithMessage("rms, $label").that(rms).isWithin(0.015).of(expected["rms"]!!.jsonPrimitive.double)
                assertWithMessage("never clips, $label").that(peak).isAtMost(TinyVocaModel.PEAK)
            }
        }
    }

    @Test fun loudPiecesAreScaledDown() {
        val samples = floatArrayOf(0.5f, -1.98f, 1.2f)
        TinyVocaModel.limitPeak(samples)
        assertWithMessage("peak").that(samples.maxOf { abs(it) }).isWithin(1e-6f).of(TinyVocaModel.PEAK)
        assertWithMessage("shape kept").that(samples[0]).isWithin(1e-6f).of(0.25f)
        val quiet = floatArrayOf(0.5f, -0.2f)
        TinyVocaModel.limitPeak(quiet)
        assertWithMessage("quiet kept").that(quiet.toList()).isEqualTo(listOf(0.5f, -0.2f))
    }
}
