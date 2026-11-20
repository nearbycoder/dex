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
import android.util.LruCache
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.unit.Dp
import dev.trydex.android.data.Faces
import dev.trydex.core.model.SidekickLook
import dev.trydex.core.model.SidekickLooks
import kotlin.random.Random

/**
 * Sidekick faces on the device. Dex's own shapes are drawn from the layers bundled with them (SidekickLooks.layer: the
 * body in white, tinted the look's color, and the eyes over it), which the agent's renderer drew, so they're the
 * agent's picture to the pixel, at any color, and the eyes can blink. Pictures the agent saved (a shape a chat drew, or
 * one this build doesn't have) are decoded once.
 */
object SidekickArt {
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private fun layer(shape: String, part: String): Bitmap? {
        val key = "layer:$shape:$part"
        cache.get(key)?.let { return it }
        val bitmap = SidekickLooks.layer(shape, part)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } ?: return null
        cache.put(key, bitmap)
        return bitmap
    }

    /** Whether this app draws [look] itself: one of its own shapes. */
    fun draws(look: SidekickLook): Boolean = look.shape != "custom" && SidekickLooks.shape(look.shape) != null

    /**
     * [look]'s face on [canvas], filling a square [size] pixels wide, on a clear background. [blink] closes the eyes: 0
     * open, 1 shut. Draws nothing for a shape this app doesn't have ([draws]).
     */
    fun draw(canvas: Canvas, size: Float, look: SidekickLook, blink: Float = 0f) {
        val shape = SidekickLooks.shape(look.shape) ?: return
        val body = layer(shape.key, "body") ?: return
        val eyes = layer(shape.key, "eyes") ?: return
        val color = android.graphics.Color.parseColor(SidekickLooks.color(look))
        val target = RectF(0f, 0f, size, size)
        val source = Rect(0, 0, body.width, body.height)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(body, source, target, Paint(paint).apply { colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN) })
        canvas.save()
        // Blinking: the eyes close toward their middle.
        val middle = (shape.eyes.top + shape.eyes.bottom) / 2f * size
        canvas.scale(1f, 1f - blink.coerceIn(0f, 1f) * 0.9f, 0f, middle)
        canvas.drawBitmap(eyes, source, target, paint)
        canvas.restore()
    }

    /** [look]'s face as a square bitmap [size] pixels wide, on a clear background; null for a shape this app doesn't have. */
    fun bitmap(look: SidekickLook, size: Int): Bitmap? {
        if (!draws(look)) return null
        val key = "face:$size:${look.shape}:${look.skin}"
        cache.get(key)?.let { return it }
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        draw(Canvas(bitmap), size.toFloat(), look)
        cache.put(key, bitmap)
        return bitmap
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
        // A blink every five seconds or so; each face starts at its own point, so faces don't blink together.
        val offset = remember { Random.nextInt(BLINK_EVERY) }
        val blink = rememberInfiniteTransition(label = "blink").animateFloat(
            initialValue = 0f,
            targetValue = 0f,
            animationSpec = infiniteRepeatable(
                keyframes {
                    durationMillis = BLINK_EVERY
                    0f at BLINK_EVERY - 200 using LinearEasing
                    1f at BLINK_EVERY - 120 using LinearEasing
                    0f at BLINK_EVERY
                },
                RepeatMode.Restart,
                StartOffset(offset),
            ),
            label = "blink",
        )
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, look, blink.value) } }
    } else {
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, look) } }
    }
}

private const val BLINK_EVERY = 5_200
