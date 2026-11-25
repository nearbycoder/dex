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
 * Faces drawn here are the agent's pictures, and no face is cropped: every ready-made look drawn by SidekickArt (its
 * shape's body tinted, under its eyes) against the picture the agent's renderer drew of it, and avatars, notifications,
 * and widgets show a look whole. Scaling may move edges by a hair; shapes, colors, and placement must not.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SidekickArtTest {
    @get:Rule val rule = createComposeRule()

    private val out = File("build/outputs/sidekicks").apply { mkdirs() }

    @Test fun facesMatchTheAgentsPictures() {
        for (preset in Characters.PRESETS) {
            val agent = Characters::class.java.getResourceAsStream("/dev/trydex/core/model/sidekicks/${preset.image}")!!.use { BitmapFactory.decodeStream(it) }
            val ours = SidekickArt.bitmap(preset.look, agent.width)!!
            ours.compress(Bitmap.CompressFormat.PNG, 100, File(out, "${preset.key}.png").outputStream())
            var total = 0L
            var off = 0
            for (y in 0 until agent.height) for (x in 0 until agent.width) {
                val a = agent.getPixel(x, y)
                val b = ours.getPixel(x, y)
                val channels = intArrayOf(24, 16, 8, 0).map { shift -> abs((a ushr shift and 0xFF) - (b ushr shift and 0xFF)) }
                total += channels.sum()
                if (channels.max() > 48) off++
            }
            val pixels = agent.width * agent.height
            assertWithMessage("${preset.key}: mean channel difference").that(total.toDouble() / (pixels * 4)).isLessThan(1.5)
            assertWithMessage("${preset.key}: share of pixels that differ visibly").that(off.toDouble() / pixels).isLessThan(0.01)
        }
        // A shape a chat drew isn't drawn here: its picture shows instead.
        assertThat(SidekickArt.bitmap(SidekickLooks.make("custom", "mint", dev.trydex.core.model.CustomShape("Box", "M20 20 H80 V80 H20 Z")), 64)).isNull()
    }

    @Test fun materialFacesRenderWithTransparentCorners() {
        for (material in listOf("fluffy", "glass")) {
            val look = SidekickLooks.make("cat", "sky", material = material)
            val face = SidekickArt.bitmap(look, 256)!!
            assertWithMessage(material).that(Faces.isCutOut(face)).isTrue()
            val url = SidekickArt.materialDataUrl(look)!!
            assertWithMessage(material).that(url).startsWith("data:image/")
            assertWithMessage(material).that(url.length).isAtMost(63_000)
            assertWithMessage(material).that(Faces.isCutOut(SidekickArt.picture(url)!!)).isTrue()
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
            // The face is drawn, and so are its tips near the edges (a circle crop would cut them): the robot's antenna and
            // ears, the lightbulb's top and base.
            val points = if (tag == "boop") listOf(50 to 15, 16 to 58, 50 to 60) else listOf(50 to 12, 50 to 84, 50 to 40)
            for ((x, y) in points) {
                assertWithMessage("$tag at $x,$y").that(image.getPixel(w * x / 100, h * y / 100)).isNotEqualTo(magenta.toArgbInt())
            }
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
