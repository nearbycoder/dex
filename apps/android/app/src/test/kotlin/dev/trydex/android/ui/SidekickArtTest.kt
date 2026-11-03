package dev.trydex.android.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.android.ui.components.SidekickArt
import dev.trydex.core.model.Characters
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

/**
 * Looks drawn here match the web's: each ready-made look (between them, every body, eyes, mouth, extra, and body color)
 * drawn by SidekickArt against the PNG the web's sidekickSvg made of it (assets/sidekicks). Anti-aliasing differs a
 * little between Skia builds, so edges may disagree slightly; shapes, colors, and placement must not.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SidekickArtTest {
    @Test fun presetsMatchTheWeb() {
        val out = File("build/outputs/sidekicks").apply { mkdirs() }
        for (preset in Characters.PRESETS) {
            val web = Characters::class.java.getResourceAsStream("/dev/trydex/core/model/sidekicks/${preset.image}")!!.use { BitmapFactory.decodeStream(it) }
            val ours = SidekickArt.bitmap(preset.look, preset.color, web.width)
            ours.compress(Bitmap.CompressFormat.PNG, 100, File(out, "${preset.key}.png").outputStream())
            var total = 0L
            var off = 0
            for (y in 0 until web.height) for (x in 0 until web.width) {
                val a = web.getPixel(x, y)
                val b = ours.getPixel(x, y)
                val channels = intArrayOf(24, 16, 8, 0).map { shift -> abs((a ushr shift and 0xFF) - (b ushr shift and 0xFF)) }
                total += channels.sum()
                if (channels.max() > 48) off++
            }
            val pixels = web.width * web.height
            val mean = total.toDouble() / (pixels * 4)
            assertWithMessage("${preset.key}: mean channel difference").that(mean).isLessThan(1.5)
            assertWithMessage("${preset.key}: share of pixels that differ visibly").that(off.toDouble() / pixels).isLessThan(0.01)
        }
    }

    @Test fun snapshotsFitTheAgentsLimit() {
        for (preset in Characters.PRESETS) {
            val url = SidekickArt.png(preset.look, preset.color)
            assertWithMessage(preset.key).that(url.length).isLessThan(63_000)
        }
    }
}
