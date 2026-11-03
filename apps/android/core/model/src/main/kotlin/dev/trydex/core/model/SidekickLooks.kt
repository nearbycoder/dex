package dev.trydex.core.model

import kotlin.random.Random

/**
 * A sidekick's face, from its parts (apps/web/src/shared/sidekick-look.ts): the parts, their labels, and the picture as
 * the same SVG document the web draws, character for character, so the app can draw a look itself.
 */
object SidekickLooks {
    val BODIES = listOf("blob", "bean", "cube", "ghost", "cat", "bot")
    val EYES = listOf("dot", "round", "sparkle", "happy", "sleepy", "wink", "visor")
    val MOUTHS = listOf("smile", "grin", "tongue", "purr", "o", "flat")
    val EXTRAS = listOf("none", "headphones", "glasses", "beanie", "beret", "crown", "sprout", "bow", "wizard", "headband")

    /** Body colors, chosen to sit well on every background color. */
    val SKINS = linkedMapOf(
        "mint" to "#6ee7b7",
        "sky" to "#7dd3fc",
        "lilac" to "#c4b5fd",
        "pink" to "#f9a8d4",
        "peach" to "#fdba74",
        "lemon" to "#fde68a",
        "coral" to "#fca5a5",
        "teal" to "#5eead4",
        "cloud" to "#e4e4e7",
        "slate" to "#94a3b8",
    )

    val LABELS = mapOf(
        "blob" to "Blob", "bean" to "Bean", "cube" to "Cube", "ghost" to "Ghost", "cat" to "Cat", "bot" to "Bot",
        "dot" to "Dots", "round" to "Round", "sparkle" to "Sparkle", "happy" to "Happy", "sleepy" to "Calm", "wink" to "Wink", "visor" to "Visor",
        "smile" to "Smile", "grin" to "Grin", "tongue" to "Silly", "purr" to "Purr", "o" to "Ooh", "flat" to "Deadpan",
        "none" to "None", "headphones" to "Headphones", "glasses" to "Glasses", "beanie" to "Beanie", "beret" to "Beret", "crown" to "Crown",
        "sprout" to "Sprout", "bow" to "Bow", "wizard" to "Wizard hat", "headband" to "Headband",
    )

    fun label(part: String): String = LABELS[part] ?: part.replaceFirstChar { it.uppercase() }

    /** A look with every part one it knows: unknown ones (from a newer agent) fall back to the first, as `cleanLook`. */
    fun clean(look: SidekickLook): SidekickLook = SidekickLook(
        body = look.body.takeIf { it in BODIES } ?: BODIES[0],
        skin = look.skin.takeIf { it in SKINS } ?: SKINS.keys.first(),
        eyes = look.eyes.takeIf { it in EYES } ?: EYES[0],
        mouth = look.mouth.takeIf { it in MOUTHS } ?: MOUTHS[0],
        extra = look.extra.takeIf { it in EXTRAS } ?: EXTRAS[0],
        blush = look.blush,
    )

    /** Any look, weighted as the web's `randomLook` (bots often get a visor, most get an extra, many are rosy). */
    fun random(random: Random = Random.Default): SidekickLook {
        fun <T> any(options: List<T>) = options[random.nextInt(options.size)]
        val body = any(BODIES)
        return SidekickLook(
            body = body,
            skin = any(SKINS.keys.toList()),
            eyes = if (body == "bot" && random.nextDouble() < 0.5) "visor" else any(EYES.filter { it != "visor" }),
            mouth = any(MOUTHS),
            extra = if (random.nextDouble() < 0.25) "none" else any(EXTRAS.filter { it != "none" }),
            blush = random.nextDouble() < 0.6,
        )
    }

    // ── Drawing ─────────────────────────────────────────────────────────────────
    // On a 100×100 canvas. Every body puts its face at the same place (eyes on y≈52, mouth on y≈66), and says where
    // its head starts so hats sit on it.

    private const val INK = "#1e1b2e"

    private class Shape(val top: Int, val path: String, val extra: String? = null)

    private val SHAPES = mapOf(
        "blob" to Shape(24, "M50 24C71 24 80 37 80 56C80 75 68 86 50 86C32 86 20 75 20 56C20 37 29 24 50 24Z"),
        "bean" to Shape(20, "M50 20C67 20 76 32 76 50V64C76 79 66 88 50 88C34 88 24 79 24 64V50C24 32 33 20 50 20Z"),
        "cube" to Shape(27, "M36 27H64C73 27 79 33 79 42V70C79 79 73 85 64 85H36C27 85 21 79 21 70V42C21 33 27 27 36 27Z"),
        "ghost" to Shape(
            22,
            "M23 54C23 34 35 22 50 22C65 22 77 34 77 54V84C77 87 74 88 72 86L67 81L61 86C59 88 57 88 55 86L50 81L45 86C43 88 41 88 39 86L33 81L28 86C26 88 23 87 23 84Z",
        ),
        "cat" to Shape(
            28,
            "M50 28C70 28 80 41 80 58C80 76 67 86 50 86C33 86 20 76 20 58C20 41 30 28 50 28Z",
            "M24 44L27 17C27.4 14.6 30 13.8 31.7 15.5L45 30ZM76 44L73 17C72.6 14.6 70 13.8 68.3 15.5L55 30Z",
        ),
        "bot" to Shape(31, "M34 31H66C74 31 79 36 79 44V71C79 79 74 84 66 84H34C26 84 21 79 21 71V44C21 36 26 31 34 31Z"),
    )

