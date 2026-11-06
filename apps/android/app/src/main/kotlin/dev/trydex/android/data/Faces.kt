package dev.trydex.android.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.util.Base64
import dev.trydex.core.model.Catalogs

/**
 * A sidekick's face as a bitmap, for what Compose doesn't draw (notifications and home-screen widgets), as
 * CharacterAvatar draws them in the app: their look's picture whole on a clear background, a photo cropped to a circle
 * on their color, or their emoji or initial on it.
 */
object Faces {
    /** The bytes of a `data:image/…;base64,…` URL, or null for anything else. */
    fun dataUrlBytes(url: String?): ByteArray? {
        if (url == null || !url.startsWith("data:image/")) return null
        val comma = url.indexOf(',')
        if (comma < 0 || !url.substring(0, comma).endsWith(";base64")) return null
        return runCatching { Base64.decode(url.substring(comma + 1), Base64.DEFAULT) }.getOrNull()
    }

    fun decode(bytes: ByteArray?): Bitmap? = bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() }

    /**
     * [size] pixels across: [picture] whole if it's a look's (a clear background: see [isCutOut]), else round: the
     * picture on [color] (one of the agent colors), or [face] in the color's light shade.
     */
    fun round(picture: Bitmap?, color: String, face: String, size: Int): Bitmap {
        if (picture != null && isCutOut(picture)) return whole(picture, size)
        val (background, foreground) = Catalogs.AGENT_COLORS[color] ?: Catalogs.agentColor("violet")
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val radius = size / 2f
        canvas.drawCircle(radius, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = background.toInt() })
        if (picture != null) {
            // Center-crop the picture into the circle.
            val scale = maxOf(size.toFloat() / picture.width, size.toFloat() / picture.height)
            val matrix = Matrix().apply {
                setScale(scale, scale)
                postTranslate((size - picture.width * scale) / 2f, (size - picture.height * scale) / 2f)
            }
            val shader = BitmapShader(picture, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(matrix) }
            canvas.drawCircle(radius, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.shader = shader })
        } else {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = foreground.toInt()
                textAlign = Paint.Align.CENTER
                textSize = size * 0.45f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            }
            val y = radius - (paint.descent() + paint.ascent()) / 2f
            canvas.drawText(face, radius, y, paint)
        }
        return out
    }

    /**
     * [picture] whole, fitted and centered on a clear square [size] pixels across, with a little room around it: Android
     * shows conversation faces in a circle, and this keeps a BoopFace's corners and antenna inside it.
     */
    fun whole(picture: Bitmap, size: Int): Bitmap {
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val fit = size * 0.92f
        val scale = minOf(fit / picture.width, fit / picture.height)
        val matrix = Matrix().apply {
            setScale(scale, scale)
            postTranslate((size - picture.width * scale) / 2f, (size - picture.height * scale) / 2f)
        }
        Canvas(out).drawBitmap(picture, matrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        return out
    }

    /**
     * Whether [picture] is a shape on a clear background, like a look's BoopFace, rather than a photo: its four corners
     * are see-through. The widgets get pictures without their looks, so they tell by this.
     */
    fun isCutOut(picture: Bitmap): Boolean {
        if (!picture.hasAlpha() || picture.width < 4 || picture.height < 4) return false
        val (right, bottom) = picture.width - 2 to picture.height - 2
        return listOf(1 to 1, right to 1, 1 to bottom, right to bottom).all { (x, y) -> android.graphics.Color.alpha(picture.getPixel(x, y)) < 16 }
    }
}
