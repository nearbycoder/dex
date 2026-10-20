package dev.trydex.android.ui.misc

import com.google.common.truth.Truth.assertThat
import dev.trydex.android.ui.files.previewKind
import dev.trydex.android.ui.files.workspacePath
import dev.trydex.android.ui.openui.DexFunctions
import dev.trydex.android.ui.settings.mcpConfig
import dev.trydex.android.ui.settings.secretName
import dev.trydex.android.ui.machine.desktopAddress
import dev.trydex.android.ui.nav.Access
import dev.trydex.android.ui.nav.Chat
import dev.trydex.android.ui.nav.ChatList
import dev.trydex.android.ui.nav.NotificationSettings
import dev.trydex.android.ui.nav.SettingsHome
import dev.trydex.android.ui.nav.routesFor
import dev.trydex.core.client.DexSession
import dev.trydex.core.client.DexUser
import org.junit.Test

class HelpersTest {
    @Test fun dexFunctions() {
        val now = 1_760_000_000_000
        assertThat(DexFunctions.ago(now - 5 * 60_000.0, now)).isEqualTo("5 min. ago")
        assertThat(DexFunctions.ago("not a time", now)).isEmpty()
        assertThat(DexFunctions.millis("2026-10-19T17:08:00Z")).isEqualTo(1_792_429_680_000)
        assertThat(DexFunctions.millis("2024-01-15")).isEqualTo(1_705_276_800_000)
        assertThat(DexFunctions.bytes(512.0)).isEqualTo("512 B")
        assertThat(DexFunctions.bytes(35_021.0)).isEqualTo("34.2 KB")
    }

    @Test fun workspacePaths() {
        assertThat(workspacePath("notes.md")).isEqualTo("/workspace/notes.md")
        assertThat(workspacePath("/workspace/a.md")).isEqualTo("/workspace/a.md")
        assertThat(previewKind("/workspace/README.MD")).isEqualTo("markdown")
        assertThat(previewKind("site/index.htm")).isEqualTo("html")
        assertThat(previewKind("data.json")).isNull()
    }

    @Test fun secretsAndTokens() {
        assertThat(secretName("my-api key")).isEqualTo("MY_API_KEY")
        assertThat(mcpConfig("https://dex.example/api/mcp", "dexk.x")).contains("\"Authorization\": \"Bearer dexk.x\"")
    }

    @Test fun desktopUrls() {
        val session = DexSession("https://dex.example/", "t", DexUser("u", "u"), 0)
        assertThat(desktopAddress("/vm-desktop/chat-1/", session, watch = true)).isEqualTo("https://dex.example/vm-desktop/chat-1/?view=watch")
        assertThat(desktopAddress("/vm-desktop/chat-1/", session, watch = false)).isEqualTo("https://dex.example/vm-desktop/chat-1/")
        assertThat(desktopAddress("https://sb.boat.dev/desktop?t=1", session, watch = true)).isEqualTo("https://sb.boat.dev/desktop?t=1")
    }

    @Test fun deepLinks() {
        assertThat(routesFor("dex://app/chat/abc")).containsExactly(ChatList, Chat("abc")).inOrder()
        assertThat(routesFor("dex://app/access")).containsExactly(SettingsHome, Access).inOrder()
        assertThat(routesFor("dex://app/notifications")).containsExactly(SettingsHome, NotificationSettings).inOrder()
        assertThat(routesFor("dex://app/nope")).isNull()
    }
}
