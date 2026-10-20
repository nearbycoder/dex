package dev.trydex.openui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What a button, link, or form asks the host to do (ActionEvent). */
data class ActionEvent(
    /** continue_conversation, open_url, or a library action's name. */
    val type: String,
    val params: Map<String, Any?>,
    /** The label shown as the user's message in the chat. */
    val humanFriendlyMessage: String,
    /** The form's fields (`{ formName: { field: { value, componentType } } }`), or the whole store. */
    val formState: Map<String, Any?>?,
    val formName: String?,
) {
    companion object {
        const val CONTINUE_CONVERSATION = "continue_conversation"
        const val OPEN_URL = "open_url"
    }
}

/** A prop bound to state: its value and how to change it (StateField). */
class StateField(val name: String, val value: Any?, val isReactive: Boolean, val setValue: (Any?) -> Unit)

/** One render of a generated UI. */
data class RuntimeState(
    /** The root with every prop evaluated; null until the program has one. */
    val root: ElementNode? = null,
    val parse: ParseResult? = null,
    val streaming: Boolean = false,
    val queryLoading: Boolean = false,
    /** Failed queries: their fallback values must not pass as current data. */
    val queryErrors: List<OpenUIError> = emptyList(),
    /** Every problem, for the model that wrote the program (empty while streaming). */
    val errors: List<OpenUIError> = emptyList(),
    /** Bumps whenever state or queries change, so a UI reading fields redraws. */
    val revision: Long = 0,
)

/**
 * A generated UI's runtime: the streaming parser, its state store, its queries, and its actions, re-evaluated
 * whenever any of them change (react-lang's useOpenUIState, without React). Single-threaded: create it, call it, and
 * run its scope on one thread (the main thread in the app).
 */
