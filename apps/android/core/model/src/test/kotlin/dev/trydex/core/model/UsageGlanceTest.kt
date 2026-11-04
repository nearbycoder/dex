package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** The usage meter in the Chats bar and on Settings (usageGlance). */
class UsageGlanceTest {
    @Test fun theBusiestMeter() {
        val glance = DexJson.decodeFromString(
            UsageGlance.serializer(),
            """{"meters":[{"provider":"opencode-go","service":"OpenCode Go","window":"5 hours","percent":42.4,"limited":false,"resetsAt":"2026-11-04T12:00:00.000Z","detail":null,"estimated":false},
              |{"provider":"someday","service":"Someday","window":"Week","percent":3,"limited":false,"resetsAt":null,"detail":"$1 of $30","estimated":true,"extra":1}],
              |"today":{"tokens":1234567,"responses":42}}""".trimMargin(),
        )
        val top = glance.top!!
        assertThat(top.provider).isEqualTo("opencode-go")
        assertThat(top.full).isFalse()
        assertThat(glance.meters[1].provider).isEqualTo("someday")
        assertThat(glance.summary).isEqualTo("OpenCode Go · 5 hours · 42%")
        assertThat(glance.spoken).isEqualTo("OpenCode Go 5 hours 42% used")
        assertThat(glance.today.responses).isEqualTo(42.0)
    }

    @Test fun overAndAtTheLimit() {
        val estimate = UsageMeter("commandcode", "Command Code", "5 hours", percent = 131.0, estimated = true)
        assertThat(estimate.full).isTrue()
        assertThat(estimate.label).isEqualTo("100%")
        val blocked = UsageMeter("openrouter", "OpenRouter", "Free requests today", percent = 100.0, limited = true)
        assertThat(blocked.label).isEqualTo("Limit")
        assertThat(UsageGlance(listOf(blocked)).summary).isEqualTo("OpenRouter · Free requests today · limit reached")
        assertThat(UsageMeter(percent = 0.4).label).isEqualTo("<1%")
        assertThat(UsageMeter(percent = 0.0).label).isEqualTo("0%")
    }

    @Test fun noAllowancesShowsTodaysTokens() {
        val glance = DexJson.decodeFromString(UsageGlance.serializer(), """{"meters":[],"today":{"tokens":1200000,"responses":12}}""")
        assertThat(glance.top).isNull()
        assertThat(glance.summary).isEqualTo("1.2M tokens today")
        assertThat(DexJson.decodeFromString(UsageGlance.serializer(), "{}").summary).isEqualTo("0 tokens today")
    }
}
