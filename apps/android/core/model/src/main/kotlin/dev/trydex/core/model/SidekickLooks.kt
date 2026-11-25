package dev.trydex.core.model

import kotlinx.serialization.Serializable
import java.util.Base64

/**
 * A sidekick's face (apps/web/src/shared/sidekick-look.ts): an Open Bot Avatar (github.com/DominikScholz/open-bot-avatar,
 * MIT), a little object with two dark eyes (a robot, a cloud, a mug…) in a color, flat, fluffy, or glass, or a shape a
 * chat drew (`custom`). The agent draws flat pictures (`image`); the app draws Dex's own shapes from the layers bundled
 * with [SHAPES] (flat bodies tinted, fluffy coats dyed with Open Bot Avatar's dye ramps, or glass bodies tinted from its
 * ray-marched basis, under their eyes), so it can preview any look before it's saved and blink its eyes.
 */
object SidekickLooks {
    // The parts from before Open Bot Avatar: still written, so apps released before it read looks.
    val BODIES = listOf("blob", "bean", "cube", "ghost", "cat", "bot")
    val EYES = listOf("dot", "round", "sparkle", "happy", "sleepy", "wink", "visor")
    val MOUTHS = listOf("smile", "grin", "tongue", "purr", "o", "flat")
    val EXTRAS = listOf("none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband")
    val MATERIALS = listOf("flat", "fluffy", "glass")

    /** Face colors, light enough for the dark eyes, in the picker's order. */
    val SKINS = linkedMapOf(
        "peach" to "#ff6a1a",
        "lemon" to "#facc15",
        "mint" to "#34d399",
        "teal" to "#2dd4bf",
        "sky" to "#38bdf8",
        "lilac" to "#a78bfa",
        "pink" to "#f472b6",
        "coral" to "#fb7185",
        "cloud" to "#d4d4d8",
        "slate" to "#94a3b8",
    )

    /** The eyes' ink. */
    const val EYE_INK = "#151515"

    /**
     * A BoopFace finish number: apps from before Open Bot Avatar show a look's picture when it has one rather than draw a
     * BoopFace, so every look carries it.
     */
    const val LEGACY_FINISH = 101

    private const val FOLDER = "/dev/trydex/core/model/sidekicks"

    private val catalog: ShapesFile by lazy {
        val text = SidekickLooks::class.java.getResourceAsStream("$FOLDER/shapes.json")!!.bufferedReader().use { it.readText() }
        DexJson.decodeFromString(ShapesFile.serializer(), text)
    }

    /** Dex's shapes, in the picker's order (sidekicks/shapes.json, drawn by the agent's renderer). */
    val SHAPES: List<SidekickShape> get() = catalog.shapes

    /** Each skin's 96-entry RGB dye ramp (288 bytes) for dyeing fluffy coats, from Open Bot Avatar's `dyeRamp`. */
    private val RAMPS: Map<String, ByteArray> by lazy {
        val decoder = Base64.getDecoder()
        catalog.ramps.mapValues { (_, encoded) -> decoder.decode(encoded) }.filterValues { it.size == 96 * 3 }
    }

    fun shape(key: String): SidekickShape? = SHAPES.firstOrNull { it.key == key }

    /** The 96-entry RGB dye ramp (288 bytes) for [skin] (falls back to the first skin). */
    fun ramp(skin: String): ByteArray? = RAMPS[skin] ?: RAMPS[SKINS.keys.first()]

    /** A shape's [part] ("body", "eyes", "fluffy-body", "fluffy-eyes", "glass-body", or "glass-eyes") as a 256-pixel PNG; null for one this build doesn't have. */
    fun layer(key: String, part: String): ByteArray? =
        SidekickLooks::class.java.getResourceAsStream("$FOLDER/shapes/$key-$part.png")?.use { it.readBytes() }

    /** The older apps' body nearest a shape. */
    private val BODY_OF = mapOf("bot" to "bot", "blob" to "blob", "ghost" to "ghost", "cat" to "cat", "bean" to "bean", "cube" to "cube")

    fun cleanMaterial(value: String?): String = if (value in MATERIALS) value!! else "flat"

    fun materialLabel(value: String): String = when (value) {
        "fluffy" -> "Fluffy"
        "glass" -> "Glass"
        else -> "Flat"
    }

    /** Whether [look] wears the fluffy coat. */
    fun isFluffy(look: SidekickLook): Boolean = look.material == "fluffy"

    /** Whether [look] is rendered in tinted glass. */
    fun isGlass(look: SidekickLook): Boolean = look.material == "glass"

    /** Whether [look] uses a WebGL2/layered material finish whose picture the client renders on save. */
    fun isRenderedMaterial(look: SidekickLook): Boolean = look.material == "fluffy" || look.material == "glass"

    /** A look of [shape] in [skin] and [material], with the older apps' parts filled in (`makeLook`). */
    fun make(shape: String, skin: String, custom: CustomShape? = null, material: String = "flat"): SidekickLook {
        val isCustom = shape == "custom" && custom != null
        val key = if (shape == "custom" && custom == null) "bot" else shape
        return SidekickLook(
            shape = key,
            custom = if (isCustom) custom else null,
            skin = skin,
            material = cleanMaterial(material),
            body = if (isCustom) "blob" else BODY_OF[key] ?: "blob",
            eyes = "round",
            mouth = "smile",
            extra = "none",
            blush = false,
            finish = LEGACY_FINISH,
        )
    }

    /**
     * A look this app can show, as `cleanLook`: a color it doesn't know is the first, an unknown material falls back to
     * flat, and a look without a shape it knows (from an older agent, or a newer one's new shape) takes the one nearest
     * its body. The agent checks a custom shape before saving it. Where the agent's picture is at hand, a shape this app
     * doesn't know shows as that.
     */
    fun clean(look: SidekickLook): SidekickLook {
        val skin = look.skin.takeIf { it in SKINS } ?: SKINS.keys.first()
        val material = cleanMaterial(look.material)
        return when {
            look.shape == "custom" -> make("custom", skin, look.custom?.takeIf { it.path.isNotBlank() }, material)
            shape(look.shape) != null -> make(look.shape, skin, material = material)
            else -> make(look.body.takeIf { it in BODY_OF } ?: "bot", skin, material = material)
        }
    }

    /** The face's color as `#rrggbb` (the first for one it doesn't know). */
    fun color(look: SidekickLook): String = SKINS[look.skin] ?: SKINS.values.first()

    /** A look's shape name. */
    fun name(look: SidekickLook): String = if (look.shape == "custom") look.custom?.name ?: "Custom" else shape(look.shape)?.name ?: SHAPES.first().name

    @Serializable
    private data class ShapesFile(val ramps: Map<String, String> = emptyMap(), val shapes: List<SidekickShape> = emptyList())
}

/** One of Dex's shapes: its key (stored in looks), its name, and where its eyes are, as fractions of its picture. */
@Serializable
data class SidekickShape(val key: String, val name: String = "", val eyes: EyeBand = EyeBand()) {
    @Serializable
    data class EyeBand(val top: Float = 0.4f, val bottom: Float = 0.6f)
}

/** A shape a chat drew: an Open Bot Avatar definition's name, silhouette (a 0 0 100 100 box), and eye placement. */
@Serializable
data class CustomShape(val name: String = "Custom", val path: String = "", val eyes: Eyes = Eyes()) {
    @Serializable
    data class Eyes(val x: Double = 50.0, val y: Double = 50.0, val spacing: Double = 16.0, val scale: Double = 1.0)
}
