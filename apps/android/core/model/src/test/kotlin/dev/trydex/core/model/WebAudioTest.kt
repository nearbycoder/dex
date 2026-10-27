package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import java.io.File

class WebAudioTest {
    private val script = WebAudio.UNLOCK_SCRIPT

    @Test fun unlockGoesFirst() {
        assertThat(WebAudio.withAudioUnlock("<!doctype html><html lang=en><HEAD><title>x</title></head>"))
            .isEqualTo("<!doctype html><html lang=en><HEAD>$script<title>x</title></head>")
        assertThat(WebAudio.withAudioUnlock("<html><body>hi</body></html>")).isEqualTo("<html>$script<body>hi</body></html>")
        assertThat(WebAudio.withAudioUnlock("<!DOCTYPE html><p>hi")).isEqualTo("<!DOCTYPE html>$script<p>hi")
        assertThat(WebAudio.withAudioUnlock("<p>hi</p>")).isEqualTo("$script<p>hi</p>")
        val once = WebAudio.withAudioUnlock("<p>hi</p>")
        assertThat(WebAudio.withAudioUnlock(once)).isEqualTo(once)
    }

    /** The same script as the web's (apps/web/src/shared/web-audio.ts), when the repo is around. */
    @Test fun matchesTheWeb() {
        val web = File("../../../web/src/shared/web-audio.ts").takeIf { it.exists() } ?: return
        val source = web.readText()
        val start = source.indexOf("export const AUDIO_UNLOCK_SCRIPT = `") + "export const AUDIO_UNLOCK_SCRIPT = `".length
        assertThat(source.substring(start, source.indexOf('`', start))).isEqualTo(script)
    }
}
