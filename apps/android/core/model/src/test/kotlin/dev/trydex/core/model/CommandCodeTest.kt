package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Command Code, the fourth subscription: its status in state, its slashed model ids, and its live-only models. */
class CommandCodeTest {
    private val deepseek = DexModel(
        "commandcode/deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash", "commandcode", "DeepSeek V4.1 Flash", "deepseek",
        contextWindow = 1_000_000,
    )
    private val devstral = DexModel("commandcode/mistralai/devstral-3", "mistralai/devstral-3", "commandcode", "Devstral 3", "commandcode")

    @Test fun olderAgentsLeaveItOutAndItReadsDisconnected() {
        val state = DexJson.decodeFromString(DexState.serializer(), """{"cline":{"connected":false},"opencode":{"connected":false},"chatgpt":{"connected":false}}""")
        assertThat(state.commandcode).isEqualTo(ProviderStatus())
        assertThat(state.connectedProviders).containsEntry(ModelProvider.CommandCode, false)
        assertThat(state.anyProviderConnected).isFalse()
    }

    @Test fun aConnectedKeyIsASubscription() {
        val state = DexJson.decodeFromString(
            DexState.serializer(),
            """{"commandcode":{"connected":true,"source":"user","keyHint":"cc_a…9f2b","verifiedAt":1700000000000}}""",
        )
        assertThat(state.commandcode.keyHint).isEqualTo("cc_a…9f2b")
        assertThat(state.connectedProviders.filterValues { it }.keys).containsExactly(ModelProvider.CommandCode)
        assertThat(state.anyProviderConnected).isTrue()
        assertThat(ModelProvider.CommandCode.displayName).isEqualTo("Command Code")
        assertThat(ModelProvider.CommandCode.short).isEqualTo("Command")
        assertThat(ModelProvider.entries.last()).isEqualTo(ModelProvider.CommandCode)
    }

    @Test fun slashedIdsGoByTheirPrefix() {
        val builtIn = ModelRegistry()
        assertThat(builtIn.of(ModelProvider.CommandCode)).isEmpty()
        assertThat(builtIn.providerOf("commandcode/deepseek/deepseek-v4.1-flash")).isEqualTo(ModelProvider.CommandCode)
        assertThat(builtIn.providerOf("commandcode/claude-haiku-5-5")).isEqualTo(ModelProvider.CommandCode)
        // Not a prefix match: no slash after the provider id.
        assertThat(builtIn.providerOf("commandcodex/deepseek")).isEqualTo(ModelProvider.ClinePass)
    }

    @Test fun theCatalogKeepsItsModelsAndItsMaker() {
        val registry = ModelRegistry()
        val unknownMaker = deepseek.copy(id = "commandcode/acme/one", maker = "acme")
        val catalog = ModelCatalog("v2", updatedAt = 10, models = BuiltInModels.list + listOf(deepseek, devstral, unknownMaker))
        assertThat(registry.install(catalog)).isTrue()
        assertThat(registry.of(ModelProvider.CommandCode).map { it.id }).containsExactly(deepseek.id, devstral.id).inOrder()
        assertThat(registry.find(devstral.id)!!.modelMaker).isEqualTo(ModelMaker.CommandCode)
        assertThat(ModelMaker.CommandCode.displayName).isEqualTo("Command Code")
        assertThat(registry.providerOf(deepseek.id)).isEqualTo(ModelProvider.CommandCode)
        // A chat on Command Code keeps its model while the key is connected, and moves to a connected subscription when not.
        val onlyCommandCode = ModelProvider.entries.associateWith { it == ModelProvider.CommandCode }
        assertThat(registry.usableModel(deepseek.id, onlyCommandCode)).isEqualTo(deepseek.id)
        assertThat(registry.usableModel(DEFAULT_MODEL_ID, onlyCommandCode)).isEqualTo(deepseek.id)
        val onlyCline = ModelProvider.entries.associateWith { it == ModelProvider.ClinePass }
        assertThat(registry.usableModel(deepseek.id, onlyCline)).isEqualTo(registry.of(ModelProvider.ClinePass).first().id)
    }
}
