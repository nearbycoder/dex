package dev.trydex.openui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Runs a Query or Mutation's tool (Dex: an app operation through DexAgent.runUiOperation). */
fun interface ToolProvider {
    suspend fun callTool(name: String, args: Map<String, Any?>): Any?
}

/** A tool that answered with an error (McpToolError). */
class ToolError(val text: String) : Exception("MCP tool error: ${text.ifEmpty { "Unknown error" }}")

class ToolNotFound(val toolName: String, val available: List<String> = emptyList()) : Exception("No handler for tool \"$toolName\"")

data class QueryNode(
    val statementId: String,
    val toolName: String,
    val args: Any?,
    val defaults: Any?,
    /** Evaluated `$variable` dependencies: part of the cache key, so a change refetches. */
    val deps: Any? = null,
    /** Auto-refresh interval, in seconds. */
    val refreshInterval: Double? = null,
    val complete: Boolean = true,
)

data class MutationNode(val statementId: String, val toolName: String)

/** What the queries show now: each statement's data (or defaults), and which are loading or failed. */
data class QuerySnapshot(
    val values: Map<String, Any?> = emptyMap(),
    val loading: List<String> = emptyList(),
    val refetching: List<String> = emptyList(),
    val errors: List<OpenUIError> = emptyList(),
)

/**
 * Query() fetching and caching, and Mutation() runs (runtime/queryManager.ts). Single-threaded: call it, and run its
 * scope, on one thread (the main thread in the app).
 */
class QueryManager(private val provider: ToolProvider?, private val scope: CoroutineScope) {
    private class QueryEntry(
        var toolName: String,
        var args: Any?,
        var defaults: Any?,
        var cacheKey: String,
        var prevCacheKey: String? = null,
        var loading: Boolean = false,
        var everFetched: Boolean = false,
        var refreshInterval: Double = 0.0,
        var timer: Job? = null,
        var needsRefetch: Boolean = false,
        var error: OpenUIError? = null,
    )

    private class MutationEntry(var toolName: String, var result: Map<String, Any?>, var error: OpenUIError? = null)

    private class CacheEntry(var data: Any? = Undefined, var inFlight: Boolean = false)

    private val queries = LinkedHashMap<String, QueryEntry>()
    private val mutations = LinkedHashMap<String, MutationEntry>()
    private val cache = HashMap<String, CacheEntry>()
    private var disposed = false
    private var generation = 0

    private val _snapshot = MutableStateFlow(QuerySnapshot())
    val snapshot: StateFlow<QuerySnapshot> = _snapshot.asStateFlow()
    private var snapshotJson = ""

    private fun cacheKey(toolName: String, args: Any?, deps: Any?): String =
        toolName + "::" + Js.stableStringify(args) + (if (Js.isNullish(deps)) "" else "::" + Js.stableStringify(deps))

    private fun rebuild(): Boolean {
        val values = LinkedHashMap<String, Any?>()
        val loading = ArrayList<String>()
        val refetching = ArrayList<String>()
        val errors = ArrayList<OpenUIError>()
        for ((id, q) in queries) {
            val entry = cache[q.cacheKey]
            values[id] = when {
                entry != null && entry.data !== Undefined -> entry.data
                q.prevCacheKey != null -> cache[q.prevCacheKey!!]?.data?.takeIf { it !== Undefined } ?: q.defaults
                else -> q.defaults
            }
            if (q.loading) {
                loading += id
                if (q.everFetched) refetching += id
            }
            q.error?.let { errors += it }
        }
        for ((id, m) in mutations) {
            values[id] = m.result
            m.error?.let { errors += it }
        }
        val next = QuerySnapshot(values, loading, refetching, errors)
        val json = Js.json(values) + loading + refetching + errors
        if (json == snapshotJson) return false
        snapshotJson = json
        _snapshot.value = next
        return true
    }

    private fun queryError(statementId: String, toolName: String, error: Throwable) = when (error) {
        is ToolNotFound -> OpenUIError(
            source = "query", code = "tool-not-found", message = "Query tool \"$toolName\" not found", statementId = statementId,
            component = "Query", toolName = toolName,
            hint = error.available.takeIf { it.isNotEmpty() }?.let { "Available tools: ${it.joinToString(", ")}" },
        )
        is ToolError -> OpenUIError(
            source = "query", code = "mcp-error", message = "Query \"$toolName\" returned an error: ${error.text}",
            statementId = statementId, component = "Query", toolName = toolName,
        )
        else -> OpenUIError(
            source = "query", code = "tool-error", message = "Query \"$toolName\" failed: ${error.message ?: error}",
            statementId = statementId, component = "Query", toolName = toolName,
        )
    }

