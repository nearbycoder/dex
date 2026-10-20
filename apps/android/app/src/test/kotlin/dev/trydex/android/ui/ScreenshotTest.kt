package dev.trydex.android.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.Access
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.GeneralSettings
import dev.trydex.android.ui.nav.AgentEditor
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
 * cover screen, a book foldable open, a tablet in landscape, and a desktop window. Record with
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
        }
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
        harness.setContent(rule)
        rule.awaitText("Weekly metrics dashboard")
    }

    @Test fun chats() {
        start()
        shot("1-chats")
        rule.awaitText("Weekly metrics dashboard").performClick()
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

    @Test fun machines() {
        start()
        open(MachineList)
        rule.awaitTag("machine-chat-tests")
        shot("5-machines")
        open(MachineList, Machine("chat-tests"))
        rule.awaitTag("vm-activity")
        shot("6-machine")
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
        open(LibraryHome, Workspace, WorkspaceFile("/workspace/MEMORY.md"))
        rule.awaitTag("file-screen")
        shot("7h-file")
        open(SettingsHome, GeneralSettings)
        rule.awaitTag("general-settings")
        shot("8-settings")
        open(SettingsHome, Usage)
        rule.awaitTag("tile-boat.dev")
        shot("9-usage")
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
