package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** OpenRouter, the fifth subscription: its status in state, its slashed model ids, and its free models from the live catalog. */
class OpenRouterTest {
    private val crouton = DexModel(
        "openrouter/stealth/crouton-alpha", "stealth/crouton-alpha", "openrouter", "Crouton Alpha", "other",
        contextWindow = 1_000_000, releasedAt = "2026-11-02",
    )
    private val nemotron = DexModel(
        "openrouter/nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3.5-lightning:free", "openrouter", "Nemotron 3.5 Lightning", "other",
        contextWindow = 256_000,
    )

    @Test fun olderAgentsLeaveItOutAndItReadsDisconnected() {
        val state = DexJson.decodeFromString(
            DexState.serializer(),
            """{"cline":{"connected":false},"opencode":{"connected":false},"chatgpt":{"connected":false},"commandcode":{"connected":false}}""",
        )
        assertThat(state.openrouter).isEqualTo(ProviderStatus())
        assertThat(state.connectedProviders).containsEntry(ModelProvider.OpenRouter, false)
        assertThat(state.anyProviderConnected).isFalse()
    }

    @Test fun aConnectedKeyIsASubscription() {
        val state = DexJson.decodeFromString(
            DexState.serializer(),
            """{"openrouter":{"connected":true,"source":"user","keyHint":"sk-o…3f9a","verifiedAt":1700000000000}}""",
        )
        assertThat(state.openrouter.keyHint).isEqualTo("sk-o…3f9a")
        assertThat(state.connectedProviders.filterValues { it }.keys).containsExactly(ModelProvider.OpenRouter)
        assertThat(state.anyProviderConnected).isTrue()
        assertThat(ModelProvider.fromId("openrouter")).isEqualTo(ModelProvider.OpenRouter)
        assertThat(ModelProvider.OpenRouter.displayName).isEqualTo("OpenRouter")
        assertThat(ModelProvider.OpenRouter.short).isEqualTo("OpenRouter")
        // Last, as on the web: a chat moves onto it only when nothing else is connected.
        assertThat(ModelProvider.entries.last()).isEqualTo(ModelProvider.OpenRouter)
    }

    @Test fun slashedIdsGoByTheirPrefix() {
        val builtIn = ModelRegistry()
        assertThat(builtIn.of(ModelProvider.OpenRouter)).isEmpty()
        assertThat(builtIn.providerOf(crouton.id)).isEqualTo(ModelProvider.OpenRouter)
        assertThat(builtIn.providerOf(nemotron.id)).isEqualTo(ModelProvider.OpenRouter)
        assertThat(builtIn.providerOf("openroutery/x")).isEqualTo(ModelProvider.ClinePass)
    }

    @Test fun theCatalogKeepsItsFreeModels() {
        val registry = ModelRegistry()
        val catalog = ModelCatalog("v2", updatedAt = 10, models = BuiltInModels.list + listOf(crouton, nemotron))
        assertThat(registry.install(catalog)).isTrue()
        assertThat(registry.of(ModelProvider.OpenRouter).map { it.id }).containsExactly(crouton.id, nemotron.id).inOrder()
        assertThat(registry.find(crouton.id)!!.free).isTrue()
        assertThat(registry.find(crouton.id)!!.modelMaker).isEqualTo(ModelMaker.Other)
        // Listed without a key: a chat moves off it until one is connected, and onto it when it's all there is.
        val noOpenRouter = ModelProvider.entries.associateWith { it == ModelProvider.ClinePass }
        assertThat(registry.usableModel(crouton.id, noOpenRouter)).isEqualTo(registry.of(ModelProvider.ClinePass).first().id)
        val onlyOpenRouter = ModelProvider.entries.associateWith { it == ModelProvider.OpenRouter }
        assertThat(registry.usableModel(crouton.id, onlyOpenRouter)).isEqualTo(crouton.id)
        assertThat(registry.usableModel(DEFAULT_MODEL_ID, onlyOpenRouter)).isEqualTo(crouton.id)
    }

    @Test fun aProviderThisBuildDoesntKnowIsLeftOut() {
        // How a build from before OpenRouter treats its models, and how this one will treat a sixth subscription's.
        val registry = ModelRegistry()
        val later = nemotron.copy(id = "somethingnew/x", provider = "somethingnew")
        assertThat(registry.install(ModelCatalog("v3", updatedAt = 10, models = BuiltInModels.list + listOf(crouton, later)))).isTrue()
        assertThat(registry.find(crouton.id)).isNotNull()
        assertThat(registry.find(later.id)).isNull()
    }
}
