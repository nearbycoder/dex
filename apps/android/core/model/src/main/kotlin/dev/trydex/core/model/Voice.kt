package dev.trydex.core.model

import kotlinx.serialization.Serializable

/**
 * Voice calls with sidekicks (apps/web/src/shared/voice.ts). Each app speaks with tiny-voca
 * (https://huggingface.co/n4ze3m/tiny-voca), a 4.5M-parameter English text-to-speech model, run on the device: Dex
 * serves its files (/api/voice/model/<file>) and turns text into the phoneme ids it reads (/api/voice/phonemes).
 * Listening is the device's own speech recognition. What you say goes into the sidekick's conversation like a typed
 * message, marked as spoken, and the reply is read aloud a sentence at a time as it streams in.
 *
 * The text rules here are the web's, regex for regex (checked by goldens). JavaScript's `\s`, `\b`, `\d`, `^`, `$`
 * and `.` are spelled out, since Java's (and Android's ICU) differ from them.
 */
enum class Voice(val id: String, val label: String) {
    F2("F2", "Bright (female)"),
    M2("M2", "Warm (male)");

    /** The model's `voice` input. */
    val index: Int get() = ordinal

    companion object {
        fun fromId(id: String?): Voice? = entries.firstOrNull { it.id == id }
    }
}

/** One piece the model reads in a call: up to 512 phonemes (config.json `max_tokens`) with their stress. */
@Serializable
data class Utterance(val ids: List<Long> = emptyList(), val stress: List<Long> = emptyList(), val phonemes: String = "")

@Serializable
data class SpokenSentence(val text: String = "", val utterances: List<Utterance> = emptyList())

/** /api/voice/phonemes: `{ text }` in, each sentence's utterances out (none for a sentence with nothing to say). */
@Serializable
data class PhonemesResponse(val sentences: List<SpokenSentence> = emptyList())

/** The reply after your latest words, as the chat has it now. `key` changes when a new reply starts. */
data class CallReply(val key: String, val text: String, val done: Boolean)

object Voices {
    /**
     * The Hugging Face revision of tiny-voca Dex uses: the model and its phonemizer data must stay a matched pair. Apps
     * put it in the model's address, so a new revision is a new file to their caches.
     */
    const val TINY_VOCA_REVISION = "e5f9b11651a4db525fb207a56a91e4df2d1dd387"

    /** The `v` in the model's address, and what the downloaded file is kept under. */
    val modelVersion: String get() = TINY_VOCA_REVISION.take(12)

    /** Where an app downloads one of tiny-voca's files (signed in). */
    fun modelPath(file: String) = "/api/voice/model/$file?v=$modelVersion"

    /** The model's sample rate (config.json `sample_rate`). */
    const val SAMPLE_RATE = 24_000

    /** The longest text one phonemes request takes. */
    const val MAX_SPOKEN_CHARS = 4_000

    /** A sidekick without a voice of their own gets one from their id, so it stays the same from call to call. */
    fun voiceOf(id: String, voice: String?): Voice {
        Voice.fromId(voice)?.let { return it }
        // As JavaScript's `for (const char of id)` with `charCodeAt(0)`: a code point at a time, by its first unit.
        var hash = 0L
        var index = 0
        while (index < id.length) {
            val unit = id[index]
            hash = (hash * 31 + unit.code) and 0xFFFF_FFFFL
            index += if (unit.isHighSurrogate() && index + 1 < id.length && id[index + 1].isLowSurrogate()) 2 else 1
        }
        return Voice.entries[(hash % Voice.entries.size).toInt()]
    }

    fun voiceOf(character: CharacterProfile): Voice = voiceOf(character.id, character.voice)

    // ── Text ────────────────────────────────────────────────────────────────

    /** JavaScript's `\s`. */
    private const val WS = """\t\n\u000B\f\r    -     　﻿"""
    /** JavaScript's line terminators, for `^`, `$`, and `.` with the `m` flag. */
    private const val LT = """\n\r  """
    private const val BOL = """(?<![^$LT])"""
    private const val EOL = """(?![^$LT])"""
    private const val DOT = """[^$LT]"""
    /** `\b` before a word character (every use here). */
    private const val WORD_START = """(?<![A-Za-z0-9_])"""

