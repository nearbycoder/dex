package dev.trydex.android.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexVoice
import dev.trydex.core.client.VoiceException
import dev.trydex.core.voice.CallPlayer
import dev.trydex.core.voice.Recognition
import dev.trydex.core.voice.Speech
import dev.trydex.core.voice.TinyVoca
import okhttp3.OkHttpClient
import java.io.File

/** What a call uses of the device: its ears, its speaker, and their voice. Tests stand in fakes. */
interface CallDevices {
    /** Their voice, shared by every call and preview (the model stays loaded between calls). */
    val speech: Speech

    /** Why this device can't do calls, or null when it can. */
    fun unavailable(): String?

    fun recognition(): Recognition

    /** A call's player, or a voice preview's ([preview]: plays as media, not as a call). */
    fun player(preview: Boolean = false): CallPlayer

    /** Holds the device's audio for a call (communication mode, focus, the speaker); the result lets it go. */
    fun claimAudio(): () -> Unit
}

class AndroidCallDevices(
    private val context: Context,
    http: OkHttpClient,
    session: () -> DexSession?,
    /** Where the model is kept: the app's files (not its cache, which Android may clear), by revision. */
    dir: File = File(context.filesDir, "voice"),
) : CallDevices {
    override val speech: Speech = TinyVoca(
        model = { progress -> DexVoice.model(http, session() ?: throw signedOut(), dir, progress) },
        phonemesOf = { text -> DexVoice.phonemes(http, session() ?: throw signedOut(), text) },
    )

    private fun signedOut() = VoiceException("Sign in again to use calls.", 401)

    override fun unavailable(): String? =
        if (AndroidRecognition.available(context)) null else "This device has no speech recognition, which calls need. Install or turn on a speech service (like Google's) in Settings."

    override fun recognition(): Recognition = AndroidRecognition(context)

    override fun player(preview: Boolean): CallPlayer = TrackPlayer(if (preview) AudioAttributes.USAGE_MEDIA else AudioAttributes.USAGE_VOICE_COMMUNICATION)

    override fun claimAudio(): () -> Unit {
        val audio = context.getSystemService(AudioManager::class.java) ?: return {}
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener { }
            .build()
        audio.requestAudioFocus(focus)
        val mode = audio.mode
        // A call, so the platform's echo cancellation and call volume apply.
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        // Communication audio goes to the earpiece by default; the call screen is held in front of you, so the speaker
        // unless headphones are in.
        val speaker = routeToSpeaker(audio)
        return {
            if (speaker) {
                if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
                else @Suppress("DEPRECATION") { audio.isSpeakerphoneOn = false }
            }
            audio.mode = mode
            audio.abandonAudioFocusRequest(focus)
        }
    }

    private fun routeToSpeaker(audio: AudioManager): Boolean {
        val headphones = setOf(
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET,
        )
        if (audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in headphones }) return false
        return if (Build.VERSION.SDK_INT >= 31) {
            val speaker = audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER } ?: return false
            audio.setCommunicationDevice(speaker)
        } else {
            @Suppress("DEPRECATION")
            audio.isSpeakerphoneOn = true
            true
        }
    }
}
