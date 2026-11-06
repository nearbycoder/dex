package dev.trydex.android.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import dev.trydex.android.data.Faces
import dev.trydex.android.notifications.Notifier
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.components.SidekickArt
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.Characters
import dev.trydex.core.model.SidekickLooks
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

/**
 * Faces drawn here match the web's BoopFace, and no face is cropped: the plain Boop drawn by SidekickArt against the PNG
 * BoopFace made of it (its framing, head, eyes, and antenna), the pictures sent fit the agent's limit, and avatars,
 * notifications, and widgets show a look whole. Anti-aliasing differs a little between renderers, so edges may disagree
 * slightly; shapes, colors, and placement must not.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SidekickArtTest {
    @get:Rule val rule = createComposeRule()

    private val out = File("build/outputs/sidekicks").apply { mkdirs() }

    @Test fun plainFaceMatchesTheWeb() {
        val boop = Characters.preset("boop")!!
        assertThat(boop.look.finish).isNull()
        val web = Characters::class.java.getResourceAsStream("/dev/trydex/core/model/sidekicks/${boop.image}")!!.use { BitmapFactory.decodeStream(it) }
        val ours = SidekickArt.bitmap(boop.look, web.width)
        ours.compress(Bitmap.CompressFormat.PNG, 100, File(out, "boop.png").outputStream())
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
        assertWithMessage("mean channel difference").that(total.toDouble() / (pixels * 4)).isLessThan(1.5)
        assertWithMessage("share of pixels that differ visibly").that(off.toDouble() / pixels).isLessThan(0.01)
    }

    @Test fun picturesFitTheAgentsLimit() {
        for (preset in Characters.PRESETS) {
            val url = SidekickArt.fit(preset.dataUrl)
            assertWithMessage(preset.key).that(url.length).isLessThan(63_000)
            assertWithMessage(preset.key).that(Faces.isCutOut(SidekickArt.picture(url)!!)).isTrue()
        }
        for (skin in SidekickLooks.SKINS.keys) {
            val url = SidekickArt.png(Characters.preset("boop")!!.look.copy(skin = skin))
            assertWithMessage(skin).that(url.length).isLessThan(63_000)
        }
    }

    @Test fun avatarsShowTheWholeFace() {
        val muse = Characters.preset("muse")!!.applyTo(CharacterProfile("muse", name = "Muse"))
        val boop = Characters.preset("boop")!!.applyTo(CharacterProfile("boop", name = "Boop"))
        val magenta = Color(0xFFFF00FF)
        rule.setContent {
            Column {
                Box(Modifier.background(magenta)) { CharacterAvatar(muse, size = 62.dp, modifier = Modifier.testTag("muse")) }
                Box(Modifier.background(magenta)) { CharacterAvatar(boop, size = 62.dp, modifier = Modifier.testTag("boop")) }
            }
        }
        for (tag in listOf("muse", "boop")) {
            val image = rule.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
            image.compress(Bitmap.CompressFormat.PNG, 100, File(out, "avatar-$tag.png").outputStream())
            val (w, h) = image.width to image.height
            // No tinted disc or border: the corners are whatever is behind the face.
            for ((x, y) in listOf(0 to 0, w - 1 to 0, 0 to h - 1, w - 1 to h - 1)) {
                assertWithMessage("$tag corner $x,$y").that(image.getPixel(x, y)).isEqualTo(magenta.toArgbInt())
            }
            // The antenna dot at the top, and the head's sides near the edges, are drawn (a circle crop would cut them).
            assertWithMessage("$tag antenna").that(image.getPixel(w / 2, (h * 16) / 248)).isNotEqualTo(magenta.toArgbInt())
            assertWithMessage("$tag left side").that(image.getPixel((w * 34) / 248, (h * 128) / 248)).isNotEqualTo(magenta.toArgbInt())
            assertWithMessage("$tag lower left").that(image.getPixel((w * 60) / 248, (h * 200) / 248)).isNotEqualTo(magenta.toArgbInt())
        }
    }

    @Test fun notificationsAndWidgetsShowTheWholeFace() {
        for (key in listOf("boop", "muse")) {
            val character = Characters.preset(key)!!.applyTo(CharacterProfile(key, name = key))
            val face = Notifier.faceOf(character)
            face.compress(Bitmap.CompressFormat.PNG, 100, File(out, "notification-$key.png").outputStream())
            assertWithMessage(key).that(Faces.isCutOut(face)).isTrue()
            // Inside the circle Android shows it in: nothing drawn beyond its radius.
            val r = face.width / 2f
            for (y in 0 until face.height) for (x in 0 until face.width) {
                val dx = x + 0.5f - r
                val dy = y + 0.5f - r
                if (dx * dx + dy * dy > r * r) assertWithMessage("$key at $x,$y").that(android.graphics.Color.alpha(face.getPixel(x, y))).isLessThan(24)
            }
            // A widget, which has the picture without the look, tells it's a cut-out and shows it whole too.
            val widget = Faces.round(SidekickArt.picture(character.image!!), character.color, character.face, 168)
            assertWithMessage(key).that(Faces.isCutOut(widget)).isTrue()
        }
        // A photo stays round on its color.
        val photo = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLUE) }
        assertThat(Faces.isCutOut(photo)).isFalse()
        assertThat(Faces.round(photo, "violet", "M", 96).getPixel(48, 48)).isEqualTo(android.graphics.Color.BLUE)
    }

    private fun Color.toArgbInt() = android.graphics.Color.argb((alpha * 255).toInt(), (red * 255).toInt(), (green * 255).toInt(), (blue * 255).toInt())
}
