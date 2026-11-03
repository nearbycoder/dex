package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** OpenRouter in the usage report: its tokens and the key's live numbers, all missing from an older agent's report. */
class OpenRouterUsageTest {
    @Test fun olderAgentsLeaveItOut() {
        val report = DexJson.decodeFromString(UsageReport.serializer(), """{"range":"month","daily":[{"date":"2026-11-02","cline":1.5}]}""")
        assertThat(report.openrouter).isNull()
        assertThat(report.daily.single().openrouter).isEqualTo(0.0)
        assertThat(report.daily.single().value("openrouter")).isEqualTo(0.0)
    }

    @Test fun theKeysNumbers() {
        val report = DexJson.decodeFromString(
            UsageReport.serializer(),
            """{"openrouter":{"responses":3,"totalTokens":1200,"listCost":0,"byModel":[],"byChat":[],"connected":true,
              |"account":{"freeRequests":{"used":12,"limit":1000},"spent":{"day":0,"week":0.04,"month":0.04,"total":1.37},"keyLimit":null,"credits":{"total":10,"used":1.37}},
              |"accountError":null},"daily":[{"date":"2026-11-02","openrouter":0.04}]}""".trimMargin(),
        )
        val usage = report.openrouter!!
        assertThat(usage.connected).isTrue()
        val account = usage.account!!
        assertThat(account.freeRequests).isEqualTo(OpenRouterAccount.FreeRequests(12.0, 1000.0))
        assertThat(account.spent.week).isEqualTo(0.04)
        assertThat(account.keyLimit).isNull()
        assertThat(account.credits!!.total).isEqualTo(10.0)
        assertThat(report.daily.single().value("openrouter")).isEqualTo(0.04)
        assertThat(UsageFormat.freeRequests(account.freeRequests!!)).isEqualTo("12 of 1,000")
        assertThat(UsageFormat.share(12.0, 1000.0)).isWithin(1e-9).of(1.2)
    }

    @Test fun anUnreadableAccount() {
        val report = DexJson.decodeFromString(
            UsageReport.serializer(),
            """{"openrouter":{"connected":true,"account":null,"accountError":"OpenRouter no longer accepts this key."}}""",
        )
        assertThat(report.openrouter!!.account).isNull()
        assertThat(report.openrouter!!.accountError).isEqualTo("OpenRouter no longer accepts this key.")
    }

    @Test fun formatting() {
        assertThat(UsageFormat.count(0.0)).isEqualTo("0")
        assertThat(UsageFormat.count(50.0)).isEqualTo("50")
        assertThat(UsageFormat.count(1_234_567.0)).isEqualTo("1,234,567")
        // No limit to measure against reads as nothing used, not NaN.
        assertThat(UsageFormat.share(3.0, 0.0)).isEqualTo(0.0)
        assertThat(UsageFormat.series("openrouter").color).isEqualTo(0xFF1FA3B5)
        assertThat(UsageFormat.series("openrouter").label).isEqualTo("OpenRouter")
    }
}
