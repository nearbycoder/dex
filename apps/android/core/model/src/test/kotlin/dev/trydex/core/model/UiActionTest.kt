package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Test

/** UI actions read as the web reads them (tools/goldens/ui-action.mts). */
class UiActionTest {
    private val golden: JsonObject =
        DexJson.parseToJsonElement(javaClass.getResourceAsStream("/golden/ui-action.json")!!.bufferedReader().use { it.readText() }).jsonObject

    @Test fun parsesAsTheWebDoes() {
        for (case in golden["parse"]!!.jsonArray.map { it.jsonObject }) {
            val input = case["input"].str!!
            val expected = case["action"]
            val parsed = UiAction.parse(input)
            if (expected == null || expected is JsonNull) {
                assertWithMessage(input).that(parsed).isNull()
                continue
            }
            assertWithMessage(input).that(parsed?.message).isEqualTo(expected.jsonObject["message"].str)
            assertWithMessage(input).that(parsed?.details?.map { it.label to it.value })
                .isEqualTo(expected.jsonObject["details"]!!.jsonArray.map { it.jsonObject["label"].str to it.jsonObject["value"].str })
        }
    }

    @Test fun wordsForListsAndScreenReaders() {
        val text = "[UI action] Deploy it\nForm values: {\"env\":{\"value\":\"prod\"},\"notify\":true}\nContext: \"now\""
        assertThat(UiAction.strip(text)).isEqualTo("Deploy it")
        assertThat(UiAction.strip("plain")).isEqualTo("plain")
        assertThat(UiAction.parse(text)!!.spoken).isEqualTo("Pressed in the UI: Deploy it. env prod, notify Yes, now")
        assertThat(UiAction.parse("[UI action] Go")!!.spoken).isEqualTo("Pressed in the UI: Go")
    }
}
