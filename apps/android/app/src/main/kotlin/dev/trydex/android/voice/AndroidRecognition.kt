package dev.trydex.android.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import dev.trydex.core.voice.Recognition
import dev.trydex.core.voice.RecognitionEvent

/**
 * The device's speech recognition for a call: on-device when the device has it, else its default recognizer, in
 * American English with partial results. Android's recognizer ends after each utterance (and after a silence); the call
 * starts it again. Used on the main thread only, as SpeechRecognizer requires.
 */
class AndroidRecognition(private val context: Context) : Recognition {
    private var onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    private var recognizer: SpeechRecognizer? = null
    /** Bumped for each session, so a late callback from an older one is dropped. */
    private var session = 0
    /** Errors in a row with nothing heard: past a few, recognition isn't working and the call says so. */
    private var failures = 0

    private fun recognizer(): SpeechRecognizer = recognizer ?: (
        if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        else SpeechRecognizer.createSpeechRecognizer(context)
        ).also { recognizer = it }

    override fun start(onEvent: (RecognitionEvent) -> Unit) {
        val id = ++session
        val recognizer = recognizer()
        recognizer.setRecognitionListener(object : RecognitionListener {
            private fun emit(event: RecognitionEvent) {
                if (id == session) onEvent(event)
            }

            private fun text(results: Bundle?) = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

            override fun onPartialResults(partialResults: Bundle?) {
                val text = text(partialResults)
                if (text.isNotBlank()) {
                    failures = 0
                    emit(RecognitionEvent.Partial(text))
                }
            }

            override fun onResults(results: Bundle?) {
                val text = text(results)
                if (text.isNotBlank()) {
                    failures = 0
                    emit(RecognitionEvent.Final(text))
                }
                emit(RecognitionEvent.Ended)
            }

            override fun onError(error: Int) {
                when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                        return emit(RecognitionEvent.Failed("Dex needs the microphone for calls. Allow it in Settings → Apps → Dex → Permissions."))
                    // Silence: nothing to hear yet.
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> Unit
                    LANGUAGE_NOT_SUPPORTED, LANGUAGE_UNAVAILABLE -> if (onDevice) {
                        // The on-device recognizer lacks English here: the default one instead, from the next session.
                        onDevice = false
                        this@AndroidRecognition.recognizer?.destroy()
                        this@AndroidRecognition.recognizer = null
                    } else failures++
                    else -> failures++
                }
                if (failures >= MAX_FAILURES) {
                    emit(RecognitionEvent.Failed(if (error == SpeechRecognizer.ERROR_AUDIO) "Couldn't use the microphone." else "Speech recognition isn't working on this device right now (error $error)."))
                } else {
                    emit(RecognitionEvent.Ended)
                }
            }

            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        recognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName),
        )
    }

    override fun cancel() {
        session++
        recognizer?.cancel()
    }

    override fun close() {
        session++
        recognizer?.destroy()
        recognizer = null
    }

    companion object {
        private const val MAX_FAILURES = 8
        // SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED and ERROR_LANGUAGE_UNAVAILABLE (API 31).
        private const val LANGUAGE_NOT_SUPPORTED = 12
        private const val LANGUAGE_UNAVAILABLE = 13

        /** Whether this device can hear you at all. */
        fun available(context: Context) =
            SpeechRecognizer.isRecognitionAvailable(context) || (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context))
    }
}