    private fun fetch(key: String, statementId: String) {
        val provider = provider ?: return
        val q = queries[statementId] ?: return
        val toolName = q.toolName
        @Suppress("UNCHECKED_CAST")
        val args = (q.args as? Map<String, Any?>) ?: emptyMap()
        val entry = cache.getOrPut(key) { CacheEntry() }
        entry.inFlight = true
        q.loading = true
        rebuild()
        scope.launch {
            try {
                val data = provider.callTool(toolName, args)
                if (disposed) return@launch
                val current = queries[statementId]
                if (current == null || current.cacheKey != key) {
                    entry.inFlight = false
                    return@launch
                }
                entry.data = if (data === Undefined) null else data
                current.everFetched = true
                current.error = null
                current.prevCacheKey?.takeIf { it != key }?.let { previous ->
                    current.prevCacheKey = null
                    cleanup(previous)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                val current = queries[statementId]
                if (current != null && current.cacheKey == key) current.error = queryError(statementId, toolName, error)
            } finally {
                entry.inFlight = false
                val current = queries[statementId]
                if (current != null && current.cacheKey == key) {
                    current.loading = false
                    rebuild()
                    if (current.needsRefetch) {
                        current.needsRefetch = false
                        fetch(current.cacheKey, statementId)
                    }
                } else {
                    rebuild()
                }
            }
        }
    }

    private fun cleanup(key: String) {
        if (queries.values.any { it.cacheKey == key || it.prevCacheKey == key }) return
        cache.remove(key)
    }

    fun evaluateQueries(nodes: List<QueryNode>) {
        if (disposed) return
        val active = nodes.map { it.statementId }.toSet()
        for ((id, q) in queries.entries.toList()) {
            if (id !in active) {
                q.timer?.cancel()
                queries.remove(id)
                cleanup(q.cacheKey)
                q.prevCacheKey?.let(::cleanup)
            }
        }
        for (node in nodes) {
            if (!node.complete) continue
            val key = cacheKey(node.toolName, node.args, node.deps)
            val existing = queries[node.statementId]
            if (existing != null) {
                if (existing.cacheKey != key) existing.prevCacheKey = existing.cacheKey
                existing.toolName = node.toolName
                existing.args = node.args
                existing.defaults = node.defaults
                existing.cacheKey = key
            } else {
                queries[node.statementId] = QueryEntry(node.toolName, node.args, node.defaults, key)
            }
            val q = queries.getValue(node.statementId)
            val entry = cache[key]
            val settled = entry != null && entry.data !== Undefined && !entry.inFlight
            if (provider != null && !settled && entry?.inFlight != true) fetch(key, node.statementId)

            val interval = node.refreshInterval?.takeIf { it.isFinite() } ?: 0.0
            if (interval != q.refreshInterval) {
                q.timer?.cancel()
                q.timer = null
                if (interval > 0) {
                    q.timer = scope.launch {
                        while (isActive) {
                            delay((interval * 1000).toLong().coerceAtLeast(250))
                            if (disposed || provider == null) break
                            if (cache[q.cacheKey]?.inFlight != true) fetch(q.cacheKey, node.statementId)
                        }
                    }
                }
                q.refreshInterval = interval
            }
        }
        rebuild()
    }

    fun result(statementId: String): Any? {
        val q = queries[statementId] ?: return null
        cache[q.cacheKey]?.data?.takeIf { it !== Undefined }?.let { return it }
        q.prevCacheKey?.let { previous -> cache[previous]?.data?.takeIf { it !== Undefined }?.let { return it } }
        return q.defaults
    }

    fun isLoading(statementId: String) = queries[statementId]?.loading ?: false

    /** Refetches the given queries (all with none). */
    fun invalidate(statementIds: List<String>? = null) {
        if (disposed || provider == null) return
        val targets = if (statementIds.isNullOrEmpty()) queries.keys.toList() else statementIds.filter { it in queries }
        for (id in targets) {
            val q = queries[id] ?: continue
            if (cache[q.cacheKey]?.inFlight == true) q.needsRefetch = true else fetch(q.cacheKey, id)
        }
    }

    fun registerMutations(nodes: List<MutationNode>) {
        val active = nodes.map { it.statementId }.toSet()
        mutations.keys.retainAll(active)
        for (node in nodes) {
            val existing = mutations[node.statementId]
            if (existing != null) {
                if (existing.toolName != node.toolName) {
                    existing.toolName = node.toolName
                    existing.result = mapOf("status" to "idle", "data" to null, "error" to null)
                    existing.error = null
                }
            } else {
                mutations[node.statementId] = MutationEntry(node.toolName, mapOf("status" to "idle"))
            }
        }
        rebuild()
    }

    /** Runs a mutation; false if it failed, was already running, or the UI went away. */
    suspend fun fireMutation(statementId: String, args: Map<String, Any?>, refresh: List<String>? = null): Boolean {
        val provider = provider ?: return false
        if (disposed) return false
        val m = mutations[statementId] ?: return false
        if (m.result["status"] == "loading") return false
        val gen = generation
        m.result = mapOf("status" to "loading")
        rebuild()
        var ok = false
        try {
            val data = provider.callTool(m.toolName, args)
            if (disposed || gen != generation) return false
            m.result = mapOf("status" to "success", "data" to data)
            m.error = null
            ok = true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (disposed || gen != generation) return false
            val message = error.message ?: error.toString()
            m.result = mapOf("status" to "error", "error" to message)
            m.error = when (error) {
                is ToolNotFound -> OpenUIError("mutation", "tool-not-found", "Mutation tool \"${m.toolName}\" not found", statementId, "Mutation", toolName = m.toolName)
                is ToolError -> OpenUIError("mutation", "mcp-error", "Mutation \"${m.toolName}\" returned an error: ${error.text}", statementId, "Mutation", toolName = m.toolName)
                else -> OpenUIError("mutation", "tool-error", "Mutation \"${m.toolName}\" failed: $message", statementId, "Mutation", toolName = m.toolName)
            }
        }
        rebuild()
        if (ok && !refresh.isNullOrEmpty()) invalidate(refresh)
        return ok
    }

    fun mutationResult(statementId: String): Map<String, Any?>? = mutations[statementId]?.result

    fun dispose() {
        disposed = true
        generation++
        for (q in queries.values) {
            q.timer?.cancel()
            q.timer = null
            q.refreshInterval = 0.0
            q.loading = false
            q.needsRefetch = false
        }
        mutations.clear()
    }
}