class OpenUIRuntime(
    val catalog: Catalog,
    private val scope: CoroutineScope,
    toolProvider: ToolProvider?,
    private val functions: Map<String, RuntimeFunction> = emptyMap(),
) {
    var onAction: (ActionEvent) -> Unit = {}
    var onStateUpdate: (Map<String, Any?>) -> Unit = {}

    val store = Store()
    val queries = QueryManager(toolProvider, scope)
    private val parser = OpenUIParser(catalog).stream()

    private val _state = MutableStateFlow(RuntimeState())
    val state: StateFlow<RuntimeState> = _state.asStateFlow()

    private var response: String? = null
    private var streaming = false
    private var result: ParseResult? = null
    private var parseException: OpenUIError? = null
    private var initialState: Map<String, Any?>? = null
    private var initKey: String? = null
    private var initializing = false
    private var refreshing = false
    private var dirty = false
    private var revision = 0L
    private var lastQueryKey: String? = null
    private var lastMutationKey: String? = null
    private val jobs = ArrayList<Job>()
    /** The query snapshot the current state was computed from. */
    @Volatile private var rendered: QuerySnapshot? = null

    val context: EvaluationContext = EvaluationContext(
        getState = { unwrap(store.get(it)) },
        resolveRef = { name -> queries.mutationResult(name) ?: queries.result(name) },
        functions = functions,
        actions = catalog.actions,
    )

    init {
        store.subscribe {
            revision++
            if (!initializing) onStateUpdate(store.snapshot)
            refresh()
        }
        jobs += scope.launch {
            // Every snapshot, the current one included: one set before this started must still reach the tree.
            queries.snapshot.collect { snapshot ->
                if (snapshot === rendered) return@collect
                revision++
                refresh()
            }
        }
    }

    /** Sets the program (the render_ui `code` so far) and whether it's still streaming. */
    fun update(text: String?, isStreaming: Boolean) {
        if (text == response && isStreaming == streaming) return
        response = text
        streaming = isStreaming
        parseException = null
        result = if (text.isNullOrEmpty()) null else try {
            parser.set(text, !isStreaming)
        } catch (error: Exception) {
            parseException = OpenUIError(
                source = "parser", code = "parse-exception", message = "Parser crashed: ${error.message}",
                hint = "The response may contain syntax the parser cannot handle",
            )
            null
        }
        refresh()
    }

    /** Restores saved state: `$variables` as bindings, anything else as form state. */
    fun setInitialState(state: Map<String, Any?>?) {
        initialState = state
        refresh()
    }

    private fun unwrap(value: Any?): Any? = if (value is Map<*, *> && value.containsKey("value")) value["value"] else value

    private fun initializeStore() {
        val declarations = result?.stateDeclarations
        if (declarations == null && initialState == null) return
        val key = Js.json(declarations ?: emptyMap<String, Any?>()) + "::" + Js.json(initialState ?: emptyMap<String, Any?>())
        if (key == initKey) return
        initKey = key
        val bindings = LinkedHashMap<String, Any?>()
        initializing = true
        try {
            for ((name, value) in initialState.orEmpty()) {
                if (name.startsWith("$")) bindings[name] = value else store.set(name, value)
            }
            store.initialize(declarations ?: emptyMap(), bindings)
        } finally {
            initializing = false
        }
    }

    private fun syncQueries(result: ParseResult) {
        val snapshot = store.snapshot
        val nodes = result.queryStatements.map { q ->
            val deps = LinkedHashMap<String, Any?>()
            q.deps?.forEach { ref -> deps[ref] = if (snapshot.containsKey(ref)) snapshot[ref] else Undefined }
            QueryNode(
                statementId = q.statementId,
                toolName = q.toolAst?.let { Js.toStr(Evaluator.evaluate(it, context)) } ?: "",
                args = q.argsAst?.let { Evaluator.evaluate(it, context) },
                defaults = q.defaultsAst?.let { Evaluator.evaluate(it, context) },
                deps = deps.ifEmpty { null },
                refreshInterval = q.refreshAst?.let { (Evaluator.evaluate(it, context) as? Double) },
                complete = q.complete,
            )
        }
        val queryKey = nodes.joinToString("\n") { "${it.statementId}|${it.toolName}|${Js.stableStringify(it.args)}|${Js.stableStringify(it.defaults)}|${Js.stableStringify(it.deps)}|${it.refreshInterval}" }
        if (queryKey != lastQueryKey) {
            lastQueryKey = queryKey
            queries.evaluateQueries(nodes)
        }
        val mutations = result.mutationStatements.map { m -> MutationNode(m.statementId, m.toolAst?.let { Js.toStr(Evaluator.evaluate(it, context)) } ?: "") }
        val mutationKey = mutations.joinToString("\n") { "${it.statementId}|${it.toolName}" }
        if (mutationKey != lastMutationKey) {
            lastMutationKey = mutationKey
            queries.registerMutations(mutations)
        }
    }

    /** Re-evaluates everything. Re-entrant calls (state set while evaluating) run again once it's done. */
    private fun refresh() {
        if (refreshing) {
            dirty = true
            return
        }
        refreshing = true
        try {
            do {
                dirty = false
                compute()
            } while (dirty)
        } finally {
            refreshing = false
        }
    }

    private fun compute() {
        initializeStore()
        val result = result
        if (result != null && !streaming) syncQueries(result)
        val runtimeErrors = ArrayList<OpenUIError>()
        val root = if (result == null) null else try {
            Evaluator.evaluateRoot(result, context, catalog, runtimeErrors)
        } catch (error: Exception) {
            runtimeErrors += OpenUIError(source = "runtime", code = "runtime-error", message = "Prop evaluation failed: ${error.message}")
            result.root
        }
        val snapshot = queries.snapshot.value
        rendered = snapshot
        _state.value = RuntimeState(
            root = root,
            parse = result,
            streaming = streaming,
            queryLoading = snapshot.loading.isNotEmpty(),
            queryErrors = snapshot.errors.filter { it.source == "query" },
            errors = if (streaming) emptyList() else errors(result, runtimeErrors, snapshot),
            revision = revision,
        )
    }

    private fun errors(result: ParseResult?, runtime: List<OpenUIError>, snapshot: QuerySnapshot): List<OpenUIError> {
        val errors = ArrayList<OpenUIError>()
        parseException?.let { errors += it }
        if (!response.isNullOrEmpty() && (result?.meta?.statementCount ?: 0) == 0 && parseException == null) {
            errors += OpenUIError(
                source = "parser", code = "parse-failed", message = "Response could not be parsed as valid openui-lang",
                hint = "The entire response must be valid openui-lang code starting with root = ${catalog.root ?: "Root"}(...)",
            )
        }
        result?.meta?.errors?.forEach { e ->
            errors += OpenUIError(
                source = "parser", code = e.code, message = e.message, component = e.component, path = e.path.ifEmpty { null },
                statementId = e.statementId, severity = e.severity,
                hint = when (e.code) {
                    "unknown-component" -> catalog.components.keys.takeIf { it.isNotEmpty() }?.let { "Available components: ${it.joinToString(", ")}" }
                    "missing-required", "null-required" -> signatureHint(e.component)
                    "inline-reserved" -> "Declare as a top-level statement: myVar = ${e.component}(...)"
                    else -> null
                },
            )
        }
        errors += runtime
        errors += snapshot.errors
        return errors
    }

    private fun signatureHint(component: String): String? {
        val schema = catalog.schemas[component] ?: return null
        val properties = Js.obj(schema["properties"]) ?: return null
        val required = (schema["required"] as? List<*>)?.map { it.toString() }?.toSet() ?: emptySet()
        return "Signature: $component(${properties.keys.joinToString(", ") { if (it in required) "$it*" else it }}) — * marks required"
    }

    // ── Fields ───────────────────────────────────────────────────────────────

    fun fieldValue(formName: String?, name: String): Any? {
        if (formName == null) return unwrap(store.get(name))
        val form = store.get(formName) as? Map<*, *> ?: return Undefined
        return unwrap(if (form.containsKey(name)) form[name] else Undefined)
    }

    /** Stores a field's value as `{ value, componentType }`, under its form when it has one. */
    fun setFieldValue(formName: String?, componentType: String?, name: String, value: Any?) {
        val wrapped = linkedMapOf<String, Any?>("value" to value, "componentType" to (componentType ?: Undefined))
        if (formName == null) {
            store.set(name, wrapped)
        } else {
            @Suppress("UNCHECKED_CAST")
            val form = (store.get(formName) as? Map<String, Any?>) ?: emptyMap()
            store.set(formName, LinkedHashMap(form).apply { put(name, wrapped) })
        }
    }

    /** A prop that may be bound to a `$variable` (useStateField): reads and writes the variable, or the form field. */
    fun stateField(name: String, binding: Any?, formName: String?, componentType: String? = null): StateField {
        if (binding is ReactiveAssign) {
            return StateField(name, store.get(binding.target), isReactive = true) { value ->
                val next = Evaluator.evaluate(binding.expr, context.copy(extraScope = mapOf("\$value" to value)))
                store.set(binding.target, next)
            }
        }
        val current = fieldValue(formName, name)
        return StateField(name, if (Js.isNullish(current)) binding else current, isReactive = false) { value ->
            setFieldValue(formName, componentType, name, value)
        }
    }

    private fun formPayload(formName: String?): Map<String, Any?> {
        if (formName != null) {
            val form = store.get(formName)
            if (form is Map<*, *>) return mapOf(formName to form)
        }
        return store.snapshot
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    /**
     * Runs what a button or form does: a plan's steps in order (a failed mutation stops it), a legacy action object,
     * or, with neither, sends `userMessage` to the chat.
     */
    suspend fun triggerAction(userMessage: String, formName: String?, action: Any?) {
        val plan = when {
            action is ActionPlan -> action
            action is Map<*, *> && action["steps"] is List<*> -> Evaluator.ownSteps(action)
            else -> null
        }
        if (action is Map<*, *> && plan == null) {
            val type = (action["type"] as? String)?.takeIf { it.isNotEmpty() } ?: ActionEvent.CONTINUE_CONVERSATION
            // Only a real call delivers a library action; a legacy object can't pose as one.
            if (catalog.actions.containsKey(type)) return
            val params = LinkedHashMap<String, Any?>()
            (action["params"] as? Map<*, *>)?.forEach { (k, v) -> params[k.toString()] = v }
            if (Js.truthy(action["url"])) params["url"] = action["url"]
            if (Js.truthy(action["context"])) params["context"] = action["context"]
            onAction(ActionEvent(type, params, userMessage, formPayload(formName), formName))
            return
        }
        if (plan != null) {
            for (step in plan.steps) {
                when (step) {
                    is ActionStep.Run -> if (step.refType == "mutation") {
                        val statement = result?.mutationStatements?.firstOrNull { it.statementId == step.statementId }
                        @Suppress("UNCHECKED_CAST")
                        val args = statement?.argsAst?.let { Evaluator.evaluate(it, context) as? Map<String, Any?> } ?: emptyMap()
                        if (!queries.fireMutation(step.statementId, args)) return
                    } else {
                        queries.invalidate(listOf(step.statementId))
                    }
                    is ActionStep.ToAssistant -> onAction(
                        ActionEvent(
                            ActionEvent.CONTINUE_CONVERSATION,
                            if (step.context !== Undefined) mapOf("context" to step.context) else emptyMap(),
                            step.message, formPayload(formName), formName,
                        ),
                    )
                    is ActionStep.OpenUrl -> onAction(ActionEvent(ActionEvent.OPEN_URL, mapOf("url" to step.url), "", formPayload(formName), formName))
                    is ActionStep.Custom -> onAction(ActionEvent(step.name, step.params, "", formPayload(formName), formName))
                    is ActionStep.SetState -> store.set(step.target, Evaluator.evaluate(step.valueAst, context))
                    is ActionStep.Reset -> {
                        val declarations = result?.stateDeclarations ?: emptyMap()
                        for (target in step.targets) store.set(target, declarations[target], pristine = true)
                    }
                }
            }
            return
        }
        onAction(ActionEvent(ActionEvent.CONTINUE_CONVERSATION, emptyMap(), userMessage, formPayload(formName), formName))
    }

    /** Refetches the queries that failed. */
    fun retryQueries() {
        queries.invalidate(_state.value.queryErrors.mapNotNull { it.statementId })
    }

    fun dispose() {
        jobs.forEach { it.cancel() }
        queries.dispose()
        store.dispose()
    }
}
