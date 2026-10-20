package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Test
import java.time.ZoneId

/**
 * Compares the Kotlin ports with goldens written by the web app's own code (tools/goldens/generate.mts), so the app
 * formats, groups, and folds things exactly as the web does.
 */
class GoldenTest {
    private fun golden(name: String): JsonObject {
        val text = javaClass.getResourceAsStream("/golden/$name")!!.bufferedReader().use { it.readText() }
        return DexJson.parseToJsonElement(text).jsonObject
    }

    private fun JsonElement.items(key: String): List<JsonObject> = jsonObject[key]!!.jsonArray.map { it.jsonObject }

    @Test fun timeAgo() {
        val format = golden("format.json")
        val now = format["now"].long!!
        for (case in format.items("timeAgo")) {
            val at = case["at"].long!!
            assertWithMessage("timeAgo(${at - now})").that(Format.timeAgo(at, now)).isEqualTo(case["text"].str)
        }
    }

    @Test fun numbers() {
        val format = golden("format.json")
        for (case in format.items("bytes")) assertThat(Format.bytes(case["value"].long!!)).isEqualTo(case["text"].str)
        for (case in format.items("installs")) assertThat(Format.installs(case["value"].long!!)).isEqualTo(case["text"].str)
        for (case in format.items("tokens")) assertThat(formatTokens(case["value"].long!!)).isEqualTo(case["text"].str)
        for (case in format.items("usd")) {
            assertWithMessage("usd(${case["value"]})").that(Format.usd(case["value"].num!!)).isEqualTo(case["text"].str)
        }
        for (case in format.items("compact")) {
            assertWithMessage("compact(${case["value"]})").that(Format.compact(case["value"].num!!)).isEqualTo(case["text"].str)
        }
    }

    @Test fun thinkingLevelsAndProviders() {
        val golden = golden("models.json")
        val registry = ModelRegistry()
        val connections = golden["connections"]!!.jsonArray.map { connection ->
            mapOf(
                ModelProvider.ClinePass to (connection["clinepass"].bool == true),
                ModelProvider.OpenCodeGo to (connection["opencode-go"].bool == true),
            )
        }
        for (case in golden.items("models")) {
            val model = registry.find(case["id"].str!!)
            assertWithMessage(case["id"].str).that(model).isNotNull()
            assertWithMessage("supported ${model!!.id}")
                .that(supportedThinkingLevels(model).map { it.id })
                .isEqualTo(case["supported"]!!.jsonArray.map { it.str })
            for ((level, expected) in case["clamped"]!!.jsonObject) {
                assertWithMessage("clamp ${model.id} $level")
                    .that(clampThinking(model, ThinkingLevel.fromId(level)!!).id)
                    .isEqualTo(expected.str)
            }
            case["usable"]!!.jsonArray.forEachIndexed { index, expected ->
                assertWithMessage("usable ${model.id} #$index").that(registry.usableModel(model.id, connections[index])).isEqualTo(expected.str)
            }
        }
        val unknown = golden["unknown"]!!.jsonObject
        assertThat(supportedThinkingLevels(registry.find("nope/none"))).isEmpty()
        unknown["usable"]!!.jsonArray.forEachIndexed { index, expected ->
            assertThat(registry.usableModel("opencode-go/retired", connections[index])).isEqualTo(expected.str)
        }
    }

    @Test fun toolsSkillsAndNotes() {
        val golden = golden("tools.json")
        for (case in golden.items("activity")) assertThat(Tools.activity(case["name"].str!!)).isEqualTo(case["text"].str)
        for (case in golden.items("summarize")) {
            assertWithMessage("summarize ${case["args"]}").that(Tools.summarize(case["args"])).isEqualTo(case["text"].str)
        }
        for (case in golden.items("invoked")) {
            assertWithMessage("invoked ${case["text"]}").that(Skills.invoked(case["text"].str!!)).isEqualTo(case["skill"].str)
        }
        for (case in golden.items("slug")) assertThat(Skills.slug(case["text"].str!!)).isEqualTo(case["slug"].str)
        for (case in golden.items("uiNotes")) {
            val split = UiNotes.split(case["input"].str!!)
            assertThat(split.notes).isEqualTo(case["notes"]!!.jsonArray.map { it.str })
            assertThat(split.text).isEqualTo(case["text"].str)
        }
    }

