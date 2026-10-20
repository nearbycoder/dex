package dev.trydex.openui

/** Dex's component library: openuiChatLibrary plus Dex's functions and actions, as the web's spec describes it. */
object DexLibrary {
    val specJson: String by lazy {
        DexLibrary::class.java.getResourceAsStream("/dev/trydex/openui/openui-spec.json")!!.bufferedReader().use { it.readText() }
    }

    val catalog: Catalog by lazy { Catalog.fromSpec(specJson) }
}
