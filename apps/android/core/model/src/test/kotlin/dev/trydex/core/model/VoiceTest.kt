package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import org.junit.Test

/** Voice calls' text rules and voices, against goldens from the web's own shared/voice.ts (tools/goldens/voice.mts). */
class VoiceTest {
    private val golden: JsonObject = javaClass.getResourceAsStream("/golden/voice.json")!!.bufferedReader().use { DexJson.parseToJsonElement(it.readText()).jsonObject }
    private fun cases(key: String) = golden[key]!!.jsonArray.map { it.jsonObject }
    private fun JsonObject.string(key: String) = this[key]!!.jsonPrimitive.content
    private fun JsonObject.strings(key: String) = this[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test fun sentences() {
        for (case in cases("sentences")) {
            assertWithMessage(case.string("input")).that(Voices.sentences(case.string("input"))).isEqualTo(case.strings("output"))
        }
    }

    @Test fun finished() {
        for (case in cases("finished")) {
            assertWithMessage(case.string("input")).that(Voices.finished(case.string("input"))).isEqualTo(case.string("output"))
        }
    }

    @Test fun speakable() {
        for (case in cases("speakable")) {
            assertWithMessage(case.string("input")).that(Voices.speakable(case.string("input"))).isEqualTo(case.string("output"))
        }
    }

    @Test fun sentencesWhileAReplyStreams() {
        for (case in cases("streams")) {
            val stream = SentenceStream()
            for (take in case["takes"]!!.jsonArray.map { it.jsonObject }) {
                assertWithMessage("${case.string("text")} by ${case["size"]!!.jsonPrimitive.int}: ${take.string("text")}")
                    .that(stream.take(take.string("text"))).isEqualTo(take.strings("taken"))
            }
            assertWithMessage("rest of ${case.string("text")}").that(stream.rest()).isEqualTo(case.strings("rest"))
        }
    }

    @Test fun voiceOf() {
        for (case in cases("voiceOf")) {
            val voice = case["voice"]!!.jsonPrimitive.contentOrNull
            assertWithMessage("${case.string("id")} / $voice").that(Voices.voiceOf(case.string("id"), voice).id).isEqualTo(case.string("output"))
        }
    }

    @Test fun aSidekicksVoiceIsOptionalOnTheWire() {
        val older = DexJson.decodeFromString(CharacterProfile.serializer(), """{"id":"atlas","name":"Atlas"}""")
        assertThat(older.voice).isNull()
        assertThat(Voices.voiceOf(older)).isEqualTo(Voice.M2)
        val chosen = DexJson.decodeFromString(CharacterProfile.serializer(), """{"id":"atlas","voice":"F2"}""")
        assertThat(Voices.voiceOf(chosen)).isEqualTo(Voice.F2)
        assertThat(DexJson.decodeFromString(CharacterProfile.serializer(), DexJson.encodeToString(CharacterProfile.serializer(), chosen))).isEqualTo(chosen)
        // A voice from a newer agent this app doesn't know reads as the automatic one.
        assertThat(Voices.voiceOf(DexJson.decodeFromString(CharacterProfile.serializer(), """{"id":"atlas","voice":"Z1"}"""))).isEqualTo(Voice.M2)
        assertThat(Voices.voiceOf(DexJson.decodeFromString(CharacterProfile.serializer(), """{"id":"atlas","voice":null}"""))).isEqualTo(Voice.M2)
    }

    @Test fun theReplyACallReads() {
        fun user(id: Long, text: String) = EntryRecord(id, "pi.user", model = listOf(UserMessage(content = listOf(TextBlock(text = text)), timestamp = id)))
        fun assistant(id: Long, vararg blocks: ContentBlock) = EntryRecord(id, "pi.assistant", model = listOf(AssistantMessage(content = blocks.toList(), timestamp = id * 10)))
        val before = TranscriptState(entries = listOf(user(1, "hi"), assistant(2, TextBlock(text = "Hello."))), loaded = true)
        assertThat(Voices.latestReply(before)).isEqualTo(CallReply("20", "Hello.", done = true))
        // Your words with no reply yet: nothing to read.
        assertThat(Voices.latestReply(before.copy(entries = before.entries + user(3, "how are you")))).isNull()
        // A reply over several messages (tools between): their text joined, and not done while the chat runs.
        val replying = before.copy(
            entries = before.entries + user(3, "how are you") + assistant(4, ThinkingBlock(thinking = "hmm"), TextBlock(text = "Good. "), TextBlock(text = "Let me look.")),
            streaming = AssistantMessage(content = listOf(TextBlock(text = "Found it")), timestamp = 50),
            running = true,
        )
        assertThat(Voices.latestReply(replying)).isEqualTo(CallReply("40", "Good. Let me look.\n\nFound it", done = false))
        assertThat(Voices.latestReply(TranscriptState.Empty)).isNull()
    }
}