    @Test fun mediaAndRepos() {
        val golden = golden("media.json")
        for (case in golden.items("sources")) {
            val url = case["url"].str!!
            val expected = case["source"] as? JsonObject
            val actual = Media.source(url)
            if (expected == null) {
                assertWithMessage("source $url").that(actual).isNull()
                continue
            }
            assertWithMessage("source $url").that(actual).isNotNull()
            val (kind, extra) = when (actual) {
                is Media.Source.Own -> "own" to actual.kind.name.lowercase()
                is Media.Source.Vm -> "vm" to actual.kind.name.lowercase()
                is Media.Source.YouTube -> "youtube" to actual.id
                is Media.Source.Vimeo -> "vimeo" to actual.id
                is Media.Source.File -> "file" to null
                null -> error("unreachable")
            }
            assertWithMessage("kind $url").that(kind).isEqualTo(expected["kind"].str)
            val expectedExtra = expected["media"].str ?: expected["id"].str
            assertWithMessage("detail $url").that(extra).isEqualTo(expectedExtra)
        }
        for (case in golden.items("vmLinks")) {
            assertThat(Media.vmLinks(case["text"].str!!)).isEqualTo(case["links"]!!.jsonArray.map { it.str })
        }
        for (case in golden.items("repos")) {
            val input = case["input"].str!!
            val url = Repos.normalize(input)
            assertWithMessage("normalize $input").that(url).isEqualTo(case["url"].str)
            assertWithMessage("label $input").that(Repos.label(url ?: input)).isEqualTo(case["label"].str)
            assertWithMessage("dir $input").that(Repos.dirName(url ?: input)).isEqualTo(case["dir"].str)
            assertWithMessage("fullName $input").that(url?.let(Repos::githubFullName)).isEqualTo(case["fullName"].str)
        }
    }

    @Test fun inbox() {
        val golden = golden("inbox.json")
        val zone = ZoneId.of(golden["zone"].str!!)
        for (case in golden.items("snooze")) {
            val now = case["now"].long!!
            val options = Snooze.options(now, zone)
            val expected = case.items("options")
            assertWithMessage("snooze at $now").that(options.map { it.label }).isEqualTo(expected.map { it["label"].str })
            assertWithMessage("snooze times at $now").that(options.map { it.at }).isEqualTo(expected.map { it["at"].long!! })
            assertWithMessage("snooze labels at $now")
                .that(options.map { Snooze.untilLabel(it.at, now, zone) })
                .isEqualTo(expected.map { it["until"].str })
        }
        val now = golden("format.json")["now"].long!!
        for (case in golden.items("states")) {
            val session = SessionMeta(id = "x", snoozedUntil = case["snoozedUntil"].long, settledAt = case["settledAt"].long)
            assertThat(inboxState(session, now).name.lowercase()).isEqualTo(case["state"].str)
        }
    }

