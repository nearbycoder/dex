package dev.trydex.core.client

import dev.trydex.core.client.AgentConnection.Companion.LONG_TIMEOUT_MS
import dev.trydex.core.client.AgentConnection.Companion.VM_TIMEOUT_MS
import dev.trydex.core.client.AgentConnection.Companion.args
import dev.trydex.core.model.AgentProfile
import dev.trydex.core.model.ChatArtifact
import dev.trydex.core.model.ChatGPTSignInStart
import dev.trydex.core.model.CommandResult
import dev.trydex.core.model.ConnectResult
import dev.trydex.core.model.CreatedAccessToken
import dev.trydex.core.model.DexJson
import dev.trydex.core.model.DirectorySkill
import dev.trydex.core.model.GitHubAccess
import dev.trydex.core.model.GitHubRepo
import dev.trydex.core.model.McpCheckReport
import dev.trydex.core.model.McpConnectResult
import dev.trydex.core.model.ModelCatalog
import dev.trydex.core.model.ModelRefresh
import dev.trydex.core.model.ProjectImageCandidate
import dev.trydex.core.model.ProjectProfile
import dev.trydex.core.model.ChatAttachment
import dev.trydex.core.model.QueuedMessage
import dev.trydex.core.model.RegistryServer
import dev.trydex.core.model.SavedArtifact
import dev.trydex.core.model.ScheduledPrompt
import dev.trydex.core.model.SessionMeta
import dev.trydex.core.model.SkillDetail
import dev.trydex.core.model.SkillPreview
import dev.trydex.core.model.ThinkingLevel
import dev.trydex.core.model.TranscriptImage
import dev.trydex.core.model.UiOperationResult
import dev.trydex.core.model.UsageReport
import dev.trydex.core.model.VmActivity
import dev.trydex.core.model.VmInfo
import dev.trydex.core.model.VmRunResult
import dev.trydex.core.model.WorkspaceFile
import dev.trydex.core.model.WorkspaceFileContent
import dev.trydex.core.model.str
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** What the app calls on the agent (an RPC transport, so tests can stand in a fake). */
fun interface AgentRpc {
    suspend fun call(method: String, args: List<JsonElement>, timeoutMs: Long): JsonElement?
}

fun AgentConnection.asRpc() = AgentRpc { method, args, timeout -> call(method, args, timeout) }

@Serializable
data class QueueSnapshot(val items: List<QueuedMessage> = emptyList(), val held: Boolean = false)

/** Every `@callable()` on DexAgent the app uses, typed (apps/web/src/agent/dex-agent.ts). */
class DexApi(private val rpc: AgentRpc) {
    private suspend fun raw(method: String, vararg values: Any?, timeout: Long = AgentConnection.DEFAULT_TIMEOUT_MS): JsonElement? =
        rpc.call(method, args(*values), timeout)

    private suspend fun <T> typed(serializer: KSerializer<T>, method: String, vararg values: Any?, timeout: Long = AgentConnection.DEFAULT_TIMEOUT_MS): T =
        DexJson.decodeFromJsonElement(serializer, raw(method, *values, timeout = timeout) ?: JsonNull)

    private suspend fun <T> nullable(serializer: KSerializer<T>, method: String, vararg values: Any?): T? {
        val result = raw(method, *values)
        return if (result == null || result is JsonNull) null else DexJson.decodeFromJsonElement(serializer, result)
    }

    // ── Chats ────────────────────────────────────────────────────────────────