    /** `[A-Za-z]` for each letter: JavaScript's `i` flag without `u` folds ASCII only, which Android's regex doesn't. */
    private fun anyCase(word: String) = word.map { if (it.isLetter()) "[${it.lowercaseChar()}${it.uppercaseChar()}]" else "\\$it" }.joinToString("")

    private val ABBREVIATIONS = Regex(
        "(?:$WORD_START(?:" +
            listOf("mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "no", "inc", "ltd", "co", "e.g", "i.e", "a.m", "p.m").joinToString("|", transform = ::anyCase) +
            ")|$WORD_START[A-Za-z])\\.\\z",
    )
    private val SPACES = Regex("[$WS]+")
    private val SENTENCE_BREAK = Regex("""(?<=[.!?…]["')\]]?)[$WS]+(?=["'(\[]?[A-Z0-9])""")
    private val SAYS_SOMETHING = Regex("""[\p{L}\p{N}]""")

    /**
     * Sentences, without breaking after titles, initials, or inside numbers. The same rule as tiny-voca's own
     * (`tiny_voca.infer.sentences`, and its web demo's worker.js).
     */
    fun sentences(text: String): List<String> {
        val parts = mutableListOf<String>()
        var current = ""
        for (piece in jsTrim(SPACES.replace(text, " ")).split(SENTENCE_BREAK)) {
            current = if (current.isNotEmpty()) "$current $piece" else piece
            if (!ABBREVIATIONS.containsMatchIn(current)) {
                parts += current
                current = ""
            }
        }
        if (current.isNotEmpty()) parts += current
        return parts.filter { SAYS_SOMETHING.containsMatchIn(it) }
    }

    private val TRAILING_SPACE = Regex("[$WS]+\\z")
    private val MARKED_WORD = Regex("""[.!?…,;:]["'”’)\]»]*\z""")
    private val STOP = Regex("[.!?…]")
    private val PAUSE = Regex("[,;:]")

    /**
     * The text with a full stop when it ends without a mark: before one the voice lets the last syllable fall, without
     * one the audio breaks off. A face or sign after the last word ("see you :)") is no mark; a comma or colon is.
     * The same rule as `tiny_voca.infer.finished`.
     */
    fun finished(text: String): String {
        val body = TRAILING_SPACE.replace(text, "")
        if (body.isEmpty()) return text
        val last = body.split(SPACES).last()
        val marked = if (SAYS_SOMETHING.containsMatchIn(last)) MARKED_WORD.containsMatchIn(last) else STOP.containsMatchIn(last) || PAUSE.matches(last)
        return if (marked) text else "$body."
    }

    private val CODE_BLOCK = Regex("```[\\s\\S]*?(```|\\z)")
    private val TABLE_ROW = Regex("""$BOL[$WS]*\|$DOT*\|[$WS]*$EOL""")
    private val IMAGE = Regex("""!\[[^\]]*\]\([^)]*\)""")
    private val LINK = Regex("""\[([^\]]+)\]\([^)]*\)""")
    private val TAG = Regex("""<[^>\n]+>""")
    private val INLINE_CODE = Regex("""`([^`]*)`""")
    private val HEADING = Regex("""$BOL[$WS]{0,3}#{1,6}[$WS]+($DOT*)$EOL""")
    private val LIST_ITEM = Regex("""$BOL[$WS]*(?:[-*+]|[0-9]+[.)])[$WS]+($DOT*)$EOL""")
    private val QUOTE = Regex("""$BOL[$WS]*>[$WS]?""")
    private val EMPHASIS = Regex("""(\*\*|__|\*|_|~~)(?=[^$WS])([^*_~\n]+?)\1""")
    private val URL = Regex("""https?://[^$WS]+""")
    private val RUNS = Regex("[ \\t]+")
    private val BLANK_LINES = Regex("\\n{2,}")

    /**
     * What of a reply's Markdown can be read aloud: code, tables, images, and UI cards are left out, links read as their
     * text, and the marks around words go.
     */
    fun speakable(markdown: String): String {
        var text = markdown
        text = CODE_BLOCK.replace(text, " ")
        text = TABLE_ROW.replace(text, " ")
        text = IMAGE.replace(text, " ")
        text = LINK.replace(text, "$1")
        text = TAG.replace(text, " ")
        text = INLINE_CODE.replace(text, "$1")
        text = HEADING.replace(text, "$1.")
        text = LIST_ITEM.replace(text) { finished(it.groupValues[1]) }
        text = QUOTE.replace(text, "")
        text = EMPHASIS.replace(text, "$2")
        text = URL.replace(text, "a link")
        text = RUNS.replace(text, " ")
        text = BLANK_LINES.replace(text, "\n")
        return jsTrim(text)
    }

    private val EDGES = Regex("^[$WS]+|[$WS]+\\z")
    private fun jsTrim(text: String) = EDGES.replace(text, "")

    /** Words, for telling the speaker's own voice in the microphone apart from yours (call.ts `words`). */
    fun words(text: String): List<String> = WORDS.findAll(text.lowercase()).map { it.value }.toList()
    private val WORDS = Regex("""[\p{L}\p{N}']+""")

    /** The reply after your latest message, as a call reads it: its text so far, and whether it's over (voice-call.tsx). */
    fun latestReply(transcript: TranscriptState): CallReply? {
        // Scan only entries after the last user message (instead of rebuilding DisplayItems for the whole history on every streamed token).
        var startEntry = 0
        var startMessage = 0
        outer@ for (entryIndex in transcript.entries.indices.reversed()) {
            val entry = transcript.entries[entryIndex]
            if (entry.kind == "pi.reset" || entry.kind == "pi.compaction") continue
            val models = entry.model ?: continue
            for (msgIndex in models.indices.reversed()) {
                if (models[msgIndex] is UserMessage) {
                    startEntry = entryIndex
                    startMessage = msgIndex + 1
                    break@outer
                }
            }
        }
        val messages = ArrayList<AssistantMessage>(4)
        var firstId: String? = null
        var dividerSeen = false
        for (entryIndex in startEntry until transcript.entries.size) {
            val entry = transcript.entries[entryIndex]
            if (entry.kind == "pi.reset" || entry.kind == "pi.compaction") {
                if (messages.isNotEmpty()) { dividerSeen = true; break }
                continue
            }
            val models = entry.model ?: continue
            val from = if (entryIndex == startEntry) startMessage else 0
            for (msgIndex in from until models.size) {
                val msg = models[msgIndex]
                if (msg is AssistantMessage) {
                    if (firstId == null) firstId = "${entry.id}:$msgIndex"
                    messages += msg
                }
            }
        }
        var isStreaming = false
        val streaming = transcript.streaming
        if (streaming != null && !dividerSeen) {
            if (firstId == null) firstId = "streaming"
            messages += streaming
            isStreaming = true
        }
        if (messages.isEmpty()) return null
        val text = messages
            .map { message -> message.content.filterIsInstance<TextBlock>().joinToString("") { it.text } }
            .filter { it.isNotEmpty() }
            .joinToString("\n\n")
        return CallReply(messages.first().timestamp.toString(), text, !transcript.running && !isStreaming)
    }
}

/**
 * Cuts a reply into sentences while it streams: [take] returns the sentences complete so far that haven't been taken
 * (a sentence is complete once text follows it), [rest] what's left once the reply has ended.
 */
class SentenceStream {
    private var spoken = 0
    private var last = ""
    private fun split(text: String) = Voices.sentences(Voices.speakable(text))

    fun take(text: String): List<String> {
        last = text
        val all = split(text)
        // The last sentence may still be growing.
        val complete = all.dropLast(1)
        val fresh = complete.drop(spoken)
        spoken = complete.size
        return fresh
    }

    fun rest(text: String = last): List<String> {
        val fresh = split(text).drop(spoken)
        spoken += fresh.size
        return fresh
    }
}
