package dev.trydex.android.ui.components

import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.util.Base64
import android.util.LruCache
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.unit.Dp
import dev.trydex.android.data.Faces
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.SidekickLooks
import kotlinx.coroutines.delay
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * Sidekick faces on the device. Dex's own shapes are drawn from the layers bundled with them (SidekickLooks.layer:
 * flat bodies tinted the look's color, fluffy coats dyed with Open Bot Avatar's dye ramps, or glass bodies tinted from
 * its ray-marched basis, under their eyes), so they match the web and agent at any color and blink their eyes. Pictures
 * the agent saved (a shape a chat drew, or one this build doesn't have) are decoded once.
 */
object SidekickArt {
    private class Scratch {
        val eyesPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        val source = Rect()
        val target = RectF()
    }

    private val scratch = ThreadLocal.withInitial { Scratch() }
    private val colorFilters = ConcurrentHashMap<String, PorterDuffColorFilter>()
    private val dyeLuts = ConcurrentHashMap<String, IntArray>()
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private fun colorFilter(hex: String): PorterDuffColorFilter =
        colorFilters.getOrPut(hex) { PorterDuffColorFilter(android.graphics.Color.parseColor(hex), PorterDuff.Mode.SRC_IN) }

    /** 256-entry 0x00RRGGBB lookup table interpolated from [skin]'s 96-entry dye ramp. */
    private fun dyeLut(skin: String): IntArray? = dyeLuts[skin] ?: SidekickLooks.ramp(skin)?.takeIf { it.size == 96 * 3 }?.let { ramp ->
        val table = IntArray(256)
        for (index in 0 until 256) {
            val pos = max(0.0, min(95.0, (index / 255.0) * 96.0 - 0.5))
            val i0 = pos.toInt()
            val i1 = min(95, i0 + 1)
            val t = pos - i0
            val r = ((ramp[i0 * 3].toInt() and 0xFF) + ((ramp[i1 * 3].toInt() and 0xFF) - (ramp[i0 * 3].toInt() and 0xFF)) * t).roundToInt().coerceIn(0, 255)
            val g = ((ramp[i0 * 3 + 1].toInt() and 0xFF) + ((ramp[i1 * 3 + 1].toInt() and 0xFF) - (ramp[i0 * 3 + 1].toInt() and 0xFF)) * t).roundToInt().coerceIn(0, 255)
            val b = ((ramp[i0 * 3 + 2].toInt() and 0xFF) + ((ramp[i1 * 3 + 2].toInt() and 0xFF) - (ramp[i0 * 3 + 2].toInt() and 0xFF)) * t).roundToInt().coerceIn(0, 255)
            table[index] = (r shl 16) or (g shl 8) or b
        }
        dyeLuts.putIfAbsent(skin, table) ?: table
    }

    /**
     * Per-channel interpolation weights for tinting the baked `#ff8000` glass basis (R: full tint, G: half tint, B:
     * white reflection) into [skin]'s glass hue and Beer-Lambert absorption, matching Open Bot Avatar's glass shader.
     */
    private fun glassWeights(skin: String): DoubleArray {
        val hex = SidekickLooks.SKINS[skin] ?: SidekickLooks.SKINS.values.first()
        val rgb = android.graphics.Color.parseColor(hex)
        val r = ((rgb ushr 16) and 0xFF) / 255.0
        val g = ((rgb ushr 8) and 0xFF) / 255.0
        val b = (rgb and 0xFF) / 255.0
        val maxC = max(r, max(g, b))
        val minC = min(r, min(g, b))
        val sat = if (maxC > 0.001) (maxC - minC) / maxC else 0.0
        val pureR = if (maxC > 0.05) r / maxC else 0.88
        val pureG = if (maxC > 0.05) g / maxC else 0.94
        val pureB = if (maxC > 0.05) b / maxC else 0.97
        val s1 = min(1.0, sat * 1.08)
        val jtR = 0.88 + (pureR - 0.88) * s1
        val jtG = 0.94 + (pureG - 0.94) * s1
        val jtB = 0.97 + (pureB - 0.97) * s1
        val s2 = min(1.0, sat * 0.88)
        val tcR = 0.97 + (jtR - 0.97) * s2
        val tcG = 0.97 + (jtG - 0.97) * s2
        val tcB = 0.97 + (jtB - 0.97) * s2
        fun weight(jt: Double, tc: Double): Double {
            val tn = ((tc - 0.1164) / 0.88).coerceIn(0.0, 1.0)
            return (0.75 * jt + 0.25 * tn).coerceIn(0.0, 1.0)
        }
        return doubleArrayOf(weight(jtR, tcR), weight(jtG, tcG), weight(jtB, tcB))
    }

    private fun pwl(y0: Int, y5: Int, y1: Int, t: Double): Int =
        (if (t <= 0.5) y0 + (y5 - y0) * (2.0 * t) else y5 + (y1 - y5) * (2.0 * t - 1.0)).roundToInt().coerceIn(0, 255)

    private fun layer(shape: String, part: String): Bitmap? {
        val key = "layer:$shape:$part"
        cache.get(key)?.let { return it }
        val bitmap = SidekickLooks.layer(shape, part)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } ?: return null
        cache.put(key, bitmap)
        return bitmap
    }

    /** A shape's fluffy coat dyed with [skin]'s ramp, cached per `(shape, skin)`. */
    private fun fluffyBody(shape: String, skin: String): Bitmap? {
        val key = "fluffy-body:$shape:$skin"
        cache.get(key)?.let { return it }
        val source = layer(shape, "fluffy-body") ?: return null
        val lut = dyeLut(skin) ?: return null
        val width = source.width
        val height = source.height
        val pixels = IntArray(width * height)
        source.getPixels(pixels, 0, width, 0, 0, width, height)
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val alpha = pixel and 0xFF000000.toInt()
            if (alpha == 0) {
                pixels[i] = 0
                continue
            }
            pixels[i] = alpha or lut[pixel and 0xFF]
        }
        val dyed = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        dyed.setPixels(pixels, 0, width, 0, 0, width, height)
        cache.put(key, dyed)
        return dyed
    }

    /** A shape's glass body tinted into [skin], cached per `(shape, skin)`. */
    private fun glassBody(shape: String, skin: String): Bitmap? {
        val key = "glass-body:$shape:$skin"
        cache.get(key)?.let { return it }
        val bytes = SidekickLooks.layer(shape, "glass-body") ?: return null
        val opts = BitmapFactory.Options().apply { inPremultiplied = false }
        val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
        val weights = glassWeights(skin)
        val wr = weights[0]
        val wg = weights[1]
        val wb = weights[2]
        val width = source.width
        val height = source.height
        val pixels = IntArray(width * height)
        source.getPixels(pixels, 0, width, 0, 0, width, height)
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val alpha = pixel and 0xFF000000.toInt()
            if (alpha == 0) {
                pixels[i] = 0
                continue
            }
            val r = (pixel ushr 16) and 0xFF
            val g = (pixel ushr 8) and 0xFF
            val b = pixel and 0xFF
            pixels[i] = alpha or (pwl(b, g, r, wr) shl 16) or (pwl(b, g, r, wg) shl 8) or pwl(b, g, r, wb)
        }
        val tinted = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        tinted.setPixels(pixels, 0, width, 0, 0, width, height)
        cache.put(key, tinted)
        return tinted
    }

    /** Whether this app draws [look] itself: one of its own shapes. */
    fun draws(look: SidekickLook): Boolean = look.shape != "custom" && SidekickLooks.shape(look.shape) != null

    /**
     * [look]'s face on [canvas], filling a square [size] pixels wide, on a clear background. [blink] closes the eyes: 0
     * open, 1 shut. Draws nothing for a shape this app doesn't have ([draws]).
     */
    fun draw(canvas: Canvas, size: Float, look: SidekickLook, blink: Float = 0f) {
        val shape = SidekickLooks.shape(look.shape) ?: return
        val s = scratch.get()!!
        s.target.set(0f, 0f, size, size)
        val eyes: Bitmap
        when {
            SidekickLooks.isFluffy(look) -> {
                val coat = fluffyBody(shape.key, look.skin) ?: return
                eyes = layer(shape.key, "fluffy-eyes") ?: return
                s.source.set(0, 0, coat.width, coat.height)
                s.bodyPaint.colorFilter = null
                canvas.drawBitmap(coat, s.source, s.target, s.bodyPaint)
            }
            SidekickLooks.isGlass(look) -> {
                val glass = glassBody(shape.key, look.skin) ?: return
                eyes = layer(shape.key, "glass-eyes") ?: return
                s.source.set(0, 0, glass.width, glass.height)
                s.bodyPaint.colorFilter = null
                canvas.drawBitmap(glass, s.source, s.target, s.bodyPaint)
            }
            else -> {
                val body = layer(shape.key, "body") ?: return
                eyes = layer(shape.key, "eyes") ?: return
                s.source.set(0, 0, body.width, body.height)
                s.bodyPaint.colorFilter = colorFilter(SidekickLooks.color(look))
                canvas.drawBitmap(body, s.source, s.target, s.bodyPaint)
            }
        }
        canvas.save()
        // Blinking: the eyes close toward their middle.
        val middle = (shape.eyes.top + shape.eyes.bottom) / 2f * size
        canvas.scale(1f, 1f - blink.coerceIn(0f, 1f) * 0.9f, 0f, middle)
        s.source.set(0, 0, eyes.width, eyes.height)
        canvas.drawBitmap(eyes, s.source, s.target, s.eyesPaint)
        canvas.restore()
    }

    /** [look]'s face as a square bitmap [size] pixels wide, on a clear background; null for a shape this app doesn't have. */
    fun bitmap(look: SidekickLook, size: Int): Bitmap? {
        if (!draws(look)) return null
        val material = SidekickLooks.cleanMaterial(look.material)
        val key = "face:$size:${look.shape}:${look.skin}:$material"
        cache.get(key)?.let { return it }
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        draw(Canvas(bitmap), size.toFloat(), look)
        cache.put(key, bitmap)
        return bitmap
    }

    /**
     * Renders a fluffy or glass look as a transparent data: URL under the 48 KB character picture limit, so
     * notifications, widgets, and older apps show the material too. Null for flat or custom shapes.
     */
    fun materialDataUrl(look: SidekickLook): String? {
        if (!SidekickLooks.isRenderedMaterial(look) || !draws(look)) return null
        val full = bitmap(look, 256) ?: return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bytes = ByteArrayOutputStream().also { full.compress(Bitmap.CompressFormat.WEBP_LOSSY, 85, it) }.toByteArray()
            val url = "data:image/webp;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            if (url.length <= 63_000) return url
        }
        for (side in listOf(160, 128, 96)) {
            val scaled = Bitmap.createScaledBitmap(full, side, side, true)
            val bytes = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            val url = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            if (url.length <= 63_000) return url
        }
        return null
    }

    /** A saved picture (a `data:image/…;base64,…` URL), decoded once; null if it isn't one. */
    fun picture(url: String): Bitmap? {
        cache.get(url)?.let { return it }
        val bitmap = Faces.decode(Faces.dataUrlBytes(url)) ?: return null
        cache.put(url, bitmap)
        return bitmap
    }
}

/**
 * A sidekick's face, drawn at [size]: one of Dex's shapes (SidekickArt.draws). [live] ones blink now and then, as on
 * the web, unless the system has animations off; faces shown many at once (lists, messages) stay still.
 */
@Composable
fun SidekickFace(look: SidekickLook, size: Dp, modifier: Modifier = Modifier, live: Boolean = false) {
    if (live && ValueAnimator.areAnimatorsEnabled()) {
        // Sleep between blinks instead of running a continuous transition, so idle faces draw nothing for ~5 s.
        val blink = remember { Animatable(0f) }
        LaunchedEffect(Unit) {
            delay(Random.nextLong(BLINK_EVERY.toLong()))
            while (true) {
                blink.animateTo(1f, tween(80, easing = LinearEasing))
                blink.animateTo(0f, tween(120, easing = LinearEasing))
                delay((BLINK_EVERY - 200).toLong())
            }
        }
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, look, blink.value) } }
    } else {
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, look) } }
    }
}

private const val BLINK_EVERY = 5_200
