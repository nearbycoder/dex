package dev.trydex.openui

import java.util.concurrent.CopyOnWriteArraySet

/**
 * The reactive state of one generated UI (runtime/store.ts): `$variables` by name, and form fields under their form's
 * name. Listeners hear every change; the snapshot is a new map each time.
 */
class Store {
    private val state = LinkedHashMap<String, Any?>()
    /** Keys still holding their declared default, which a later parse may replace. */
    private val pristine = HashSet<String>()
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    @Volatile var snapshot: Map<String, Any?> = emptyMap()
        private set

    fun get(name: String): Any? = synchronized(this) { if (state.containsKey(name)) state[name] else Undefined }

    fun set(name: String, value: Any?, pristine: Boolean = false) {
        synchronized(this) {
            if (pristine) this.pristine += name else this.pristine -= name
            val existing = if (state.containsKey(name)) state[name] else Undefined
            if (Js.same(existing, value)) return
            // Plain objects (form data) that are shallowly equal count as unchanged.
            if (value is Map<*, *> && existing is Map<*, *> && value.size == existing.size &&
                value.all { (k, v) -> existing.containsKey(k) && Js.same(existing[k], v) }
            ) return
            state[name] = value
            snapshot = LinkedHashMap(state)
        }
        notifyListeners()
    }

    fun subscribe(listener: () -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    /**
     * Declared defaults fill keys that are missing or still pristine; values the user set or that were saved are never
     * overwritten, and keys never go away (a declaration can briefly disappear while streaming).
     */
    fun initialize(defaults: Map<String, Any?>, persisted: Map<String, Any?>) {
        var changed = false
        synchronized(this) {
            for ((key, value) in persisted) {
                pristine -= key
                if (!state.containsKey(key) || !Js.same(state[key], value)) {
                    state[key] = value
                    changed = true
                }
            }
            for ((key, value) in defaults) {
                if (!state.containsKey(key)) {
                    state[key] = value
                    pristine += key
                    changed = true
                } else if (key in pristine && !Js.same(state[key], value)) {
                    state[key] = value
                    changed = true
                }
            }
            if (changed) snapshot = LinkedHashMap(state)
        }
        if (changed) notifyListeners()
    }

    private fun notifyListeners() {
        for (listener in listeners) listener()
    }

    fun dispose() {
        synchronized(this) {
            state.clear()
            pristine.clear()
            snapshot = emptyMap()
        }
        listeners.clear()
    }
}
