package dev.trydex.android.ui.components

import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.Base64
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
import java.io.ByteArrayOutputStream
import kotlin.random.Random

/**
 * Sidekick faces on the device: the plain-color BoopFace drawn from its own geometry (SidekickLooks), framed as the web
 * frames the PNG it saves, so the app can draw a color look at any size and save its picture; and the saved pictures
 * (finishes, which only the web draws, and the ready-made looks) decoded once.
 */
object SidekickArt {
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private val head: Path by lazy {
        Path().apply {
            SidekickLooks.HEAD.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(x, y) else lineTo(x, y) }
            close()
        }
    }

    /**
     * The face in [color] (ARGB) on [canvas], filling a square [size] pixels wide with the picture's frame, on a clear
     * background. [blink] closes the eyes: 0 open, 1 shut.
     */
    fun draw(canvas: Canvas, size: Float, color: Int, blink: Float = 0f) {
        val (left, top, width, height) = SidekickLooks.VIEW_BOX
        // As SVG fits a viewBox in a square (xMidYMid meet): the taller side fills it, the other is centered.
        val scale = size / maxOf(width, height)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        val white = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = android.graphics.Color.WHITE }
        canvas.save()
        canvas.translate((size - width * scale) / 2f, (size - height * scale) / 2f)
        canvas.scale(scale, scale)
        canvas.translate(-left, -top)
        canvas.drawPath(head, fill)
        canvas.drawCircle(SidekickLooks.ANTENNA_X, SidekickLooks.ANTENNA_Y, SidekickLooks.ANTENNA_R, fill)
        canvas.save()
        canvas.clipPath(head)
        val ry = SidekickLooks.EYE_RY * (1f - blink.coerceIn(0f, 1f) * 0.92f)
        for ((x, y) in SidekickLooks.EYE_CENTERS) {
            canvas.drawOval(RectF(x - SidekickLooks.EYE_RX, y - ry, x + SidekickLooks.EYE_RX, y + ry), white)
        }
        canvas.restore()
        canvas.restore()
    }

    /** [look]'s plain-color face as a square bitmap [size] pixels wide, on a clear background. */
    fun bitmap(look: SidekickLook, size: Int): Bitmap {
        val color = SidekickLooks.color(look)
        val key = "face:$size:$color"
        cache.get(key)?.let { return it }
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        draw(Canvas(bitmap), size.toFloat(), android.graphics.Color.parseColor(color))
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

    /**
     * The PNG saved with a color look as the sidekick's `image` (the web's lookPng), for widgets, notifications, and
     * apps that show pictures: 256 pixels, smaller if it would pass the agent's 48 KB.
     */
    fun png(look: SidekickLook): String = smallest(bitmap(look, 256)) { bitmap(look, it) }

    /**
     * [url] (a ready-made look's PNG) small enough for the agent's 48 KB: as it is if it fits, else drawn smaller.
     * BoopFace's finishes are detailed, so some of the bundled 256-pixel pictures don't.
     */
    fun fit(url: String): String {
        if (url.length < LIMIT) return url
        val picture = picture(url) ?: return url
        return smallest(null) { Bitmap.createScaledBitmap(picture, it, it, true) }
    }

    private fun smallest(first: Bitmap?, draw: (Int) -> Bitmap): String {
        for (size in listOf(256, 192, 160, 128, 96)) {
            val bitmap = if (size == 256 && first != null) first else draw(size)
            val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            val url = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            if (url.length < LIMIT) return url
        }
        error("That look didn't fit in a picture.")
    }

    /** Under the agent's 48,000-byte picture limit, as base64 with its `data:` prefix. */
    private const val LIMIT = 63_000
}

/**
 * A sidekick's plain-color BoopFace, drawn at [size]. [live] ones blink now and then, as on the web, unless the system
 * has animations off; faces shown many at once (lists, messages) stay still.
 */
@Composable
fun SidekickFace(look: SidekickLook, size: Dp, modifier: Modifier = Modifier, live: Boolean = false) {
    val color = remember(look.skin) { android.graphics.Color.parseColor(SidekickLooks.color(look)) }
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
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, color, blink.value) } }
    } else {
        Canvas(modifier.size(size)) { drawIntoCanvas { SidekickArt.draw(it.nativeCanvas, this.size.minDimension, color) } }
    }
}

private const val BLINK_EVERY = 5_200
