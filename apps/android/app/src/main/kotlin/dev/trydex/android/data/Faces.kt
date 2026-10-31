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
 * A sidekick's face as a bitmap, for what Compose doesn't draw (notifications and home-screen widgets): their picture
 * cropped to a circle on their color, or their emoji or initial on it, as CharacterAvatar draws them in the app.
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

    /** Round, [size] pixels across: [picture] on [color] (one of the agent colors), else [face] in the color's light shade. */
    fun round(picture: Bitmap?, color: String, face: String, size: Int): Bitmap {
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
}
