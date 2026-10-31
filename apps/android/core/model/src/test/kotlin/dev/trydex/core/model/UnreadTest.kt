package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Unread chats, sidekicks' notification settings, push devices, scheduled notes, and the widgets' snapshot. */
class UnreadTest {
    @Test fun sessionsReadUnreadAndTheirLatestReply() {
        val session = DexJson.decodeFromString(
            SessionMeta.serializer(),
            """{"id":"s1","unread":true,"lastReply":"Done: 3 issues.","repliedAt":1700000000000,"future":1}""",
        )
        assertThat(session.unread).isTrue()
        assertThat(session.lastReply).isEqualTo("Done: 3 issues.")
        assertThat(session.repliedAt).isEqualTo(1_700_000_000_000)
    }

    @Test fun olderAgentsLeaveThemOut() {
        val session = DexJson.decodeFromString(SessionMeta.serializer(), """{"id":"s1","lastReply":null,"repliedAt":null}""")
        assertThat(session.unread).isFalse()
        assertThat(session.lastReply).isNull()
        assertThat(session.repliedAt).isNull()
        val state = DexJson.decodeFromString(DexState.serializer(), """{"push":{"configured":true,"devices":[{"id":"d1","kinds":["reply"]}]}}""")
        assertThat(state.push.native).isEqualTo(NativePush(ios = false, android = false))
        assertThat(state.push.devices.single().platform).isEqualTo("web")
    }

    @Test fun pushStatusSaysWhichAppsItCanReach() {
        val status = DexJson.decodeFromString(
            PushStatus.serializer(),
            """{"configured":false,"publicKey":null,"devices":[{"id":"a1","platform":"android","label":"Pixel 9 · Android app","kinds":["sidekick","reply"],"onlyWhenAway":false}],"native":{"ios":true,"android":true}}""",
        )
        assertThat(status.native.android).isTrue()
        assertThat(status.devices.single().platform).isEqualTo("android")
        assertThat(status.devices.single().kinds).containsExactly("sidekick", "reply").inOrder()
        assertThat(status.devices.single().onlyWhenAway).isFalse()
    }

    @Test fun sidekicksSayWhichMessagesNotify() {
        fun level(json: String) = DexJson.decodeFromString(CharacterProfile.serializer(), json).notifyLevel
        assertThat(level("""{"id":"c"}""")).isEqualTo(SidekickNotify.All)
        assertThat(level("""{"id":"c","notify":"reachouts"}""")).isEqualTo(SidekickNotify.Reachouts)
        assertThat(level("""{"id":"c","notify":"off"}""")).isEqualTo(SidekickNotify.Off)
        // A level from a newer agent reads as every message.
        assertThat(level("""{"id":"c","notify":"weekends"}""")).isEqualTo(SidekickNotify.All)
        assertThat(SidekickNotify.entries.map { it.label }).containsExactly("Every message", "When they reach out", "Off").inOrder()
    }

    @Test fun sidekicksAreTheFirstKind() {
        assertThat(Catalogs.NOTIFY_KINDS.first().id).isEqualTo("sidekick")
        assertThat(Catalogs.NOTIFY_KINDS.first().label).isEqualTo("Sidekicks")
        assertThat(Catalogs.NOTIFY_KINDS).hasSize(7)
    }

    @Test fun scheduledPromptsAreNotes() {
        assertThat(ScheduledNote.of("[Scheduled task] Check in about the release notes")).isEqualTo("Check in about the release notes")
        assertThat(ScheduledNote.of("Check in about the release notes")).isNull()
        assertThat(ScheduledNote.of("[Scheduled task]Missing space")).isNull()
        assertThat(ScheduledNote.of("I said [Scheduled task] mid-sentence")).isNull()
        assertThat(ScheduledNote.of(null)).isNull()
    }

    @Test fun unreadCountsEveryChat() {
        val state = DexState(sessions = listOf(SessionMeta("a", unread = true), SessionMeta("b"), SessionMeta("c", unread = true, muted = true)))
        assertThat(state.unreadCount).isEqualTo(2)
    }

    @Test fun widgetSnapshotFromTheSyncedState() {
        val state = DexState(
            sessions = listOf(
                SessionMeta("chat-atlas", characterId = "atlas", unread = true, lastReply = "Morning!", repliedAt = 5),
                SessionMeta("chat-muse", characterId = "muse", busy = true),
                SessionMeta("chat-other", unread = true),
            ),
            characters = listOf(
                CharacterProfile("atlas", name = "Atlas", tagline = "Keeps your life organized", color = "sky", image = "data:image/png;base64,AAAA", sessionId = "chat-atlas"),
                CharacterProfile("muse", name = "Muse", avatar = "🎨", sessionId = "chat-muse"),
                CharacterProfile("gone", name = "Gone", sessionId = "chat-missing"),
            ),
        )
        val snapshot = WidgetSnapshot.from(state)
        assertThat(snapshot.unread).isEqualTo(2)
        val (atlas, muse, gone) = snapshot.sidekicks
        assertThat(atlas).isEqualTo(
            WidgetSidekick("atlas", "Atlas", "Keeps your life organized", "sky", "data:image/png;base64,AAAA", "", "chat-atlas", unread = true, busy = false, lastReply = "Morning!", repliedAt = 5),
        )
        assertThat(atlas.line).isEqualTo("Morning!")
        assertThat(muse.line).isEqualTo("typing…")
        assertThat(muse.face).isEqualTo("🎨")
        assertThat(gone.unread).isFalse()
        assertThat(gone.line).isEqualTo("Say hi")
        assertThat(gone.face).isEqualTo("G")
    }

    @Test fun widgetSnapshotFromTheServer() {
        val snapshot = DexJson.decodeFromString(
            WidgetSnapshot.serializer(),
            """{"unread":1,"sidekicks":[{"id":"atlas","name":"Atlas","tagline":"Organized","color":"sky","avatar":"","sessionId":"chat-atlas","unread":true,"busy":false,"lastReply":"Line one\n  line two","repliedAt":9}]}""",
        )
        val atlas = snapshot.sidekick("atlas")!!
        assertThat(atlas.image).isNull()
        assertThat(atlas.line).isEqualTo("Line one line two")
        assertThat(snapshot.sidekick("nobody")).isNull()
    }
}
