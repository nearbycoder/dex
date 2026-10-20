package dev.trydex.android

import android.content.pm.ActivityInfo
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.window.layout.FoldingFeature
import androidx.window.testing.layout.FoldingFeature as TestFoldingFeature
import androidx.window.testing.layout.TestWindowLayoutInfo
import androidx.window.testing.layout.WindowLayoutInfoPublisherRule
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.data.SignedOutReason
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexUser
import dev.trydex.fake.FakeData
import dev.trydex.fake.FakeDex
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

typealias DexRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/**
 * The app on a real device (phone, tablet, foldable, desktop window) against a fake Dex running on the device. What it
 * checks depends on the window: one pane or two, a bar or a rail.
 */
@RunWith(AndroidJUnit4::class)
class DeviceTest {
    private val publisher = WindowLayoutInfoPublisherRule()
    private val compose: DexRule = createAndroidComposeRule<MainActivity>()

    @get:Rule val rules: TestRule = RuleChain.outerRule(publisher).around(compose)

    private val fake = FakeDex(chunkMs = 20)
    private val graph get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as DexApplication).graph

    @Before fun signIn() {
        val server = fake.start()
        val session = DexSession(server.toString(), fake.token, DexUser(FakeData.USER_ID, FakeData.LOGIN, "Mona Octocat"), System.currentTimeMillis() + 86_400_000)
        compose.runOnUiThread {
            graph.repository.setVisible(true)
            graph.repository.signIn(session)
        }
    }

    @After fun signOut() {
        compose.runOnUiThread { graph.repository.signOut(SignedOutReason.SignedOut) }
        fake.close()
    }

    private fun tag(tag: String, timeout: Long = 15_000): SemanticsNodeInteraction {
        compose.waitUntil(timeout) { compose.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        return compose.onNode(hasTestTag(tag), useUnmergedTree = true)
    }

    private fun text(text: String, timeout: Long = 15_000): SemanticsNodeInteraction {
        compose.waitUntil(timeout) { compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        return compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true)[0]
    }

    private fun widthDp(): Int {
        val metrics = compose.activity.resources.displayMetrics
        val bounds = compose.activity.windowManager.currentWindowMetrics.bounds
        return (bounds.width() / metrics.density).toInt()
    }

    /** Whether a node with this tag is on screen (composed but hidden doesn't count). */
    private fun exists(tag: String) = compose.onAllNodes(hasTestTag(tag) and isDisplayed(), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun isDisplayed() = androidx.compose.ui.test.SemanticsMatcher("is displayed") { node ->
        val bounds = node.boundsInWindow
        bounds.width > 0 && bounds.height > 0 && node.layoutInfo.isPlaced &&
            bounds.right > 0 && bounds.left < compose.activity.window.decorView.width &&
            bounds.bottom > 0 && bounds.top < compose.activity.window.decorView.height
    }

    @Test fun listAndDetailFollowTheWindowWidth() {
        text("Weekly metrics dashboard").performClick()
        tag("chat-screen")
        compose.waitForIdle()
        if (widthDp() >= 600) {
            // Two panes: the inbox stays beside the chat, with a rail instead of a bottom bar.
            assertThat(exists("chat-list")).isTrue()
        } else {
            // One pane: the chat takes the screen and the bar steps aside.
            compose.waitUntil(5_000) { !exists("chat-list") && !exists("tab-Chats") }
        }
    }

    @Test fun generatedUiAndSending() {
        text("Weekly metrics dashboard").performClick()
        tag("openui-chart")
        tag("composer-input").performTextInput("Add a column for errors")
        compose.onNodeWithTag("send").performClick()
        text("Add a column for errors")
        compose.waitUntil(15_000) { fake.calls.any { it.first == "sendMessage" } }
    }

    @Test fun aChatSurvivesRotationAndRecreation() {
        text("Compare vector databases").performClick()
        tag("composer-input").performTextInput("draft that must survive")
        compose.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        compose.waitForIdle()
        compose.activityRule.scenario.recreate()
        tag("chat-screen")
        text("draft that must survive").assertIsDisplayed()
        compose.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }

    @Test fun machineShowsTheLiveDesktopAndLog() {
        tag("tab-Machines").performClick()
        tag("machine-chat-tests").performClick()
        tag("desktop", 30_000)
        tag("vm-activity")
        tag("vm-command").performTextInput("uname -a")
        tag("vm-command").performImeAction()
        compose.waitUntil(15_000) { fake.calls.any { it.first == "vmRun" } }
    }

    @Test fun tabletopPutsTheDesktopAboveTheFold() {
        tag("tab-Machines").performClick()
        tag("machine-chat-tests").performClick()
        tag("desktop", 30_000)
        val fold = TestFoldingFeature(activity = compose.activity, state = FoldingFeature.State.HALF_OPENED, orientation = FoldingFeature.Orientation.HORIZONTAL)
        publisher.overrideWindowLayoutInfo(TestWindowLayoutInfo(listOf(fold)))
        compose.waitForIdle()
        // Half open, flat on a table: the desktop sits above the hinge, the log and command line below it.
        compose.waitForIdle()
        val desktop = tag("desktop").fetchSemanticsNode().boundsInWindow
        val log = tag("vm-command").fetchSemanticsNode().boundsInWindow
        val hinge = fold.bounds
        assertThat(desktop.bottom).isAtMost(hinge.top.toFloat() + 1)
        assertThat(log.top).isAtLeast(hinge.bottom.toFloat() - 1)
    }

    @Test fun leavingWithARunningDesktopEntersPictureInPicture() {
        text("Fix the flaky login test").performClick()
        // The VM floats over the chat, as a button or (if it was left open) a window.
        compose.waitUntil(15_000) { listOf("vm-preview-button", "vm-preview").any { exists(it) } }
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressHome()
        compose.waitUntil(10_000) { compose.activity.isInPictureInPictureMode }
    }

}
