package dev.trydex.fake

import dev.trydex.core.model.DexJson
import dev.trydex.core.model.PhonemesResponse
import dev.trydex.core.model.SpokenSentence
import dev.trydex.core.model.Voices

/**
 * The fake's `/api/voice/phonemes`: it can't turn text into phonemes, so it knows a few sentences (what the real
 * endpoint gave for them) and gives the rest no utterances, which a call skips as it would a sentence with nothing to say.
 */
object FakeVoice {
    private val known: Map<String, SpokenSentence> by lazy {
        val text = FakeVoice::class.java.getResourceAsStream("voice-phonemes.json")!!.bufferedReader().use { it.readText() }
        DexJson.decodeFromString(PhonemesResponse.serializer(), text).sentences.associateBy { it.text }
    }

    /** Sentences it can say. */
    val sentences: Set<String> get() = known.keys

    fun phonemes(text: String): PhonemesResponse {
        known[text.trim()]?.let { return PhonemesResponse(listOf(it)) }
        return PhonemesResponse(Voices.sentences(text).map { known[it] ?: SpokenSentence(it) })
    }
}