    suspend fun createSession(
        model: String?, thinking: ThinkingLevel?, agentId: String?, mcpServers: List<String>?, projectId: String?, title: String? = null,
    ): SessionMeta = typed(SessionMeta.serializer(), "createSession", buildJsonObject {
        model?.let { put("model", it) }
        thinking?.let { put("thinking", it.id) }
        title?.let { put("title", it) }
        put("agentId", agentId)
        mcpServers?.let { ids -> putJsonArray("mcpServers") { ids.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } } }
        put("projectId", projectId)
    })

    /** `attachments` as `/api/attachments` returned them (DexUploads); left out when there are none, as the web does. */
    suspend fun sendMessage(sessionId: String, text: String, attachments: List<ChatAttachment> = emptyList()) {
        if (attachments.isEmpty()) raw("sendMessage", sessionId, text)
        else raw("sendMessage", sessionId, text, kotlinx.serialization.json.JsonArray(attachments.map { it.json }))
    }
    suspend fun renameSession(sessionId: String, title: String) { raw("renameSession", sessionId, title) }
    suspend fun regenerateSessionTitle(sessionId: String): String = typed(String.serializer(), "regenerateSessionTitle", sessionId, timeout = 60_000)
    suspend fun deleteSession(sessionId: String) { raw("deleteSession", sessionId) }
    suspend fun abort(sessionId: String) { raw("abort", sessionId) }
    suspend fun setSessionMuted(sessionId: String, muted: Boolean) { raw("setSessionMuted", sessionId, muted) }

    /** Settle (or move back to the inbox) and snooze; a null `snoozedUntil` unsnoozes. */
    suspend fun settle(sessionId: String, settled: Boolean) {
        raw("triageSession", sessionId, buildJsonObject { put("settled", settled) })
    }

    suspend fun snooze(sessionId: String, until: Long?) {
        raw("triageSession", sessionId, buildJsonObject { put("snoozedUntil", until) })
    }

    suspend fun configureSession(sessionId: String, model: String? = null, thinking: ThinkingLevel? = null, mcpServers: List<String>? = null) {
        raw("configureSession", sessionId, buildJsonObject {
            model?.let { put("model", it) }
            thinking?.let { put("thinking", it.id) }
            mcpServers?.let { ids -> putJsonArray("mcpServers") { ids.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } } }
        })
    }

    suspend fun listQueue(sessionId: String): QueueSnapshot = typed(QueueSnapshot.serializer(), "listQueue", sessionId)
    suspend fun editQueued(sessionId: String, id: String, text: String) { raw("editQueued", sessionId, id, text) }
    suspend fun removeQueued(sessionId: String, id: String) { raw("removeQueued", sessionId, id) }
    suspend fun moveQueued(sessionId: String, id: String, index: Int) { raw("moveQueued", sessionId, id, index) }
    suspend fun steerQueued(sessionId: String, id: String) { raw("steerQueued", sessionId, id) }

    suspend fun transcriptImage(sessionId: String, ref: String): TranscriptImage? = nullable(TranscriptImage.serializer(), "transcriptImage", sessionId, ref)
    suspend fun storeChatSecret(sessionId: String, field: String, value: String): String = typed(String.serializer(), "storeChatSecret", sessionId, field, value)
    suspend fun listArtifacts(sessionId: String): List<ChatArtifact> = typed(ListSerializer(ChatArtifact.serializer()), "listArtifacts", sessionId)
    suspend fun saveArtifact(sessionId: String, url: String): SavedArtifact = typed(SavedArtifact.serializer(), "saveArtifact", sessionId, url, timeout = LONG_TIMEOUT_MS)

    // ── Generated UI ─────────────────────────────────────────────────────────

    suspend fun runUiOperation(sessionId: String, name: String, arguments: JsonElement, query: Boolean, confirmed: Boolean = false): UiOperationResult =
        UiOperationResult.parse(raw("runUiOperation", sessionId, name, arguments, buildJsonObject {
            put("query", query)
            if (confirmed) put("confirmed", true)
        }, timeout = LONG_TIMEOUT_MS))

    suspend fun uiStates(sessionId: String): Map<String, JsonElement> =
        (raw("uiStates", sessionId) as? JsonObject)?.toMap() ?: emptyMap()

    suspend fun saveUiState(sessionId: String, card: String, state: JsonElement) { raw("saveUiState", sessionId, card, state) }

    // ── Models and settings ──────────────────────────────────────────────────

    suspend fun modelCatalog(): ModelCatalog = typed(ModelCatalog.serializer(), "modelCatalog")
    suspend fun refreshModelList(): ModelRefresh = typed(ModelRefresh.serializer(), "refreshModelList", timeout = 60_000)

    suspend fun updateSettings(patch: JsonObject) { raw("updateSettings", patch) }

    suspend fun connectCline(key: String): ConnectResult = typed(ConnectResult.serializer(), "connectCline", key)
    suspend fun disconnectCline() { raw("disconnectCline") }
    suspend fun connectOpenCode(key: String): ConnectResult = typed(ConnectResult.serializer(), "connectOpenCode", key)
    suspend fun disconnectOpenCode() { raw("disconnectOpenCode") }
    suspend fun startChatGPTSignIn(): ChatGPTSignInStart = typed(ChatGPTSignInStart.serializer(), "startChatGPTSignIn")
    suspend fun finishChatGPTSignIn(callbackUrl: String): ConnectResult = typed(ConnectResult.serializer(), "finishChatGPTSignIn", callbackUrl)
    suspend fun disconnectChatGPT() { raw("disconnectChatGPT") }
    suspend fun connectBoat(key: String): ConnectResult = typed(ConnectResult.serializer(), "connectBoat", key)
    suspend fun disconnectBoat(): ConnectResult = typed(ConnectResult.serializer(), "disconnectBoat")
    suspend fun connectGitHub(token: String): ConnectResult = typed(ConnectResult.serializer(), "connectGitHub", token, "token")
    suspend fun disconnectGitHub() { raw("disconnectGitHub") }
    suspend fun signOutEverywhere() { raw("signOutEverywhere") }

    /** Saves a secret every chat's VM gets. Pass the existing note when only replacing the value (null resets it). */
    suspend fun saveSecret(name: String, value: String?, note: String): String = typed(String.serializer(), "saveSecret", name, value, note)
    suspend fun removeSecret(name: String) { raw("removeSecret", name) }

    suspend fun listScheduledPrompts(): List<ScheduledPrompt> = typed(ListSerializer(ScheduledPrompt.serializer()), "listScheduledPrompts")
    suspend fun cancelScheduledPrompt(id: String) { raw("cancelScheduledPrompt", id) }

    // ── Workspace ────────────────────────────────────────────────────────────

    suspend fun listFiles(): List<WorkspaceFile> = typed(ListSerializer(WorkspaceFile.serializer()), "listFiles")
    suspend fun readFile(path: String): WorkspaceFileContent = typed(WorkspaceFileContent.serializer(), "readFile", path)
    suspend fun writeFile(path: String, content: String) { raw("writeFile", path, content) }
    suspend fun deleteFile(path: String) { raw("deleteFile", path) }
    suspend fun runCommand(command: String): CommandResult = typed(CommandResult.serializer(), "runCommand", command, timeout = 120_000)

    // ── Agents and projects ──────────────────────────────────────────────────

    suspend fun saveAgent(draft: JsonObject): AgentProfile = typed(AgentProfile.serializer(), "saveAgent", draft)
    suspend fun deleteAgent(id: String) { raw("deleteAgent", id) }
    suspend fun saveProject(draft: JsonObject): ProjectProfile = typed(ProjectProfile.serializer(), "saveProject", draft)
    suspend fun deleteProject(id: String) { raw("deleteProject", id) }
    suspend fun projectImageCandidates(repo: String): List<ProjectImageCandidate> =
        typed(ListSerializer(ProjectImageCandidate.serializer()), "projectImageCandidates", repo, timeout = 60_000)
    suspend fun searchGitHubRepos(query: String, owner: String?): List<GitHubRepo> =
        if (owner == null) typed(ListSerializer(GitHubRepo.serializer()), "searchGitHubRepos", query, timeout = 60_000)
        else typed(ListSerializer(GitHubRepo.serializer()), "searchGitHubRepos", query, owner, timeout = 60_000)
    suspend fun listGitHubBranches(fullName: String): List<String> = typed(ListSerializer(String.serializer()), "listGitHubBranches", fullName)
    suspend fun githubRepoAccess(): GitHubAccess = typed(GitHubAccess.serializer(), "githubRepoAccess")

    // ── MCP ──────────────────────────────────────────────────────────────────

    suspend fun saveMcpServer(draft: JsonObject): McpConnectResult = typed(McpConnectResult.serializer(), "saveMcpServer", draft, timeout = LONG_TIMEOUT_MS)
    suspend fun connectMcpServer(id: String): McpConnectResult = typed(McpConnectResult.serializer(), "connectMcpServer", id, timeout = LONG_TIMEOUT_MS)
    suspend fun setMcpServerDefault(id: String, on: Boolean) { raw("setMcpServerDefault", id, on) }
    suspend fun deleteMcpServer(id: String) { raw("deleteMcpServer", id) }
    suspend fun searchMcpRegistry(query: String, source: String): List<RegistryServer> =
        typed(ListSerializer(RegistryServer.serializer()), "searchMcpRegistry", query, source, timeout = 60_000)
    suspend fun checkMcpServer(server: RegistryServer): McpCheckReport =
        typed(McpCheckReport.serializer(), "checkMcpServer", DexJson.encodeToJsonElement(RegistryServer.serializer(), server), timeout = 90_000)

    // ── Skills ───────────────────────────────────────────────────────────────

    suspend fun searchSkills(query: String): List<DirectorySkill> = typed(ListSerializer(DirectorySkill.serializer()), "searchSkills", query)
    suspend fun previewSkill(source: String, skillId: String): SkillPreview = typed(SkillPreview.serializer(), "previewSkill", source, skillId, timeout = 60_000)
    suspend fun installSkill(source: String, skillId: String, auto: Boolean = true): SkillDetail =
        typed(SkillDetail.serializer(), "installSkill", source, skillId, auto, timeout = 90_000)
    suspend fun getSkill(id: String): SkillDetail? = nullable(SkillDetail.serializer(), "getSkill", id)
    suspend fun saveSkill(id: String?, name: String, description: String, instructions: String, auto: Boolean): SkillDetail =
        typed(SkillDetail.serializer(), "saveSkill", buildJsonObject {
            id?.let { put("id", it) }
            put("name", name)
            put("description", description)
            put("instructions", instructions)
            put("auto", auto)
        })
    suspend fun setSkillAuto(id: String, auto: Boolean) { raw("setSkillAuto", id, auto) }
    suspend fun updateSkill(id: String): SkillDetail = typed(SkillDetail.serializer(), "updateSkill", id, timeout = 90_000)
    suspend fun removeSkill(id: String) { raw("removeSkill", id) }

    // ── VMs ──────────────────────────────────────────────────────────────────

    suspend fun vmRefresh(key: String): VmInfo = typed(VmInfo.serializer(), "vmRefresh", key)
    suspend fun vmStart(key: String): VmInfo = typed(VmInfo.serializer(), "vmStart", key, timeout = VM_TIMEOUT_MS)
    suspend fun vmStop(key: String): VmInfo = typed(VmInfo.serializer(), "vmStop", key, timeout = LONG_TIMEOUT_MS)
    suspend fun vmDestroy(key: String): VmInfo = typed(VmInfo.serializer(), "vmDestroy", key, timeout = LONG_TIMEOUT_MS)
    suspend fun vmRerunSetup(key: String) { raw("vmRerunSetup", key, timeout = VM_TIMEOUT_MS) }
    suspend fun vmTouch(key: String) { raw("vmTouch", key) }
    suspend fun vmActivity(key: String, limit: Int = 150): List<VmActivity> = typed(ListSerializer(VmActivity.serializer()), "vmActivity", key, limit)
    suspend fun vmRun(key: String, command: String): VmRunResult = typed(VmRunResult.serializer(), "vmRun", key, command, timeout = VM_TIMEOUT_MS)
    suspend fun vmDesktopUrl(key: String, mode: String): String? =
        raw("vmDesktopUrl", key, mode, timeout = 300_000)?.str
    suspend fun vmExposePort(key: String, port: Int, public: Boolean): String = typed(String.serializer(), "vmExposePort", key, port, public, timeout = VM_TIMEOUT_MS)

    // ── Usage, notifications, access ─────────────────────────────────────────

    suspend fun usageReport(range: String): UsageReport = typed(UsageReport.serializer(), "usageReport", range, timeout = 60_000)

    suspend fun pushUpdate(id: String, kinds: List<String>? = null, onlyWhenAway: Boolean? = null) {
        raw("pushUpdate", id, buildJsonObject {
            kinds?.let { list -> putJsonArray("kinds") { list.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } } }
            onlyWhenAway?.let { put("onlyWhenAway", it) }
        })
    }
    suspend fun pushUnsubscribe(id: String) { raw("pushUnsubscribe", id) }
    suspend fun pushTest(id: String): String? = raw("pushTest", id)?.str

    suspend fun createAccessToken(label: String, scope: String, days: Int?): CreatedAccessToken =
        typed(CreatedAccessToken.serializer(), "createAccessToken", label, scope, days)
    suspend fun revokeAccessToken(id: String) { raw("revokeAccessToken", id) }
    suspend fun resolvePendingAction(id: String, approve: Boolean) { raw("resolvePendingAction", id, approve) }

    companion object {
        /** A draft's JSON (the agent validates and normalizes it). */
        fun <T> draft(serializer: KSerializer<T>, value: T): JsonObject = DexJson.encodeToJsonElement(serializer, value) as JsonObject

        /**
         * A project as `saveProject` takes it: no id when new (blank), no timestamps, and explicit nulls, since a left-out
         * `image` keeps the saved picture and null clears it.
         */
        fun projectDraft(project: ProjectProfile): JsonObject {
            val json = draft(ProjectProfile.serializer(), project).toMutableMap()
            json.remove("createdAt")
            json.remove("updatedAt")
            if (project.id.isEmpty()) json.remove("id")
            json["image"] = project.image?.let(::JsonPrimitive) ?: JsonNull
            json["vmSize"] = project.vmSize?.let(::JsonPrimitive) ?: JsonNull
            return JsonObject(json)
        }

        /** An agent as `saveAgent` takes it: no id when new (blank), no timestamps. */
        fun agentDraft(agent: AgentProfile): JsonObject {
            val json = draft(AgentProfile.serializer(), agent).toMutableMap()
            json.remove("createdAt")
            json.remove("updatedAt")
            if (agent.id.isEmpty()) json.remove("id")
            return JsonObject(json)
        }
    }
}
