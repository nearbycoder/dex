package dev.trydex.core.model

/**
 * A sidekick's face (apps/web/src/shared/sidekick-look.ts): a BoopFace (github.com/CX-ArtLab/BoopFace, MIT), the robot
 * head with two big eyes and an antenna dot, in a color or one of BoopFace's finishes. The app draws the plain-color
 * face itself, from BoopFace's own geometry, framed as the web frames the PNG it saves; only the web draws finishes.
 */
object SidekickLooks {
    // The parts from before BoopFace: kept so looks stay valid for older apps, which still draw them.
    val BODIES = listOf("blob", "bean", "cube", "ghost", "cat", "bot")
    val EYES = listOf("dot", "round", "sparkle", "happy", "sleepy", "wink", "visor")
    val MOUTHS = listOf("smile", "grin", "tongue", "purr", "o", "flat")
    val EXTRAS = listOf("none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband")

    /** Face colors, deep enough for BoopFace's white eyes. */
    val SKINS = linkedMapOf(
        "mint" to "#10b981",
        "sky" to "#0ea5e9",
        "lilac" to "#8b5cf6",
        "pink" to "#ec4899",
        "peach" to "#f97316",
        "lemon" to "#eab308",
        "coral" to "#ef4444",
        "teal" to "#14b8a6",
        "cloud" to "#71717a",
        "slate" to "#3f3f46",
    )

    /**
     * A look with every part one it knows, as `cleanLook`: unknown parts (from a newer agent) fall back to the first,
     * and a finish not shaped like BoopFace's (series 1–17, then 01–30) is the plain color.
     */
    fun clean(look: SidekickLook): SidekickLook = SidekickLook(
        body = look.body.takeIf { it in BODIES } ?: BODIES[0],
        skin = look.skin.takeIf { it in SKINS } ?: SKINS.keys.first(),
        eyes = look.eyes.takeIf { it in EYES } ?: EYES[0],
        mouth = look.mouth.takeIf { it in MOUTHS } ?: MOUTHS[0],
        extra = look.extra.takeIf { it in EXTRAS } ?: EXTRAS[0],
        blush = look.blush,
        finish = look.finish?.takeIf { it in 101..1799 && it % 100 in 1..30 },
    )

    /** The face's color as `#rrggbb` (slate for one it doesn't know). */
    fun color(look: SidekickLook): String = SKINS[look.skin] ?: SKINS.getValue("slate")

    // ── BoopFace ────────────────────────────────────────────────────────────────
    // In BoopFace's 240-unit box (_renderShell in boopface-core.js, at rest).

    /** The frame of a look's picture as x, y, width, height: the web's `viewBox="0 -8 240 248"`, with room for the antenna. */
    val VIEW_BOX = floatArrayOf(0f, -8f, 240f, 248f)

