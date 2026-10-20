package dev.trydex.core.model

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** The MCP editor's draft and the registry search's add buttons (apps/web/src/routes/_app.mcp.$serverId.tsx, mcp-registry-search.tsx). */
object McpForms {
    val AUTHS = listOf("none", "headers", "oauth")
    private val HEADER = Regex("^[\\w-]{1,64}$")
    private val ENV = Regex("^[A-Za-z0-9_,]{1,2000}$")

    /** What a new server is prefilled with, each value checked the way the web checks its search params. */
    data class Prefill(
        val template: Catalogs.McpTemplate? = null,
        val name: String? = null,
        val url: String? = null,
        val auth: String? = null,
        val header: String? = null,
        val command: String? = null,
        val env: String? = null,
    )

    fun prefill(template: String?, name: String?, url: String?, auth: String?, header: String?, command: String?, env: String?) = Prefill(
        template = Catalogs.MCP_TEMPLATES.firstOrNull { it.id == template },
        name = name?.take(60),
        url = url?.takeIf { it.startsWith("https://") },
        auth = auth?.takeIf { it in AUTHS },
        header = header?.takeIf { HEADER.matches(it) },
        command = command?.takeIf { it.length <= 2000 && '\r' !in it && '\n' !in it },
        env = env?.takeIf { ENV.matches(it) },
    )

    /** A header or environment variable; [saved] ones keep their stored value when left empty. */
    data class Entry(val name: String, val value: String = "", val saved: Boolean = false)

    data class Draft(
        val id: String? = null,
        val name: String = "",
        val url: String = "",
        val transport: String = "auto",
        val auth: String = "none",
        val defaultOn: Boolean = false,
        val headers: List<Entry> = emptyList(),
        val local: Boolean = false,
        val command: String = "",
        val env: List<Entry> = emptyList(),
    ) {
        /** Local servers need a command and remote ones a URL (the web checks the URL for both, a bug). */
        val canSave: Boolean get() = name.isNotBlank() && if (local) command.isNotBlank() else url.isNotBlank()
    }

    fun draft(server: McpServerInfo) = Draft(
        id = server.id,
        name = server.name,
        url = server.url,
        transport = server.transport,
        auth = server.auth,
        defaultOn = server.defaultOn,
        headers = server.headerNames.map { Entry(it, saved = true) },
        local = server.local != null,
        command = server.local?.command.orEmpty(),
        env = server.local?.envNames.orEmpty().map { Entry(it, saved = true) },
    )

    fun newDraft(prefill: Prefill) = Draft(
        name = prefill.template?.name ?: prefill.name ?: "",
        url = prefill.template?.url ?: prefill.url ?: "",
        auth = prefill.template?.auth ?: prefill.auth ?: "none",
        headers = listOf(Entry(prefill.template?.headerName ?: prefill.header ?: "Authorization")),
        local = prefill.command != null,
        command = prefill.command.orEmpty(),
        env = prefill.env?.split(",")?.filter { it.isNotEmpty() }?.map { Entry(it) }.orEmpty(),
    )

    /** The `saveMcpServer` argument (McpServerDraft). */
    fun payload(draft: Draft): JsonObject = buildJsonObject {
        draft.id?.let { put("id", it) }
        put("name", draft.name)
        put("defaultOn", draft.defaultOn)
        if (draft.local) {
            put("url", "")
            put("transport", "auto")
            put("auth", "none")
            putJsonArray("headers") {}
            putJsonObject("local") {
                put("command", draft.command)
                putJsonArray("env") { draft.env.forEach { add(entry(it)) } }
            }
        } else {
            put("url", draft.url)
            put("transport", draft.transport)
            put("auth", draft.auth)
            putJsonArray("headers") { draft.headers.forEach { add(entry(it)) } }
        }
    }

    private fun entry(entry: Entry) = buildJsonObject {
        put("name", entry.name)
        put("value", entry.value)
    }

    /** The save button: "Connecting…", "Save and sign in", "Add and connect", or "Save". */
    fun submitLabel(draft: Draft, isNew: Boolean, existing: McpStatus?, saving: Boolean): String = when {
        saving -> "Connecting…"
        !draft.local && draft.auth == "oauth" && (isNew || existing != McpStatus.Ready) -> "Save and sign in"
        isNew -> "Add and connect"
        else -> "Save"
    }

    /** A registry result, as its row shows it once (maybe) checked. */
    data class RegistryView(val needsKey: Boolean, val failed: Boolean, val url: String, val added: Boolean, val auth: String, val header: String?)

    fun registryView(server: RegistryServer, report: McpCheckReport?, addedUrls: Set<String>): RegistryView {
        val needsKey = server.headers.any { it.required } || (server.run?.env?.any { it.required && it.secret } ?: false)
        val url = report?.url?.takeIf { it.isNotEmpty() } ?: server.url
        return RegistryView(
            needsKey = needsKey,
            failed = report?.checks?.any { it.status == "fail" } ?: false,
            url = url,
            added = url.isNotEmpty() && url.removeSuffix("/") in addedUrls,
            auth = report?.auth ?: if (needsKey) "headers" else "none",
            header = report?.header ?: server.headers.firstOrNull { it.required }?.name,
        )
    }

    /** The URLs already added, without a trailing slash, to mark registry results. */
    fun addedUrls(servers: List<McpServerInfo>): Set<String> = servers.map { it.url.removeSuffix("/") }.toSet()
}
