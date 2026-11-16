package dev.trydex.android.ui

import android.Manifest
import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.testing.Harness
import dev.trydex.android.testing.awaitTag
import dev.trydex.android.testing.awaitText
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.core.model.Voice
import dev.trydex.core.voice.RecognitionEvent
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Calling a sidekick against the fake Dex, with a scripted microphone and speaker; and choosing their voice. */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class VoiceCallTest {
    @get:Rule val rule = createComposeRule()
    private val harness = Harness(chunkMs = 0)
    private val voice get() = harness.voice

    // The face's per-frame movement would keep Compose from ever idling.
    @Before fun noAnimations() = durationScale(0f)

    @After fun tearDown() {
        durationScale(1f)
        harness.close()
    }

    /** Settings → Remove animations, as ValueAnimator sees it (its setter is hidden). */
    private fun durationScale(scale: Float) {
        android.animation.ValueAnimator::class.java.getMethod("setDurationScale", Float::class.javaPrimitiveType).invoke(null, scale)
    }

    private fun allowMicrophone() = shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.RECORD_AUDIO)

    /** Waits, running what the call posted to the main thread meanwhile. */
    private fun awaitCall(condition: () -> Boolean) = rule.waitUntil(10_000) {
        shadowOf(android.os.Looper.getMainLooper()).idle()
        condition()
    }

    private fun openMuse() {
        harness.setContent(rule)
        rule.awaitTag("character-muse").performClick()
        rule.awaitTag("character-title")
    }

    @Test fun aCallHearsYouAndReadsTheirReplyAloud() {
        allowMicrophone()
        openMuse()
        rule.awaitTag("character-call").performClick()
        rule.awaitTag("voice-call")
        rule.onNode(hasText("Muse") and hasAnyAncestor(hasTestTag("voice-call"))).assertIsDisplayed()
        awaitCall { rule.onAllNodes(hasTestTag("call-status")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("call-status").assertTextEquals("Listening")
        assertThat(voice.claims).isEqualTo(1)

        // You speak: your words show, and the end of the utterance sends them, marked as spoken.
        val recognition = voice.recognitions.single()
        rule.runOnUiThread { recognition.hear(RecognitionEvent.Partial("what are we")) }
        rule.awaitTag("call-heard").assertTextEquals("“what are we”")
        rule.runOnUiThread { recognition.hear(RecognitionEvent.Final("what are we making"), RecognitionEvent.Ended) }
        awaitCall { harness.fake.spoken.isNotEmpty() }
        assertThat(harness.fake.spoken).containsExactly("what are we making")

        // Their reply streams in and is read a sentence at a time, in their voice (Muse's, from her id).
        awaitCall { voice.synthesized.size >= 2 }
        assertThat(voice.synthesized.map { it.second }.toSet()).containsExactly(Voice.F2)
        rule.awaitTag("call-saying")
        rule.onNodeWithTag("call-status").assertTextEquals("Speaking")
        val player = voice.players.single { !it.preview }
        assertThat(player.played).isEqualTo(2)
        rule.runOnUiThread { player.drain() }
        awaitCall { rule.onAllNodes(hasTestTag("call-saying")).fetchSemanticsNodes().isEmpty() }
        rule.onNodeWithTag("call-status").assertTextEquals("Listening")

        // Listening starts again after each utterance; Mute stops it; End closes the call and lets the audio go.
        rule.runOnUiThread { shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(300)) }
        assertThat(recognition.listening).isTrue()
        rule.onNodeWithTag("call-mute").performClick()
        rule.onNodeWithTag("call-status").assertTextEquals("Muted")
        assertThat(recognition.listening).isFalse()
        rule.onNodeWithTag("call-end").performClick()
        awaitCall { rule.onAllNodes(hasTestTag("voice-call")).fetchSemanticsNodes().isEmpty() }
        assertThat(recognition.closed).isTrue()
        assertThat(player.closed).isTrue()
        assertThat(voice.releases).isEqualTo(1)
        // Back in the chat, what was said is there.
        rule.awaitText("what are we making")
    }

    @Test fun itAsksForTheMicrophoneFirstAndSaysWhy() {
        openMuse()
        rule.awaitTag("character-call").performClick()
        rule.awaitText("Talk with Muse")
        rule.onNodeWithText("It listens only while the call is open.", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Not now").performClick()
        assertThat(rule.onAllNodes(hasTestTag("voice-call")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun onlyInTheirCurrentConversation() {
        harness.setContent(rule)
        rule.awaitTag("character-muse")
        harness.links.send(routesFor("dex://app/chat/chat-muse-earlier")!!)
        rule.awaitText("Earlier conversation", substring = true)
        assertThat(rule.onAllNodes(hasTestTag("character-call")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun aDeviceWithoutRecognitionSaysSo() {
        allowMicrophone()
        voice.unavailableReason = "This device has no speech recognition, which calls need."
        openMuse()
        rule.awaitTag("character-call").performClick()
        rule.awaitText("This device has no speech recognition, which calls need.")
        assertThat(rule.onAllNodes(hasTestTag("voice-call")).fetchSemanticsNodes()).isEmpty()
    }

    @Test fun theirVoiceIsPickedHeardAndSaved() {
        openMuse()
        rule.onNodeWithTag("character-title").performClick()
        rule.awaitTag("character-editor")
        // None chosen: the one from her id.
        rule.onNodeWithTag("voice-F2").performScrollTo().assertIsSelected()
        rule.onNodeWithTag("voice-M2").assertIsNotSelected()
        // Picking one plays her greeting in it.
        rule.onNodeWithTag("voice-M2").performScrollTo().performClick().assertIsSelected()
        awaitCall { voice.synthesized.isNotEmpty() }
        // Her greeting's first two sentences (the fake knows those).
        assertThat(voice.synthesized.map { it.second }).containsExactly(Voice.M2)
        val preview = voice.players.single()
        assertThat(preview.preview).isTrue()
        rule.onNodeWithText("Warm (male)").assertIsDisplayed()
        rule.runOnUiThread { preview.drain() }
        awaitCall { preview.closed }

        rule.onNodeWithTag("character-save").performClick()
        awaitCall { harness.fake.calls.any { it.first == "saveCharacter" } }
        val draft = harness.fake.calls.last { it.first == "saveCharacter" }.second[0].jsonObject
        assertThat(draft["voice"]!!.jsonPrimitive.content).isEqualTo("M2")
        awaitCall { harness.fake.state.character("muse")?.voice == "M2" }
    }
}
