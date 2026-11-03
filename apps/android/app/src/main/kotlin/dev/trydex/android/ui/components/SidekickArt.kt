package dev.trydex.android.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import com.caverock.androidsvg.SVG
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.SidekickLooks
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * Sidekick looks drawn on the device: the web's own SVG (SidekickLooks.svg, checked against sidekickSvg by goldens)
 * rendered by AndroidSVG, so a look is as crisp here at any size as on the web, and the editor can draw every option.
 */
object SidekickArt {
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    /** [look] on the background of agent color [color], as a square bitmap [size] pixels wide (a disc; the corners clear). */
    fun bitmap(look: SidekickLook, color: String, size: Int): Bitmap {
        val svg = SidekickLooks.svg(look, SidekickLooks.background(color))
        val key = "$size:$svg"
        cache.get(key)?.let { return it }
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        SVG.getFromString(svg).apply {
            documentWidth = size.toFloat()
            documentHeight = size.toFloat()
        }.renderToCanvas(Canvas(bitmap))
        cache.put(key, bitmap)
        return bitmap
    }

    /**
     * The PNG saved with a look as the sidekick's `image` (the web's lookPng), for widgets, notifications, and apps
     * that show pictures: 256 pixels, smaller if it would pass the agent's 48 KB.
     */
    fun png(look: SidekickLook, color: String): String {
        for (size in listOf(256, 192, 128)) {
            val bytes = ByteArrayOutputStream().also { bitmap(look, color, size).compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            val url = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            if (url.length < 63_000) return url
        }
        error("That look didn't fit in a picture.")
    }
}

/** A sidekick's look, drawn at [size]. */
@Composable
fun SidekickFace(look: SidekickLook, color: String, size: Dp, modifier: Modifier = Modifier) {
    val pixels = with(LocalDensity.current) { size.toPx().roundToInt().coerceAtLeast(1) }
    val image = remember(look, color, pixels) { SidekickArt.bitmap(look, color, pixels).asImageBitmap() }
    Image(image, contentDescription = null, modifier = modifier.size(size))
}
