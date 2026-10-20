package dev.trydex.openui

import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import org.junit.Test

/** The Kotlin parser gives exactly what lang-core's gives, whole and streamed (goldens: tools/goldens/openui.mts). */
class ParserGoldenTest {
    private val catalog = DexLibrary.catalog

    @Test fun parsesLikeLangCore() {
        val failures = mutableListOf<String>()
        val golden = GoldenSupport.load("parse.json")
        assertWithMessage("cases").that(golden.size).isAtLeast(40)
        var withRoot = 0
        for ((name, case) in golden) {
            val program = case.jsonObject["program"]!!.jsonPrimitive.content
            val actual = runCatching { OpenUIParser(catalog).parse(program).toJson() }
            val problem = actual.fold({ GoldenSupport.diff(case.jsonObject["result"], it) }, { "threw $it" })
            if (problem != null) failures += "$name: $problem"
            if (actual.getOrNull()?.get("root") is kotlinx.serialization.json.JsonObject) withRoot++
        }
        assertWithMessage("programs with a root").that(withRoot).isAtLeast(30)
        assertWithMessage(failures.joinToString("\n")).that(failures).isEmpty()
    }

    @Test fun diffCatchesDifferences() {
        val a = kotlinx.serialization.json.Json.parseToJsonElement("""{"x":[1,{"y":"a"}]}""")
        val b = kotlinx.serialization.json.Json.parseToJsonElement("""{"x":[1,{"y":"b"}]}""")
        val c = kotlinx.serialization.json.Json.parseToJsonElement("""{"x":[1.0,{"y":"a"}]}""")
        assertWithMessage("different").that(GoldenSupport.diff(a, b)).isNotNull()
        assertWithMessage("same numbers").that(GoldenSupport.diff(a, c)).isNull()
    }

    @Test fun streamsLikeLangCore() {
        val failures = mutableListOf<String>()
        val programs = GoldenSupport.load("parse.json")
        var checked = 0
        for ((name, steps) in GoldenSupport.load("stream.json")) {
            val program = programs[name]!!.jsonObject["program"]!!.jsonPrimitive.content
            val stream = OpenUIParser(catalog).stream()
            checked += (steps as JsonArray).size
            for (step in steps) {
                val length = step.jsonObject["length"]!!.jsonPrimitive.int
                val complete = length == program.length
                val actual = runCatching { stream.set(program.substring(0, length), complete).toJson() }
                val problem = actual.fold({ GoldenSupport.diff(step.jsonObject["result"], it) }, { "threw $it" })
                if (problem != null) {
                    failures += "$name @$length: $problem"
                    break
                }
            }
        }
        assertWithMessage(failures.joinToString("\n")).that(failures).isEmpty()
        assertWithMessage("stream steps").that(checked).isAtLeast(300)
    }
}
