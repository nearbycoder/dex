package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Release dates in the catalog, the "other" maker, and the Newest menu's sections and filter. */
class ModelReleasesTest {
    private val now = java.time.Instant.parse("2026-11-03T15:00:00Z").toEpochMilli()

    private fun model(id: String, releasedAt: String?, provider: String = "clinepass") = DexModel(id, provider = provider, maker = "zai", releasedAt = releasedAt)

    @Test fun catalogCarriesReleaseDatesAndStealthModels() {
        val json = """
            {"version":"v","updatedAt":5,"models":[
              {"id":"cline-pass/crouton-alpha","provider":"clinepass","name":"Crouton Alpha","maker":"other","releasedAt":"2026-11-01"},
              {"id":"cline-pass/glm-5.3","provider":"clinepass","name":"GLM 5.3","maker":"zai"},
              {"id":"cline-pass/future","provider":"clinepass","name":"Future","maker":"someone-new","releasedAt":"2026-11-02"}
            ]}
        """.trimIndent()
        val catalog = DexJson.decodeFromString(ModelCatalog.serializer(), json)
        assertThat(catalog.models.map { it.releasedAt }).containsExactly("2026-11-01", null, "2026-11-02").inOrder()
        val registry = ModelRegistry()
        assertThat(registry.install(catalog)).isTrue()
        // "other" is a maker this build knows; one it doesn't is still left out.
        assertThat(registry.models.map { it.id }).containsExactly("cline-pass/crouton-alpha", "cline-pass/glm-5.3").inOrder()
        assertThat(registry.find("cline-pass/crouton-alpha")!!.modelMaker).isEqualTo(ModelMaker.Other)
        assertThat(isNewModel(registry.find("cline-pass/crouton-alpha")!!, now)).isTrue()
    }

    @Test fun newestFirstInSections() {
        val models = listOf(
            model("a", "2026-06-01"),
            model("b", null),
            model("c", "2026-11-02", provider = "opencode-go"),
            model("d", "2026-11-02"),
            model("e", "2026-10-20"),
            model("f", "2026-09-01"),
        )
        val connected = mapOf(ModelProvider.ClinePass to true, ModelProvider.OpenCodeGo to false)
        val sections = newestFirst(models, connected, now)
        assertThat(sections.map { (period, list) -> period to list.map { it.id } }).containsExactly(
            // Same day: the connected subscription's first.
            ReleasePeriod.Week to listOf("d", "c"),
            ReleasePeriod.Month to listOf("e"),
            ReleasePeriod.Quarter to listOf("f"),
            ReleasePeriod.Earlier to listOf("a"),
            ReleasePeriod.Unknown to listOf("b"),
        ).inOrder()
    }

    @Test fun releasedWithin() {
        val week = model("w", "2026-10-28")
        val unknown = model("u", null)
        assertThat(ReleasedWithin.AnyTime.includes(unknown, now)).isTrue()
        assertThat(ReleasedWithin.Week.includes(week, now)).isTrue()
        assertThat(ReleasedWithin.Week.includes(model("old", "2026-10-20"), now)).isFalse()
        assertThat(ReleasedWithin.Quarter.includes(unknown, now)).isFalse()
    }
}
