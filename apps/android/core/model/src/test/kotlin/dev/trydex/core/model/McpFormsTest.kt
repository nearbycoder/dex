package dev.trydex.core.model

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Test

class McpFormsTest {
    @Test fun prefillDropsWhatTheWebRejects() {
        val ok = McpForms.prefill("github", "x".repeat(80), "https://a.dev/mcp", "oauth", "X-Api-Key", "npx -y pkg", "API_KEY,TOKEN")
        assertThat(ok.template?.id).isEqualTo("github")
        assertThat(ok.name).hasLength(60)
        assertThat(ok.url).isEqualTo("https://a.dev/mcp")
        assertThat(ok.auth).isEqualTo("oauth")
        assertThat(ok.header).isEqualTo("X-Api-Key")
        assertThat(ok.command).isEqualTo("npx -y pkg")
        assertThat(ok.env).isEqualTo("API_KEY,TOKEN")

        val bad = McpForms.prefill("nope", null, "http://a.dev/mcp", "basic", "Bad Header", "a\nb", "A-B")
        assertThat(bad).isEqualTo(McpForms.Prefill())
    }

    @Test fun newDraftFromTemplateAndPackage() {
        val template = McpForms.newDraft(McpForms.prefill("github", null, null, null, null, null, null))
        assertThat(template.name).isEqualTo("GitHub")
        assertThat(template.auth).isEqualTo("headers")
        assertThat(template.headers).containsExactly(McpForms.Entry("Authorization"))
        assertThat(template.local).isFalse()

        val pkg = McpForms.newDraft(McpForms.prefill(null, "Everything", null, null, null, "npx -y everything", "API_KEY,,TOKEN"))
        assertThat(pkg.local).isTrue()
        assertThat(pkg.env.map { it.name }).containsExactly("API_KEY", "TOKEN").inOrder()
        assertThat(pkg.canSave).isTrue()
        // A local server needs no URL, a remote one does.
        assertThat(pkg.copy(local = false).canSave).isFalse()
    }

    @Test fun payloadForLocalAndRemote() {
        val server = McpServerInfo("everything", "Everything", local = McpLocal("npx -y everything", listOf("API_KEY")))
        val local = McpForms.payload(McpForms.draft(server))
        assertThat(local["id"].str).isEqualTo("everything")
        assertThat(local["url"].str).isEqualTo("")
        assertThat(local["auth"].str).isEqualTo("none")
        assertThat((local["headers"] as JsonArray)).isEmpty()
        val env = ((local["local"] as JsonObject)["env"] as JsonArray).single() as JsonObject
        assertThat(env["name"].str).isEqualTo("API_KEY")
        assertThat(env["value"].str).isEqualTo("")

        val remote = McpForms.payload(McpForms.Draft(name = "X", url = "https://x.dev/mcp", auth = "headers", headers = listOf(McpForms.Entry("Authorization", "Bearer k"))))
        assertThat(remote.containsKey("id")).isFalse()
        assertThat(remote.containsKey("local")).isFalse()
        assertThat(((remote["headers"] as JsonArray).single() as JsonObject)["value"].str).isEqualTo("Bearer k")
    }

    @Test fun submitLabels() {
        val oauth = McpForms.Draft(name = "Linear", url = "https://mcp.linear.app/mcp", auth = "oauth")
        assertThat(McpForms.submitLabel(oauth, isNew = true, existing = null, saving = true)).isEqualTo("Connecting…")
        assertThat(McpForms.submitLabel(oauth, isNew = false, existing = McpStatus.Authenticating, saving = false)).isEqualTo("Save and sign in")
        assertThat(McpForms.submitLabel(oauth, isNew = false, existing = McpStatus.Ready, saving = false)).isEqualTo("Save")
        assertThat(McpForms.submitLabel(oauth.copy(auth = "none"), isNew = true, existing = null, saving = false)).isEqualTo("Add and connect")
    }

    @Test fun registryView() {
        val server = RegistryServer(name = "@x/exa", title = "Exa", url = "", headers = listOf(RegistryHeader("Authorization", required = true, secret = true)))
        val unchecked = McpForms.registryView(server, null, emptySet())
        assertThat(unchecked.needsKey).isTrue()
        assertThat(unchecked.auth).isEqualTo("headers")
        assertThat(unchecked.header).isEqualTo("Authorization")
        assertThat(unchecked.added).isFalse()

        val report = McpCheckReport("https://mcp.exa.ai/mcp/", listOf(McpCheck("reachable", status = "fail")), auth = "oauth")
        val checked = McpForms.registryView(server, report, McpForms.addedUrls(listOf(McpServerInfo("exa", url = "https://mcp.exa.ai/mcp"))))
        assertThat(checked.url).isEqualTo("https://mcp.exa.ai/mcp/")
        assertThat(checked.added).isTrue()
        assertThat(checked.failed).isTrue()
        assertThat(checked.auth).isEqualTo("oauth")
    }
}