    /** A number as JavaScript writes it in a template (`40`, not `40.0`; `41.47`). */
    private fun js(value: Double): String =
        if (value == Math.rint(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()

    private fun eyes(eyes: String, skin: String): String {
        fun dot(x: Double, r: Double = 4.2) =
            """<circle cx="${js(x)}" cy="52" r="${js(r)}" fill="$INK"/><circle cx="${js(x + r * 0.35)}" cy="${js(52 - r * 0.35)}" r="${js(r * 0.33)}" fill="#fff"/>"""
        fun arc(x: Int, up: Boolean) =
            """<path d="M${x - 5} ${if (up) 54 else 51}Q$x ${if (up) 47 else 56} ${x + 5} ${if (up) 54 else 51}" fill="none" stroke="$INK" stroke-width="3" stroke-linecap="round"/>"""
        return when (eyes) {
            "round" -> listOf(40, 60).joinToString("") { x ->
                """<ellipse cx="$x" cy="52" rx="6.3" ry="6.8" fill="#fff"/><circle cx="${js(x + 0.8)}" cy="53" r="3.6" fill="$INK"/><circle cx="${x + 2}" cy="51.6" r="1.2" fill="#fff"/>"""
            }
            "sparkle" -> listOf(40, 60).joinToString("") { x ->
                """<ellipse cx="$x" cy="52" rx="5" ry="6" fill="$INK"/><circle cx="${js(x + 1.6)}" cy="49.6" r="1.9" fill="#fff"/><circle cx="${js(x - 1.6)}" cy="55" r="0.9" fill="#fff"/>"""
            }
            "happy" -> arc(40, true) + arc(60, true)
            "sleepy" -> arc(40, false) + arc(60, false)
            "wink" -> dot(40.0) + arc(60, true)
            "visor" -> """<rect x="29" y="44.5" width="42" height="15" rx="7.5" fill="$INK"/><rect x="35" y="49.5" width="8" height="5" rx="2.5" fill="$skin"/><rect x="57" y="49.5" width="8" height="5" rx="2.5" fill="$skin"/>"""
            else -> dot(40.0) + dot(60.0)
        }
    }

    private fun mouth(mouth: String): String {
        fun line(d: String) = """<path d="$d" fill="none" stroke="$INK" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>"""
        return when (mouth) {
            "grin" -> """<path d="M42.5 63.5H57.5Q57 72 50 72Q43 72 42.5 63.5Z" fill="$INK"/><path d="M45.5 69.6Q50 66.5 54.5 69.6Q52.6 71.8 50 71.8Q47.4 71.8 45.5 69.6Z" fill="#fb7185"/>"""
            "tongue" -> """<path d="M47 66.5Q50 74 53 66.5Z" fill="#fb7185"/>""" + line("M43.5 65Q50 70 56.5 65")
            "purr" -> line("M43 65Q46.5 69 50 65Q53.5 69 57 65")
            "o" -> """<ellipse cx="50" cy="67" rx="3.2" ry="3.8" fill="$INK"/>"""
            "flat" -> line("M45 67H55")
            else -> line("M44 65Q50 70.5 56 65")
        }
    }

    /** Headwear and face things. [top] is where the head starts; hats are drawn for a head starting at 24. */
    private fun extra(extra: String, top: Int): String {
        fun hat(svg: String) = """<g transform="translate(0 ${top - 24})">$svg</g>"""
        return when (extra) {
            "headphones" -> """<path d="M20 54C20 30 33 ${top - 4} 50 ${top - 4}C67 ${top - 4} 80 30 80 54" fill="none" stroke="$INK" stroke-width="4.5" stroke-linecap="round"/><rect x="13" y="46" width="11" height="19" rx="5" fill="#f43f5e"/><rect x="76" y="46" width="11" height="19" rx="5" fill="#f43f5e"/>"""
            "glasses" -> """<g fill="rgba(255,255,255,.18)" stroke="$INK" stroke-width="2.6"><circle cx="40" cy="52" r="8.6"/><circle cx="60" cy="52" r="8.6"/></g><path d="M48.6 51Q50 49.6 51.4 51" fill="none" stroke="$INK" stroke-width="2.6"/>"""
            "beanie" -> hat("""<path d="M25 34C25 16 75 16 75 34Z" fill="#ef4444"/><rect x="23" y="30" width="54" height="9" rx="4.5" fill="#b91c1c"/><circle cx="50" cy="13" r="5.5" fill="#fef2f2"/>""")
            "beret" -> hat("""<path d="M24 31C25 18 58 11 76 23C72 30 44 34 24 31Z" fill="#1e1b2e"/><path d="M56 15L58 9" stroke="#1e1b2e" stroke-width="3" stroke-linecap="round"/>""")
            "crown" -> hat("""<path d="M32 27L34 9L43 19L50 6L57 19L66 9L68 27Z" fill="#fbbf24" stroke="#b45309" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="20" r="2.4" fill="#ef4444"/>""")
            "sprout" -> hat("""<path d="M50 25V12" stroke="#16a34a" stroke-width="3" stroke-linecap="round"/><path d="M50 15C44 15 39 11 39 6C45 6 50 9 50 15Z" fill="#22c55e"/><path d="M50 13C55 13 61 9 61 4C55 4 50 7 50 13Z" fill="#4ade80"/>""")
            "bow" -> hat("""<path d="M64 24L56 17V31Z" fill="#ec4899"/><path d="M64 24L72 17V31Z" fill="#ec4899"/><circle cx="64" cy="24" r="3" fill="#be185d"/>""")
            "wizard" -> hat("""<path d="M27 30L55 0L72 30Z" fill="#6d28d9"/><rect x="22" y="27" width="56" height="7" rx="3.5" fill="#4c1d95"/><path d="M54 12L55.4 15.4L59 15.6L56.2 17.8L57.2 21.2L54 19.2L50.8 21.2L51.8 17.8L49 15.6L52.6 15.4Z" fill="#fde68a"/>""")
            "headband" -> hat("""<rect x="21" y="35" width="58" height="8" rx="2" fill="#ef4444"/><path d="M79 38L88 33L86 41Z M79 40L87 45L80 46Z" fill="#dc2626"/>""")
            else -> ""
        }
    }

    /** The whole picture as an SVG document: a disc of [background] (a CSS color) with the character on it. */
    fun svg(look: SidekickLook, background: String): String {
        val skin = SKINS[look.skin] ?: SKINS.getValue("mint")
        val shape = SHAPES[look.body] ?: SHAPES.getValue("blob")
        val bot = if (look.body == "bot") {
            """<path d="M50 31V19" stroke="$INK" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="16" r="4.5" fill="#f43f5e"/><rect x="15" y="50" width="7" height="12" rx="3" fill="$skin"/><rect x="78" y="50" width="7" height="12" rx="3" fill="$skin"/>"""
        } else ""
        return listOf(
            """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">""",
            """<defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>""",
            """<g clip-path="url(#c)">""",
            """<rect width="100" height="100" fill="$background"/>""",
            """<ellipse cx="50" cy="91" rx="25" ry="4" fill="#000" opacity=".22"/>""",
            // A little bigger than drawn, so faces read in the sidebar.
            """<g transform="translate(50 58) scale(1.08) translate(-50 -58)">""",
            if (look.extra == "headphones") "" else bot,
            shape.extra?.let { """<path d="$it" fill="$skin"/>""" } ?: "",
            """<path d="${shape.path}" fill="$skin"/>""",
            // A soft shade along the bottom and a shine at the top left give the flat shape some roundness.
            """<path d="${shape.path}" fill="#000" opacity=".1" transform="translate(0 6) scale(1 .94)"/>""",
            """<path d="${shape.path}" fill="$skin" transform="translate(0 -1.5)"/>""",
            """<ellipse cx="36" cy="${shape.top + 11}" rx="8" ry="4.5" fill="#fff" opacity=".35" transform="rotate(-24 36 ${shape.top + 11})"/>""",
            if (look.blush) """<ellipse cx="31" cy="62" rx="5" ry="3" fill="#fb7185" opacity=".5"/><ellipse cx="69" cy="62" rx="5" ry="3" fill="#fb7185" opacity=".5"/>""" else "",
            eyes(look.eyes, skin),
            mouth(look.mouth),
            if (look.extra == "headphones") bot else "",
            extra(look.extra, shape.top),
            "</g></g></svg>",
        ).joinToString("")
    }

    /** The background a sidekick of [color] has: the first of its agent color pair, as the web's `#rrggbb`. */
    fun background(color: String): String {
        val (fill, _) = Catalogs.AGENT_COLORS[color] ?: Catalogs.AGENT_COLORS.getValue("violet")
        return "#%06x".format(fill and 0xFFFFFF)
    }
}
