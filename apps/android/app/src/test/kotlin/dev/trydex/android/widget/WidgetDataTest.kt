package dev.trydex.android.widget

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import dev.trydex.android.data.Faces
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.composeTarget
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.core.model.Characters
import dev.trydex.core.model.WidgetSidekick
import dev.trydex.core.model.WidgetSnapshot
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.file.Files

/** What the widgets show, from the stored snapshot, and the links they open. */
@RunWith(AndroidJUnit4::class)
class WidgetDataTest {
    private val atlas = WidgetSidekick("atlas", "Atlas", "Organized", "sky", Characters.preset("atlas")!!.dataUrl, "", "chat-atlas", unread = true, lastReply = "Morning!")
    private val muse = WidgetSidekick("muse", "Muse", "Creative", "violet", Characters.preset("muse")!!.dataUrl, "", "chat-muse")

    @Test fun storesTheSnapshotAndPicturesApart() {
        val store = WidgetStore(Files.createTempDirectory("widgets").toFile())
        assertThat(store.load()).isNull()
        assertThat(store.save(WidgetSnapshot(1, listOf(atlas, muse)), imagesIncluded = true)).isTrue()
        val kept = store.load()!!
        // The snapshot keeps no pictures; they're files of their own.
        assertThat(kept.sidekicks.map { it.image }).containsExactly(null, null)
        assertThat(kept.sidekick("atlas")!!.lastReply).isEqualTo("Morning!")
        assertThat(store.hasPicture("atlas")).isTrue()
        assertThat(store.fullAt).isGreaterThan(0)
        // The same again changes nothing.
        assertThat(store.save(WidgetSnapshot(1, listOf(atlas, muse)), imagesIncluded = true)).isFalse()

        // Asked with images=0: the pictures here stay.
        assertThat(store.save(WidgetSnapshot(0, listOf(atlas.copy(image = null, unread = false), muse.copy(image = null))), imagesIncluded = false)).isTrue()
        assertThat(store.hasPicture("atlas")).isTrue()
        assertThat(store.load()!!.sidekick("atlas")!!.unread).isFalse()
        // With pictures, one without any has none; a sidekick that's gone takes theirs along.
        store.save(WidgetSnapshot(0, listOf(atlas.copy(image = null))), imagesIncluded = true)
        assertThat(store.hasPicture("atlas")).isFalse()
        assertThat(store.hasPicture("muse")).isFalse()
        store.clear()
        assertThat(store.load()).isNull()
    }

    @Test fun theSidekickWidget() {
        val snapshot = WidgetSnapshot(1, listOf(muse, atlas))
        assertThat(WidgetContent.single(signedIn = false, snapshot, "atlas")).isEqualTo(WidgetContent.SignedOut)
        assertThat(WidgetContent.single(signedIn = true, null, "atlas")).isEqualTo(WidgetContent.Loading)
        assertThat(WidgetContent.single(signedIn = true, WidgetSnapshot(), "atlas")).isEqualTo(WidgetContent.NoSidekicks)
        assertThat(WidgetContent.single(signedIn = true, snapshot, "atlas")).isEqualTo(WidgetContent.One(atlas))
        // Not set, or that one's gone: the first.
        assertThat(WidgetContent.single(signedIn = true, snapshot, null)).isEqualTo(WidgetContent.One(muse))
        assertThat(WidgetContent.single(signedIn = true, snapshot, "deleted")).isEqualTo(WidgetContent.One(muse))
    }

    @Test fun theSidekicksWidgetShowsFourUnreadFirst() {
        val many = (1..6).map { WidgetSidekick("s$it", "S$it", sessionId = "chat-s$it", unread = it == 5) }
        val content = WidgetContent.several(signedIn = true, WidgetSnapshot(1, many)) as WidgetContent.Several
        assertThat(content.sidekicks.map { it.id }).containsExactly("s5", "s1", "s2", "s3").inOrder()
        assertThat(content.unread).isEqualTo(1)
        assertThat(WidgetContent.several(signedIn = false, WidgetSnapshot(1, many))).isEqualTo(WidgetContent.SignedOut)
    }

    @Test fun linksOpenTheChat() {
        assertThat(WidgetContent.chatLink(atlas)).isEqualTo("dex://app/chat/chat-atlas")
        assertThat(WidgetContent.chatLink(atlas, compose = true)).isEqualTo("dex://app/chat/chat-atlas?compose=1")
        assertThat(routesFor("dex://app/chat/chat-atlas?compose=1")).isEqualTo(listOf(ChatList, Chat("chat-atlas")))
        assertThat(composeTarget("dex://app/chat/chat-atlas?compose=1")).isEqualTo("chat-atlas")
        assertThat(composeTarget("dex://app/chat/chat-atlas")).isNull()
        assertThat(composeTarget("dex://app/machine/x?compose=1")).isNull()
    }

    @Test fun facesAreRound() {
        val face = Faces.round(Faces.decode(Faces.dataUrlBytes(atlas.image)), "sky", "A", 96)
        assertThat(face.width).isEqualTo(96)
        assertThat(face.height).isEqualTo(96)
        assertThat(Faces.dataUrlBytes("https://example.com/a.png")).isNull()
        assertThat(Faces.dataUrlBytes("data:image/png;base64,AAAA")).hasLength(3)
    }
}
