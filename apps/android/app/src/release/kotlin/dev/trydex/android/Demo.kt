package dev.trydex.android

/** Release builds have no demo. */
object Demo {
    const val available = false

    @Suppress("UNUSED_PARAMETER")
    suspend fun start(graph: AppGraph) = Unit

    @Suppress("UNUSED_PARAMETER")
    fun isDemo(server: String?) = false

    @Suppress("UNUSED_PARAMETER")
    fun resume(graph: AppGraph) = Unit
}
