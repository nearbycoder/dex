package dev.trydex.android.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.ui.theme.AppearanceMode
import dev.trydex.android.ui.theme.DexTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * The Markdown fixture drawn as a reply: what shows (and what mustn't show raw), and pictures of it in light and dark
 * in build/outputs/markdown to compare with the web.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h4000dp-xhdpi")
class MarkdownRenderTest {
    @get:Rule val rule = createComposeRule()
    private val fixture = javaClass.classLoader!!.getResource("markdown-fixture.md")!!.readText()

    private fun show(appearance: AppearanceMode, text: () -> String) {
        rule.setContent {
            DexTheme(appearance = appearance) {
                Surface(Modifier.width(411.dp).testTag("markdown")) {
                    Markdown(text(), Modifier.padding(16.dp))
                }
            }
        }
        rule.waitForIdle()
    }

    private fun save(name: String) {
        val bitmap = rule.onNodeWithTag("markdown").captureToImage().asAndroidBitmap()
        val dir = File("build/outputs/markdown").apply { mkdirs() }
        // In slices a screen tall, to look at one at a time.
        var top = 0
        var n = 0
        while (top < bitmap.height) {
            val slice = Bitmap.createBitmap(bitmap, 0, top, bitmap.width, minOf(1600, bitmap.height - top))
            File(dir, "$name-${n++}.png").outputStream().use { slice.compress(Bitmap.CompressFormat.PNG, 100, it) }
            top += 1600
        }
    }

    @Test fun fixtureDark() {
        show(AppearanceMode.Dark) { fixture }
        rule.onNodeWithText("Heading 6").assertExists()
        assertThat(rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).fetchSemanticsNodes()).hasSize(6)
        rule.onNodeWithText("Nested twice").assertExists()
        rule.onAllNodesWithContentDescription("Done").assertCountEquals(1)
        rule.onAllNodesWithContentDescription("Not done").assertCountEquals(2)
        rule.onNodeWithText("Mixed bullet under ordered").assertExists()
        rule.onNodeWithText("x = 1", substring = true).assertExists()
        rule.onNodeWithText("thirteen").assertExists()
        rule.onNodeWithText("Starts at five").assertExists()
        rule.onNodeWithText("5.").assertExists()
        rule.onNodeWithText("echo hi").assertExists()
        rule.onNodeWithText("The first footnote.").assertExists()
        rule.onNodeWithText("A footnote reference1 and another2.").assertExists()
        // Nothing raw but what's raw on the web too (escapes, HTML, and a reply's unclosed ends).
        for (raw in listOf("**bold**", "# Heading", "- Bullet", "[^1]", "[ref]:", "| Left", "```", "~~", "[ ]")) {
            rule.onAllNodesWithText(raw, substring = true).assertCountEquals(0)
        }
        rule.onNodeWithText("<div>An HTML block</div>").assertExists()
        save("fixture-dark")
    }

    @Test fun fixtureLight() {
        show(AppearanceMode.Light) { fixture }
        rule.onNodeWithText("Heading 1").assertExists()
        save("fixture-light")
    }

    @Test fun streamingNeverBreaks() {
        // Cut mid-bold, mid-fence, mid-table, mid-footnote: each draws, and the open fence is already code.
        var text by mutableStateOf("")
        show(AppearanceMode.Dark) { text }
        for (marker in listOf("**bold**, *ital", "```kotlin\nfun main", "| a | **b", "|:-----|:---", "reference[^1", "[^note]: A named")) {
            text = fixture.substring(0, fixture.indexOf(marker) + marker.length)
            rule.waitForIdle()
        }
        text = "Here:\n\n```kotlin\nfun main() {"
        rule.waitForIdle()
        rule.onNodeWithText("fun main() {").assertExists()
        rule.onNodeWithText("```", substring = true).assertDoesNotExist()
    }
}
