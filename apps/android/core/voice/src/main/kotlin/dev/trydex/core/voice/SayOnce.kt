package dev.trydex.core.voice

import dev.trydex.core.model.Voice
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Says one line in a voice, for trying voices out (a sidekick's page; call.ts `sayOnce`): the model loads while the
 * phonemes come, each piece plays as it's made, and it returns once the last has played. Cancelling cuts it short.
 * [player] is this line's alone: it's closed at the end.
 */
suspend fun sayOnce(speech: Speech, player: CallPlayer, text: String, voice: Voice, onProgress: (Float) -> Unit = {}) {
    try {
        coroutineScope {
            val loading = async { speech.load(onProgress) }
            val response = speech.phonemes(text)
            loading.await()
            for (utterance in response.sentences.flatMap { it.utterances }) player.play(speech.synthesize(utterance, voice))
        }
        // Until the last piece has played.
        suspendCancellableCoroutine { done ->
            player.onIdle = { if (done.isActive) done.resume(Unit) }
            if (!player.busy && done.isActive) done.resume(Unit)
        }
    } finally {
        player.stop()
        player.close()
    }
}
