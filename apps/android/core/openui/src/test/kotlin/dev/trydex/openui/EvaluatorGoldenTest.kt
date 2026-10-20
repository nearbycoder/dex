package dev.trydex.openui

import com.google.common.truth.Truth.assertWithMessage
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

/** Evaluated trees match lang-core's for the same state and query results (goldens: tools/goldens/openui.mts). */
class EvaluatorGoldenTest {
    private val catalog = DexLibrary.catalog

    private val queryResults: Map<String, Any?> = mapOf(
        "sessions" to mapOf("rows" to listOf(mapOf("title" to "First chat", "busy" to true), mapOf("title" to "Second", "busy" to false))),
        "stop" to mapOf("status" to "idle"),
    )

    private fun fn(name: String, body: (Map<String, Any?>) -> Any?): RuntimeFunction {
        val schema = catalog.functions.getValue(name)
        return RuntimeFunction(Js.obj(schema["params"]) ?: emptyMap(), schema["returns"], body)
    }

    private val functions = mapOf(
        "Ago" to fn("Ago") { "ago(${Js.toStr(it["time"])})" },
        "DateTime" to fn("DateTime") { "dt(${Js.toStr(it["time"])})" },
        "Bytes" to fn("Bytes") { "${Js.toStr(it["bytes"])} bytes" },
    )

    @Test fun evaluatesLikeLangCore() {
        val failures = mutableListOf<String>()
        val programs = GoldenSupport.load("parse.json")
        val golden = GoldenSupport.load("evaluate.json")
        for ((name, expected) in golden) {
            val program = programs.getValue(name).jsonObject["program"]!!.jsonPrimitive.content
            val result = OpenUIParser(catalog).parse(program)
            val store = Store()
            store.initialize(result.stateDeclarations, emptyMap())
            val reported = mutableListOf<String>()
            val context = EvaluationContext(
                getState = { store.get(it) },
                resolveRef = { queryResults[it] },
                functions = functions,
                actions = catalog.actions,
                reportError = { reported += it },
            )
            val runtime = mutableListOf<OpenUIError>()
            val root = runCatching { Evaluator.evaluateRoot(result, context, catalog, runtime) }
            val actual = buildJsonObject {
                put("root", root.fold({ it?.toJson() ?: kotlinx.serialization.json.JsonNull }, { buildJsonObject { put("threw", JsonPrimitive(it.toString())) } }))
                put("errors", JsonArray(reported.map { JsonPrimitive(it) }))
                put("runtimeErrors", JsonArray(runtime.map { e ->
                    buildJsonObject {
                        put("source", JsonPrimitive(e.source))
                        put("code", JsonPrimitive(e.code))
                        e.component?.let { put("component", JsonPrimitive(it)) }
                        e.statementId?.let { put("statementId", JsonPrimitive(it)) }
                        put("message", JsonPrimitive(e.message))
                        e.hint?.let { put("hint", JsonPrimitive(it)) }
                    }
                }))
                put("queries", JsonArray(result.queryStatements.map { q ->
                    buildJsonObject {
                        put("statementId", JsonPrimitive(q.statementId))
                        put("tool", Js.toJson(q.toolAst?.let { Evaluator.evaluate(it, context) }))
                        put("args", Js.toJson(q.argsAst?.let { Evaluator.evaluate(it, context) }))
                        put("defaults", Js.toJson(q.defaultsAst?.let { Evaluator.evaluate(it, context) }))
                        put("refresh", Js.toJson(q.refreshAst?.let { Evaluator.evaluate(it, context) }))
                    }
                }))
                put("state", Js.toJson(store.snapshot))
            }
            GoldenSupport.diff(expected, actual)?.let { failures += "$name: $it" }
        }
        assertWithMessage(failures.joinToString("\n")).that(failures).isEmpty()
        assertWithMessage("cases").that(golden.size).isAtLeast(40)
    }
}
