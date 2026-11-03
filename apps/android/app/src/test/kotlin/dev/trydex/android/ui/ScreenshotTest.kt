package dev.trydex.android.ui

import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.Access
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.AgentEditor
import dev.trydex.android.ui.nav.CharacterEditor
import dev.trydex.android.ui.nav.CharacterList
import dev.trydex.android.ui.nav.AgentList
import dev.trydex.android.ui.nav.LibraryHome
import dev.trydex.android.ui.nav.McpEditor
import dev.trydex.android.ui.nav.McpList
import dev.trydex.android.ui.nav.ProjectEditor
import dev.trydex.android.ui.nav.ProjectList
import dev.trydex.android.ui.nav.SkillList
import dev.trydex.android.ui.nav.Workspace
import dev.trydex.android.ui.nav.WorkspaceFile
import dev.trydex.android.ui.nav.Machine
import dev.trydex.android.ui.nav.MachineFiles
import dev.trydex.android.ui.nav.MachineList
import dev.trydex.android.ui.nav.NewChat
import dev.trydex.android.ui.nav.Route
import dev.trydex.android.ui.nav.SettingsHome
import dev.trydex.android.ui.nav.Usage
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper

/**
 * Screens at each form factor, in light and dark, for checking styling and adaptive layouts: a phone, a flip phone's
 * cover screen, a book foldable open, a tablet in landscape, and a desktop window; and a small phone with the largest
 * common font size, where text wraps and controls crowd first. Record with
 * `./gradlew :app:recordRoborazziDebug`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreenshotTest(private val device: String, private val qualifiers: String) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun devices() = listOf(
            Triple("phone", "w411dp-h891dp-port", "xxhdpi"),
            Triple("flip-cover", "w340dp-h380dp-port", "xhdpi"),
            Triple("fold-open", "w674dp-h841dp-port", "xhdpi"),
            Triple("tablet", "w1280dp-h800dp-land", "xhdpi"),
            Triple("desktop", "w1600dp-h1000dp-land", "mdpi"),
        ).flatMap { (name, screen, density) ->
            listOf(arrayOf(name, "$screen-notnight-$density"), arrayOf("$name-dark", "$screen-night-$density"))
        } + listOf(arrayOf("small-large-font", "w360dp-h740dp-port-notnight-xhdpi"))
    }

    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)

    @After fun tearDown() = harness.close()

    private fun open(vararg routes: Route) {
        rule.runOnIdle { harness.links.send(routes.toList()) }
    }

    private fun shot(name: String) {
        // Let images and animations settle.
        repeat(5) { ShadowLooper.idleMainLooper(100, java.util.concurrent.TimeUnit.MILLISECONDS); rule.waitForIdle() }
        rule.onRoot().captureRoboImage("src/test/screenshots/$device/$name.png")
    }

    private fun start() {
        org.robolectric.RuntimeEnvironment.setQualifiers(qualifiers)
        if (device.endsWith("large-font")) org.robolectric.RuntimeEnvironment.setFontScale(1.3f)
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
    }

    @Test fun chats() {
        start()
        shot("1-chats")
        // On a flip phone's cover screen the sidekicks push the first chat under the navigation bar: a tap at its
        // center would land on the bar, so bring it into view first.
        rule.awaitText("Weekly metrics dashboard").performScrollTo().performClick()
        rule.awaitTag("openui-card-host")
        shot("2-chat-generated-ui")
        open(ChatList, Chat("chat-tests"))
        rule.awaitText("Fix the flaky", substring = true)
        rule.awaitTag("messages")
        shot("3-chat-vm")
        open(ChatList, NewChat(nonce = 1))
        rule.awaitTag("new-chat-headline")
        shot("4-new-chat")
    }

    @Test fun modelMenu() {
        start()
        open(ChatList, NewChat(nonce = 1))
        rule.awaitTag("new-chat-headline")
        rule.waitUntil(10_000) { harness.graph.models.find("cline-pass/crouton-alpha") != null }
        awaitPrefs { !it.modelsNewest }
        rule.awaitTag("model-picker").performScrollTo().performClick()
        rule.awaitTag("model-sheet")
        shot("4b-model-menu")
        rule.awaitTag("model-newest").performClick()
        awaitPrefs { it.modelsNewest }
        rule.awaitText("THIS WEEK")
        shot("4c-model-menu-newest")
        rule.awaitTag("model-within-30").performScrollTo().performClick()
        shot("4d-model-menu-newest-30-days")
        // Off again: the choice is kept on the device, which the other tests share.
        rule.awaitTag("model-newest").performClick()
        awaitPrefs { !it.modelsNewest }
        rule.awaitTag("model-tab-openrouter").performScrollTo().performClick()
        rule.awaitTag("model-openrouter/stealth/crouton-alpha")
        shot("4e-model-menu-openrouter")
        // Its free models are listed without a key too, under a nudge to connect one.
        harness.fake.update { it.copy(openrouter = dev.trydex.core.model.ProviderStatus()) }
        rule.waitUntil(10_000) { harness.graph.repository.state.value?.openrouter?.connected == false }
        rule.awaitText("Connect in Settings")
        shot("4f-model-menu-openrouter-not-connected")
    }

    /** Waits for the saved preferences (DataStore answers on the main looper, which the compose rule doesn't run). */
    private fun awaitPrefs(check: (dev.trydex.android.data.AppPrefs) -> Boolean) = rule.waitUntil(5_000) {
        ShadowLooper.idleMainLooper()
        check(harness.graph.preferences.prefs.value)
    }

    @Test fun machines() {
        start()
        open(MachineList)
        rule.awaitTag("machine-chat-tests")
        shot("5-machines")
        open(MachineList, Machine("chat-tests"))
        rule.awaitTag("vm-activity")
        shot("6-machine")
        open(MachineList, Machine("chat-tests"), MachineFiles("chat-tests"))
        rule.awaitTag("file-row-dex").performClick()
        rule.awaitTag("file-row-src").performClick()
        // A cover screen shows only a few rows: scroll the tree to the file.
        rule.waitUntil(10_000) { rule.onAllNodes(hasTestTag("file-row-agent"), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("files-tree").performScrollToNode(hasTestTag("file-row-server.ts"))
        shot("6b-files")
        rule.awaitTag("file-row-server.ts").performClick()
        rule.awaitTag("file-source-view")
        shot("6c-file-source")
        // Leaving the route drops its saved selection, so Files opens on its list again.
        open(MachineList, Machine("chat-tests"))
        rule.awaitTag("vm-activity")
        open(MachineList, Machine("chat-tests"), MachineFiles("chat-tests"))
        rule.awaitTag("files-tab-changes").performClick()
        rule.awaitText("dex/src/server.ts").performClick()
        rule.awaitTag("diff-gap")
        shot("6d-file-diff")
    }

    @Test fun libraryAndSettings() {
        start()
        open(LibraryHome)
        rule.awaitTag("library-home")
        shot("7-library")
        open(LibraryHome, ProjectList)
        rule.awaitTag("project-list")
        shot("7b-projects")
        open(LibraryHome, ProjectList, ProjectEditor("dex-web"))
        rule.awaitTag("project-save")
        shot("7c-project-editor")
        open(LibraryHome, AgentList, AgentEditor("pr-author"))
        rule.awaitTag("agent-save")
        shot("7d-agent-editor")
        open(LibraryHome, SkillList)
        rule.awaitTag("skill-list")
        shot("7e-skills")
        open(LibraryHome, McpList)
        rule.awaitTag("mcp-list")
        shot("7f-mcp")
        open(LibraryHome, McpList, McpEditor("new"))
        rule.awaitTag("mcp-save")
        shot("7g-mcp-editor")
        open(LibraryHome, CharacterList, CharacterEditor("muse"))
        rule.awaitTag("character-editor")
        rule.onNodeWithTag("character-look-muse").performScrollTo()
        shot("7g2-sidekick-looks")
        rule.onNodeWithTag("look-cheeks-plain").performScrollTo()
        shot("7g3-sidekick-parts")
        open(LibraryHome, Workspace, WorkspaceFile("/workspace/MEMORY.md"))
        rule.awaitTag("file-screen")
        shot("7h-file")
        open(SettingsHome, GeneralSettings)
        rule.awaitTag("general-settings")
        shot("8-settings")
        rule.awaitTag("connect-openrouter").performScrollTo()
        shot("8b-settings-openrouter")
        rule.onAllNodes(androidx.compose.ui.test.hasText("Replace") and androidx.compose.ui.test.hasAnyAncestor(hasTestTag("connect-openrouter")))[0].performClick()
        rule.awaitTag("connect-openrouter-key").performScrollTo()
        shot("8c-settings-openrouter-replace")
        open(SettingsHome, Usage)
        rule.awaitTag("usage-bill")
        shot("9-usage")
        rule.awaitTag("service-commandcode").performScrollTo().performClick()
        rule.awaitTag("allowance-commandcode")
        shot("9b-usage-command-code")
        open(SettingsHome, Access)
        rule.awaitTag("access")
        shot("10-access")
        open(SettingsHome, dev.trydex.android.ui.nav.Secrets)
        rule.awaitTag("secrets")
        shot("11-secrets")
        open(SettingsHome, dev.trydex.android.ui.nav.NotificationSettings)
        rule.awaitTag("notifications")
        shot("12-notifications")
    }
}