    @Test fun transcriptReducer() {
        val golden = golden("transcript.json")
        var state = TranscriptState.Empty
        golden.items("steps").forEachIndexed { index, step ->
            state = TranscriptReducer.applyAll(state, PiCodec.events(step["events"] as JsonArray))
            val expected = step["state"]!!.jsonObject
            val label = "step $index"
            assertWithMessage("$label entries").that(state.entries.map { it.id }).isEqualTo(expected["entries"]!!.jsonArray.map { it.long })
            assertWithMessage("$label running").that(state.running).isEqualTo(expected["running"].bool)
            assertWithMessage("$label queued").that(state.queued).isEqualTo(expected["queued"].long!!.toInt())
            assertWithMessage("$label loaded").that(state.loaded).isEqualTo(expected["loaded"].bool)
            assertWithMessage("$label error").that(state.error).isEqualTo(expected["error"].str)
            assertWithMessage("$label retry").that(state.retry?.error).isEqualTo(expected["retry"]?.get("error").str)
            assertWithMessage("$label streaming").that(state.streaming.toComparable()).isEqualTo(expected["streaming"].toComparableMessage())
            val tools = expected["tools"]!!.jsonObject
            assertWithMessage("$label tools").that(state.tools.keys).isEqualTo(tools.keys)
            for ((id, tool) in tools) {
                val actual = state.tools.getValue(id)
                assertWithMessage("$label tool $id").that(actual.status).isEqualTo(tool["status"].str)
                assertWithMessage("$label tool $id output").that(actual.output).isEqualTo(tool["output"].str)
                assertWithMessage("$label tool $id details").that(actual.details).isEqualTo(tool["details"])
            }
            val items = displayItems(state).map { item ->
                when (item) {
                    is DisplayItem.User -> listOf("user", item.id, item.text, item.images.toString())
                    is DisplayItem.Divider -> listOf("divider", item.id, item.label)
                    is DisplayItem.Assistant -> listOf(
                        "assistant", item.id, item.streaming.toString(), item.endedAt.toString(), item.messages.size.toString(),
                        item.messages.flatMap { m -> m.content.map { it.typeName() } }.joinToString(","),
                    )
                }
            }
            val expectedItems = step.items("items").map { item ->
                when (item["kind"].str) {
                    "user" -> listOf("user", item["id"].str, item["text"].str, item["images"].long.toString())
                    "divider" -> listOf("divider", item["id"].str, item["label"].str)
                    else -> listOf(
                        "assistant", item["id"].str, item["streaming"].bool.toString(), item["endedAt"].long.toString(),
                        item["messages"].long.toString(), item["blocks"]!!.jsonArray.joinToString(",") { it.str!! },
                    )
                }
            }
            assertWithMessage("$label items").that(items).isEqualTo(expectedItems)
            assertWithMessage("$label results").that(toolResults(state.entries).keys.toList()).isEqualTo(step["results"]!!.jsonArray.map { it.str })
        }
        val mid = golden["midRun"]!!.jsonObject
        val fromMid = TranscriptReducer.fromSnapshot(PiCodec.snapshot(mid["snapshot"]!!.jsonObject))
        assertThat(fromMid.running).isEqualTo(mid["running"].bool)
        assertThat(fromMid.queued).isEqualTo(mid["queued"].long!!.toInt())
        assertThat(fromMid.retry?.error).isEqualTo(mid["retry"]?.get("error").str)
        assertThat(fromMid.retry?.at).isEqualTo(mid["retry"]?.get("at").long)
        assertThat(fromMid.streaming.toComparable()).isEqualTo(mid["streaming"].toComparableMessage())
        assertThat(fromMid.tools.keys).isEqualTo(mid["tools"]!!.jsonObject.keys)
        assertThat(fromMid.tools.getValue("c").output).isEqualTo("out")
    }

    private fun ContentBlock.typeName() = when (this) {
        is TextBlock -> "text"
        is ThinkingBlock -> "thinking"
        is ToolCallBlock -> "toolCall"
        is ImageBlock -> "image"
        is OtherBlock -> type
    }

    /** A streaming message as comparable text: its blocks' types and contents. */
    private fun AssistantMessage?.toComparable(): String? = this?.content?.joinToString(" | ") { block ->
        when (block) {
            is TextBlock -> "text:${block.text}"
            is ThinkingBlock -> "thinking:${block.thinking}"
            is ToolCallBlock -> "toolCall:${block.name}:${block.arguments}"
            is ImageBlock -> "image"
            is OtherBlock -> "other"
        }
    }

    private fun JsonElement?.toComparableMessage(): String? {
        if (this == null || this is JsonNull) return null
        return this["content"]!!.jsonArray.joinToString(" | ") { block ->
            when (block["type"].str) {
                "text" -> "text:${block["text"].str}"
                "thinking" -> "thinking:${block["thinking"].str}"
                "toolCall" -> "toolCall:${block["name"].str}:${block["arguments"]}"
                "image" -> "image"
                else -> "other"
            }
        }.ifEmpty { "" }
    }
}
