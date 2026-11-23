package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import org.junit.Test

/** Characters in the synced state: additive fields read with defaults, and the helpers the chat list and editor use. */
class CharactersTest {
    @Test fun stateFromAnOlderAgentHasNoCharacters() {
        val state = DexJson.decodeFromString(DexState.serializer(), """{"sessions":[{"id":"s1","title":"Plan"}]}""")
        assertThat(state.characters).isEmpty()
        assertThat(state.sessions.single().characterId).isNull()
        assertThat(state.chats.map { it.id }).containsExactly("s1")
    }

    @Test fun charactersAndTheirConversationsDecode() {
        val state = DexJson.decodeFromString(
            DexState.serializer(),
            """
            {
              "characters": [
                {"id":"muse-1a2b3c","name":"Muse","tagline":"Your creative sparring partner","persona":"Playful","instructions":"Brainstorm",
                 "greeting":"Hey you.","avatar":"🎨","image":null,"color":"violet","model":"cline-pass/glm-5.3","thinking":"low",
                 "mcpServers":["github"],"sessionId":"s2","createdAt":1,"updatedAt":2,"futureField":true},
                {"id":"bob","name":"bob","sessionId":"s3"}
              ],
              "sessions": [
                {"id":"s1","title":"Plan","characterId":null},
                {"id":"s2","title":"Muse","characterId":"muse-1a2b3c","createdAt":10},
                {"id":"s4","title":"Muse","characterId":"muse-1a2b3c","createdAt":5},
                {"id":"s3","title":"bob","characterId":"bob"}
              ]
            }
            """.trimIndent(),
        )
        val muse = state.character("muse-1a2b3c")!!
        assertThat(muse.avatar).isEqualTo("🎨")
        assertThat(muse.face).isEqualTo("🎨")
        assertThat(muse.thinking).isEqualTo(ThinkingLevel.Low)
        assertThat(muse.mcpServers).containsExactly("github")
        assertThat(muse.image).isNull()
        // Left-out fields take the web's defaults; no emoji shows the initial.
        val bob = state.character("bob")!!
        assertThat(bob.color).isEqualTo("violet")
        assertThat(bob.image).isNull()
        assertThat(bob.face).isEqualTo("B")
        // Characters' conversations aren't in the chat list; theirs are newest first.
        assertThat(state.chats.map { it.id }).containsExactly("s1")
        assertThat(Characters.conversations(state, muse).map { it.id }).containsExactly("s2", "s4").inOrder()
        assertThat(state.character(null)).isNull()
    }

    @Test fun presetsAreBundled() {
        assertThat(Characters.PRESETS).hasSize(13)
        assertThat(Characters.PRESETS.map { it.key }).containsAtLeast("boop", "muse", "atlas", "sage", "rex")
        assertThat(Characters.PRESETS.all { it.color in Catalogs.AGENT_COLORS }).isTrue()
        assertThat(Characters.PRESETS.all { it.dataUrl.startsWith("data:image/png;base64,iVBORw0KGgo") }).isTrue()
        // Each is already clean, so a saved look matches its preset.
        assertThat(Characters.PRESETS.all { SidekickLooks.clean(it.look) == it.look }).isTrue()
    }

    @Test fun looksRoundTrip() {
        val json = """{"id":"a","name":"A","look":{"shape":"mug","custom":null,"skin":"pink","body":"blob","eyes":"round","mouth":"smile","extra":"none","blush":false,"finish":101}}"""
        val character = DexJson.decodeFromString(CharacterProfile.serializer(), json)
        assertThat(character.look!!.shape).isEqualTo("mug")
        assertThat(DexJson.decodeFromString(CharacterProfile.serializer(), DexJson.encodeToString(CharacterProfile.serializer(), character))).isEqualTo(character)
        // A shape a chat drew comes with its outline and eyes.
        val drawn = DexJson.decodeFromString(
            CharacterProfile.serializer(),
            """{"id":"b","look":{"shape":"custom","skin":"teal","custom":{"name":"Box","path":"M20 20 H80 V80 H20 Z","eyes":{"x":50,"y":46,"spacing":15,"scale":1}}}}""",
        ).look!!
        assertThat(SidekickLooks.clean(drawn).custom!!.eyes.spacing).isEqualTo(15.0)
        assertThat(SidekickLooks.name(drawn)).isEqualTo("Box")
        // Older looks have no shape: the one nearest their body.
        assertThat(SidekickLooks.clean(DexJson.decodeFromString(CharacterProfile.serializer(), """{"id":"c","look":{"body":"cat","skin":"mint"}}""").look!!).shape).isEqualTo("cat")
        assertThat(Characters.presetOf(character)).isNull()
        assertThat(Characters.presetOf(character.copy(look = Characters.preset("muse")!!.look))!!.key).isEqualTo("muse")
    }

    @Test fun shapesAreBundled() {
        assertThat(SidekickLooks.SHAPES).hasSize(17)
        for (shape in SidekickLooks.SHAPES) {
            for (part in listOf("body", "eyes", "fluffy-body", "fluffy-eyes")) {
                assertWithMessage("${shape.key} $part").that(SidekickLooks.layer(shape.key, part)?.take(4)).isEqualTo(listOf<Byte>(-119, 80, 78, 71))
            }
            assertThat(shape.eyes.top).isLessThan(shape.eyes.bottom)
        }
        for (skin in SidekickLooks.SKINS.keys) {
            assertWithMessage(skin).that(SidekickLooks.ramp(skin)?.size).isEqualTo(96 * 3)
        }
        assertThat(SidekickLooks.layer("teapot", "body")).isNull()
    }

    @Test fun lookIsOptional() {
        val json = """{"characters":[{"id":"a","name":"A","look":null},{"id":"b","name":"B","look":{"body":"cat","skin":"mint","eyes":"dot","mouth":"smile","extra":"none","blush":false,"tail":1}}]}"""
        val state = DexJson.decodeFromString(DexState.serializer(), json)
        assertThat(state.character("a")!!.look).isNull()
        assertThat(state.character("b")!!.look!!.body).isEqualTo("cat")
    }

    @Test fun initials() {
        assertThat(Characters.initial("  muse")).isEqualTo("M")
        assertThat(Characters.initial("")).isEqualTo("?")
        assertThat(Characters.initial("😀 smile")).isEqualTo("😀")
    }

    @Test fun templatesFillADraftWithTheirLookButKeepItsModel() {
        val draft = CharacterProfile("", model = "cline-pass/kimi-k3", thinking = ThinkingLevel.High, image = "data:image/png;base64,AA")
        val muse = Characters.TEMPLATES.first { it.key == "muse" }.applyTo(draft)
        assertThat(muse.name).isEqualTo("Muse")
        assertThat(muse.color).isEqualTo("violet")
        assertThat(muse.greeting).startsWith("Hey you.")
        assertThat(muse.model).isEqualTo("cline-pass/kimi-k3")
        assertThat(muse.thinking).isEqualTo(ThinkingLevel.High)
        assertThat(muse.look).isEqualTo(SidekickLooks.make("lightbulb", "pink"))
        assertThat(muse.image).startsWith("data:image/png;base64,iVBORw0KGgo")
        assertThat(Characters.presetOf(muse)!!.key).isEqualTo("muse")
        assertThat(Characters.TEMPLATES.map { it.name }).containsExactly("Muse", "Atlas", "Sage", "Rex").inOrder()
        assertThat(Characters.TEMPLATES.map { it.preset.color }.all { it in Catalogs.AGENT_COLORS }).isTrue()
    }
}
