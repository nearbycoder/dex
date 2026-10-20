package dev.trydex.openui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * A component library, compiled from the JSON Schema `openui generate --spec` writes (`schema` in openui-spec.json):
 * each component's params in positional order, the call registry (built-ins plus the library's functions and
 * actions), and which props bind two-way (`$binding<…>` in the signatures).
 */
class Catalog(
    val root: String?,
    val components: Map<String, List<ParamDef>>,
    val calls: Map<String, CallDef>,
    /** Library function schemas (`{ params, returns }`), by name. */
    val functions: Map<String, Map<String, Any?>>,
    /** Library action schemas (`{ params }`), by name. */
    val actions: Map<String, Map<String, Any?>>,
    /** Props each component binds two-way to a `$variable`. */
    val reactive: Map<String, Set<String>>,
    /** Each component's JSON Schema, for hints. */
    val schemas: Map<String, Map<String, Any?>>,
) {
    fun isReactive(component: String, prop: String) = reactive[component]?.contains(prop) == true

    companion object {
        private val ACTION_DEFS = listOf("ActionExpression", "OpenUrl", "ToAssistant")
        private val BINDING = Regex("(\\w+)\\??:\\s*\\\$binding<")

        /** Reads openui-spec.json: its `root`, `schema`, and `components` (for the binding signatures). */
        fun fromSpec(specJson: String): Catalog {
            val spec = Json.parseToJsonElement(specJson).jsonObject
            val schema = Js.obj(Js.fromJson(spec["schema"]))!!
            val reactive = spec["components"]?.jsonObject?.mapValues { (_, value) ->
                val signature = Js.toStr(Js.get(Js.fromJson(value), "signature"))
                BINDING.findAll(signature).map { it.groupValues[1] }.toSet()
            }?.filterValues { it.isNotEmpty() } ?: emptyMap()
            return compile(schema, (Js.fromJson(spec["root"]) as? String), reactive)
        }

        fun compile(schema: Map<String, Any?>, root: String?, reactive: Map<String, Set<String>> = emptyMap()): Catalog {
            val defsSchema = Js.obj(schema["\$defs"]) ?: emptyMap()
            val componentNames = Js.obj(schema["properties"])?.keys
            val functions = Js.obj(schema["functions"])?.mapValues { Js.obj(it.value) ?: emptyMap() } ?: emptyMap()
            val actions = Js.obj(schema["actions"])?.mapValues { Js.obj(it.value) ?: emptyMap() } ?: emptyMap()
            // Action $defs (ActionExpression, OpenUrl, custom actions) are data shapes, never components.
            val defs = LinkedHashMap<String, Any?>()
            for (name in ACTION_DEFS + actions.keys) {
                val body = defsSchema[name]
                if (body != null && componentNames?.contains(name) != true) defs["#/\$defs/$name"] = body
            }
            val components = LinkedHashMap<String, List<ParamDef>>()
            val schemas = LinkedHashMap<String, Map<String, Any?>>()
            for ((name, def) in defsSchema) {
                // Skip non-component defs (zod's hoisted recursive schemas, action shapes).
                if (if (componentNames != null) name !in componentNames else defs.containsKey("#/\$defs/$name")) continue
                val body = Js.obj(def) ?: continue
                components[name] = params(body, defs)
                schemas[name] = body
            }
            val calls = LinkedHashMap(Builtins.CALLS)
            for ((name, fn) in functions) calls[name] = CallDef("function", params(Js.obj(fn["params"]) ?: emptyMap(), defs))
            for ((name, action) in actions) calls[name] = CallDef("action", params(Js.obj(action["params"]) ?: emptyMap(), defs))
            return Catalog(root, components, calls, functions, actions, reactive, schemas)
        }

        private fun params(def: Map<String, Any?>, defs: Map<String, Any?>): List<ParamDef> {
            val properties = Js.obj(def["properties"]) ?: emptyMap()
            val required = (def["required"] as? List<*>)?.map { it.toString() } ?: emptyList()
            return properties.map { (key, schema) ->
                ParamDef(
                    name = key,
                    required = key in required,
                    defaultValue = Validation.schemaDefault(schema),
                    schema = if (defs.isNotEmpty()) inlineActionRefs(schema, defs) else schema,
                )
            }
        }

        /** `{ $ref: "#/$defs/ActionExpression" }` → its body, so action slots validate as inline unions. */
        private fun inlineActionRefs(node: Any?, defs: Map<String, Any?>): Any? = when (node) {
            is Map<*, *> -> {
                val ref = node["\$ref"]
                if (ref is String) {
                    if (defs.containsKey(ref)) inlineActionRefs(defs[ref], defs) else node
                } else {
                    LinkedHashMap<String, Any?>().apply { for ((key, value) in node) put(key.toString(), inlineActionRefs(value, defs)) }
                }
            }
            is List<*> -> node.map { inlineActionRefs(it, defs) }
            else -> node
        }
    }
}
