package dev.trydex.android.data

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class AssetDownloaderTest {
    @Test fun sanitizesNamesAndPreservesExtension() {
        assertThat(AssetDownloader.sanitizeFileName("Meeting clip", "a1b2c3.mp3")).isEqualTo("Meeting clip.mp3")
        assertThat(AssetDownloader.sanitizeFileName("demo.mp4", "a1b2c3.mp4")).isEqualTo("demo.mp4")
        assertThat(AssetDownloader.sanitizeFileName("../bad/path:name?.wav", "clip.wav")).isEqualTo("_bad_path_name_.wav")
        assertThat(AssetDownloader.sanitizeFileName(null, "clip.m4a")).isEqualTo("clip.m4a")
        assertThat(AssetDownloader.sanitizeFileName("   ", "")).isEqualTo("download")
    }

    @Test fun parsesContentDispositionNames() {
        assertThat(AssetDownloader.headerFileName("attachment; filename*=UTF-8''voice%20note%201.mp3")).isEqualTo("voice note 1.mp3")
        assertThat(AssetDownloader.headerFileName("attachment; filename=\"video.mp4\"")).isEqualTo("video.mp4")
        assertThat(AssetDownloader.headerFileName("inline")).isNull()
    }
}