    /** BoopFace's `headShape` (straight lines only), drawn moved by [HEAD_OFFSET] and scaled by [HEAD_SCALE]. */
    const val HEAD_PATH =
        "M 120.00 20.00 L 132.80 20.05 L 139.87 20.20 L 145.68 20.44 L 150.79 20.78 L 155.43 21.22 L 159.71 21.76 " +
        "L 163.69 22.40 L 167.44 23.14 L 170.99 23.97 L 174.34 24.90 L 177.53 25.93 L 180.57 27.07 L 183.46 28.30 " +
        "L 186.22 29.63 L 188.85 31.06 L 191.36 32.59 L 193.75 34.22 L 196.03 35.96 L 198.19 37.80 L 200.25 39.75 " +
        "L 202.20 41.81 L 204.04 43.97 L 205.78 46.25 L 207.41 48.64 L 208.94 51.15 L 210.37 53.78 L 211.70 56.54 " +
        "L 212.93 59.43 L 214.07 62.47 L 215.10 65.66 L 216.03 69.01 L 216.86 72.56 L 217.60 76.31 L 218.24 80.29 " +
        "L 218.78 84.57 L 219.22 89.21 L 219.56 94.32 L 219.80 100.13 L 219.95 107.20 L 220.00 120.00 " +
        "L 219.95 132.80 L 219.80 139.87 L 219.56 145.68 L 219.22 150.79 L 218.78 155.43 L 218.24 159.71 " +
        "L 217.60 163.69 L 216.86 167.44 L 216.03 170.99 L 215.10 174.34 L 214.07 177.53 L 212.93 180.57 " +
        "L 211.70 183.46 L 210.37 186.22 L 208.94 188.85 L 207.41 191.36 L 205.78 193.75 L 204.04 196.03 " +
        "L 202.20 198.19 L 200.25 200.25 L 198.19 202.20 L 196.03 204.04 L 193.75 205.78 L 191.36 207.41 " +
        "L 188.85 208.94 L 186.22 210.37 L 183.46 211.70 L 180.57 212.93 L 177.53 214.07 L 174.34 215.10 " +
        "L 170.99 216.03 L 167.44 216.86 L 163.69 217.60 L 159.71 218.24 L 155.43 218.78 L 150.79 219.22 " +
        "L 145.68 219.56 L 139.87 219.80 L 132.80 219.95 L 120.00 220.00 L 107.20 219.95 L 100.13 219.80 " +
        "L 94.32 219.56 L 89.21 219.22 L 84.57 218.78 L 80.29 218.24 L 76.31 217.60 L 72.56 216.86 L 69.01 216.03 " +
        "L 65.66 215.10 L 62.47 214.07 L 59.43 212.93 L 56.54 211.70 L 53.78 210.37 L 51.15 208.94 L 48.64 207.41 " +
        "L 46.25 205.78 L 43.97 204.04 L 41.81 202.20 L 39.75 200.25 L 37.80 198.19 L 35.96 196.03 L 34.22 193.75 " +
        "L 32.59 191.36 L 31.06 188.85 L 29.63 186.22 L 28.30 183.46 L 27.07 180.57 L 25.93 177.53 L 24.90 174.34 " +
        "L 23.97 170.99 L 23.14 167.44 L 22.40 163.69 L 21.76 159.71 L 21.22 155.43 L 20.78 150.79 L 20.44 145.68 " +
        "L 20.20 139.87 L 20.05 132.80 L 20.00 120.00 L 20.05 107.20 L 20.20 100.13 L 20.44 94.32 L 20.78 89.21 " +
        "L 21.22 84.57 L 21.76 80.29 L 22.40 76.31 L 23.14 72.56 L 23.97 69.01 L 24.90 65.66 L 25.93 62.47 " +
        "L 27.07 59.43 L 28.30 56.54 L 29.63 53.78 L 31.06 51.15 L 32.59 48.64 L 34.22 46.25 L 35.96 43.97 " +
        "L 37.80 41.81 L 39.75 39.75 L 41.81 37.80 L 43.97 35.96 L 46.25 34.22 L 48.64 32.59 L 51.15 31.06 " +
        "L 53.78 29.63 L 56.54 28.30 L 59.43 27.07 L 62.47 25.93 L 65.66 24.90 L 69.01 23.97 L 72.56 23.14 " +
        "L 76.31 22.40 L 80.29 21.76 L 84.57 21.22 L 89.21 20.78 L 94.32 20.44 L 100.13 20.20 L 107.20 20.05 Z"

    const val HEAD_OFFSET = 7.2f
    const val HEAD_SCALE = 0.94f

    /** The eyes: white ellipses at these centers, clipped to the head. */
    val EYE_CENTERS = listOf(86f to 126f, 154f to 126f)
    const val EYE_RX = 27f
    const val EYE_RY = 29f

    /** The antenna dot above the head, in the head's color. */
    const val ANTENNA_X = 120f
    const val ANTENNA_Y = 12f
    const val ANTENNA_R = 15f

    /** [HEAD_PATH]'s corners, as drawn (offset and scaled). */
    val HEAD: List<Pair<Float, Float>> by lazy {
        HEAD_PATH.replace(Regex("[MLZ]"), " ").trim().split(Regex("\\s+")).map(String::toFloat).chunked(2) { (x, y) ->
            HEAD_OFFSET + x * HEAD_SCALE to HEAD_OFFSET + y * HEAD_SCALE
        }
    }
}
