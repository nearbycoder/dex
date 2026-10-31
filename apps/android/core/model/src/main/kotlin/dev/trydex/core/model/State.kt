package dev.trydex.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The agent's synced state (DexState in apps/web/src/shared/protocol.ts). Every field has a default, so state saved by
 * an older agent (which lacks newer fields) reads the same way `withStateDefaults` fills it in on the web.
 */
@Serializable
data class DexState(
    val cline: ProviderStatus = ProviderStatus(),
    val opencode: ProviderStatus = ProviderStatus(),
    /** Sign in with ChatGPT; `keyHint` is the account's email. Missing in state an older agent saved. */
    val chatgpt: ProviderStatus = ProviderStatus(),
    val boat: BoatStatus = BoatStatus(),
    val settings: DexSettings = DexSettings(),
    val sessions: List<SessionMeta> = emptyList(),
    val vms: List<VmInfo> = emptyList(),
    val vmConfigured: Boolean = false,
    val projects: List<ProjectProfile> = emptyList(),
    val github: GitHubStatus = GitHubStatus(),
    val push: PushStatus = PushStatus(),
    val agents: List<AgentProfile> = emptyList(),
    /** Characters, pinned above the chats, each with a conversation of their own. Missing in state an older agent saved. */
    val characters: List<CharacterProfile> = emptyList(),
    val mcp: List<McpServerInfo> = emptyList(),
    val access: AccessState = AccessState(),
    val secrets: List<SavedSecret> = emptyList(),
    val skills: List<SkillInfo> = emptyList(),
    val build: String? = null,
    val models: ModelListVersion? = null,
) {
    /** Which model subscriptions this user can run on. */
    val connectedProviders: Map<ModelProvider, Boolean>
        get() = mapOf(
            ModelProvider.ClinePass to cline.connected,
            ModelProvider.OpenCodeGo to opencode.connected,
            ModelProvider.ChatGPT to chatgpt.connected,
        )

    val anyProviderConnected: Boolean get() = cline.connected || opencode.connected || chatgpt.connected

    fun session(id: String): SessionMeta? = sessions.firstOrNull { it.id == id }
    fun agent(id: String?): AgentProfile? = id?.let { key -> agents.firstOrNull { it.id == key } }
    fun project(id: String?): ProjectProfile? = id?.let { key -> projects.firstOrNull { it.id == key } }
    fun character(id: String?): CharacterProfile? = id?.let { key -> characters.firstOrNull { it.id == key } }

    /** The chat list: a character's conversations live under them, not in the inbox. */
    val chats: List<SessionMeta> get() = sessions.filter { it.characterId == null }

    /** Chats with something you haven't seen (muted ones too: muting is about notifications), for the app's badge. */
    val unreadCount: Int get() = sessions.count { it.unread }
    fun vm(key: String): VmInfo? = vms.firstOrNull { it.key == key }
    fun mcpServer(id: String): McpServerInfo? = mcp.firstOrNull { it.id == id }
}

@Serializable
data class ModelListVersion(val version: String = "", val updatedAt: Long = 0)

@Serializable
data class ProviderStatus(
    val connected: Boolean = false,
    /** `user`: a key this user connected. `server`: the deployment's key. */
    val source: String? = null,
    val keyHint: String? = null,
    val verifiedAt: Long? = null,
)

@Serializable
data class BoatStatus(
    val connected: Boolean = false,
    val source: String? = null,
    val keyHint: String? = null,
)

@Serializable
data class GitHubStatus(
    val connected: Boolean = false,
    val login: String? = null,
    /** `oauth` (Connect with GitHub) or `token` (a pasted token). */
    val via: String? = null,
    val oauthAvailable: Boolean = false,
    val expired: Boolean = false,
)

@Serializable
data class DexSettings(
    val defaultModel: String = DEFAULT_MODEL_ID,
    val defaultThinking: ThinkingLevel = DEFAULT_THINKING,
    val instructions: String = "",
    val vmSize: String = "small",
    val vmMinutes: Int = 5,
)

@Serializable
data class SessionMeta(
    val id: String,
    val title: String = "New chat",
    val model: String = DEFAULT_MODEL_ID,
    val thinking: ThinkingLevel = DEFAULT_THINKING,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val busy: Boolean = false,
    val agentId: String? = null,
    val mcpServers: List<String> = emptyList(),
    val projectId: String? = null,
    /** The character this is a conversation with, if any. */
    val characterId: String? = null,
    /** A reply came in since you last looked at it (on any device). Missing from older agents. */
    val unread: Boolean = false,
    /** The latest reply, shortened (for lists, widgets, and notifications). */
    val lastReply: String? = null,
    /** When the latest reply finished. */
    val repliedAt: Long? = null,
    val muted: Boolean = false,
    val settledAt: Long? = null,
    val snoozedUntil: Long? = null,
)

@Serializable
enum class ThinkingLevel {
    @SerialName("off") Off,
    @SerialName("minimal") Minimal,
    @SerialName("low") Low,
    @SerialName("medium") Medium,
    @SerialName("high") High,
    @SerialName("xhigh") XHigh;

    /** The id the agent uses (and the web's thinking menu shows). */
    val id: String get() = when (this) {
        Off -> "off"
        Minimal -> "minimal"
        Low -> "low"
        Medium -> "medium"
        High -> "high"
        XHigh -> "xhigh"
    }

    companion object {
        fun fromId(id: String?): ThinkingLevel? = entries.firstOrNull { it.id == id }
    }
}

const val SHARED_VM = "shared"
const val MCP_VM = "mcp-host"

@Serializable
enum class VmStatus {
    @SerialName("none") None,
    @SerialName("starting") Starting,
    @SerialName("running") Running,
    @SerialName("stopping") Stopping,
    @SerialName("stopped") Stopped,
    @SerialName("error") Error;
}

@Serializable
data class VmSetup(
    /** none, running, done, or error. */
    val status: String = "none",
    val step: String? = null,
    val error: String? = null,
)

@Serializable
data class VmInfo(
    val key: String,
    val id: String? = null,
    val status: VmStatus = VmStatus.None,
    val size: String? = null,
    val archiveAfter: String? = null,
    val error: String? = null,
    val lastActiveAt: Long? = null,
    val busy: Boolean = false,
    val setup: VmSetup = VmSetup(),
) {
    val running: Boolean get() = status == VmStatus.Running
    val settingUp: Boolean get() = setup.status == "running"

    companion object {
        fun none(key: String) = VmInfo(key = key)
    }
}

/** One thing done on a VM, by the agent, the user, or Dex, shown live on the Machine page. */
@Serializable
data class VmActivity(
    val id: Long,
    val at: Long = 0,
    /** agent, user, or system. */
    val actor: String = "system",
    /** exec, spawn, file, port, screenshot, or lifecycle. */
    val kind: String = "exec",
    val title: String = "",
    /** running, done, or error. */
    val status: String = "done",
    val exitCode: Int? = null,
    val output: String = "",
)

@Serializable
data class ProjectRepo(
    val url: String,
    val branch: String = "",
    val dir: String = "",
)

@Serializable
data class ProjectProfile(
    val id: String,
    val name: String = "",
    val description: String = "",
    val icon: String = "briefcase",
    val color: String = "sky",
    val repos: List<ProjectRepo> = emptyList(),
    val setupScript: String = "",
    val instructions: String = "",
    val starter: String = "",
    val vmSize: String? = null,
    val image: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class AgentProfile(
    val id: String,
    val name: String = "",
    val description: String = "",
    val icon: String = "bot",
    val color: String = "emerald",
    val instructions: String = "",
    val starter: String = "",
    val model: String = DEFAULT_MODEL_ID,
    val thinking: ThinkingLevel = DEFAULT_THINKING,
    val mcpServers: List<String> = emptyList(),
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class McpToolInfo(val name: String, val description: String = "")

@Serializable
data class McpLocal(val command: String = "", val envNames: List<String> = emptyList())

@Serializable
enum class McpStatus {
    @SerialName("connecting") Connecting,
    @SerialName("authenticating") Authenticating,
    @SerialName("connected") Connected,
    @SerialName("discovering") Discovering,
    @SerialName("ready") Ready,
    @SerialName("failed") Failed,
    @SerialName("disconnected") Disconnected;

    val label: String get() = when (this) {
        Connecting, Connected -> "Connecting"
        Authenticating -> "Needs sign-in"
        Discovering -> "Loading tools"
        Ready -> "Ready"
        Failed -> "Failed"
        Disconnected -> "Not connected"
    }

    /** A server in this state needs the user (a sign-in, or a look at what failed). */
    val needsAttention: Boolean get() = this == Authenticating || this == Failed

    val pending: Boolean get() = this == Connecting || this == Connected || this == Discovering
}

@Serializable
data class McpServerInfo(
    val id: String,
    val name: String = "",
    val url: String = "",
    /** auto, streamable-http, or sse. */
    val transport: String = "auto",
    /** none, headers, or oauth. */
    val auth: String = "none",
    val headerNames: List<String> = emptyList(),
    val local: McpLocal? = null,
    val defaultOn: Boolean = false,
    val prefix: String = "",
    val status: McpStatus = McpStatus.Disconnected,
    val error: String? = null,
    val tools: List<McpToolInfo> = emptyList(),
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class PushDevice(
    val id: String,
    /** web (a browser's Web Push), ios, or android (the apps). Missing on devices saved before the apps had push. */
    val platform: String = "web",
    val label: String = "Device",
    val kinds: List<String> = emptyList(),
    val onlyWhenAway: Boolean = true,
    val createdAt: Long = 0,
    val lastSentAt: Long? = null,
    val error: String? = null,
)

@Serializable
data class PushStatus(
    /** Web Push (VAPID keys). The apps have their own: [native]. */
    val configured: Boolean = false,
    val publicKey: String? = null,
    val devices: List<PushDevice> = emptyList(),
    /** Whether this deployment can push to the apps (APNs, Firebase). Missing from older agents: neither. */
    val native: NativePush = NativePush(),
)

@Serializable
data class NativePush(val ios: Boolean = false, val android: Boolean = false)

@Serializable
data class AccessToken(
    val id: String,
    val label: String = "",
    /** read, write, or admin. */
    val scope: String = "read",
    val createdAt: Long = 0,
    val lastUsedAt: Long? = null,
    val expiresAt: Long? = null,
)

@Serializable
data class AuditEntry(
    val id: Long,
    val at: Long = 0,
    /** chat, mcp, user, or ui. */
    val actor: String = "chat",
    val actorLabel: String = "",
    val operation: String = "",
    val summary: String = "",
    val ok: Boolean = true,
    val error: String? = null,
)

@Serializable
data class PendingAction(
    val id: String,
    val sessionId: String = "",
    val operation: String = "",
    val summary: String = "",
    val createdAt: Long = 0,
    /** pending, approved, declined, expired, or failed. */
    val status: String = "expired",
    val result: String? = null,
)

@Serializable
data class AccessState(
    val tokens: List<AccessToken> = emptyList(),
    val audit: List<AuditEntry> = emptyList(),
    val pending: List<PendingAction> = emptyList(),
) {
    /** Admin operations a chat asked for in the last hour that still wait for an answer. */
    fun waiting(now: Long): List<PendingAction> =
        pending.filter { it.status == "pending" && now - it.createdAt < 3_600_000 }
}

@Serializable
data class SavedSecret(val name: String, val note: String = "", val updatedAt: Long = 0)

@Serializable
data class SkillInfo(
    val id: String,
    val description: String = "",
    val source: String? = null,
    val path: String? = null,
    val auto: Boolean = true,
    val files: Int = 0,
    val size: Long = 0,
    val installedAt: Long = 0,
    val updatedAt: Long = 0,
) {
    /** The `owner/repo/skill` id skills.sh lists it under, to tell installed results apart. */
    val directoryId: String get() = "$source/${path?.split("/")?.last() ?: id}"
}

@Serializable
data class SkillFileInfo(val path: String, val size: Long = 0)

@Serializable
data class SkillDetail(
    val id: String,
    val description: String = "",
    val source: String? = null,
    val path: String? = null,
    val auto: Boolean = true,
    val files: Int = 0,
    val size: Long = 0,
    val installedAt: Long = 0,
    val updatedAt: Long = 0,
    val instructions: String = "",
    val fileList: List<SkillFileInfo> = emptyList(),
)

@Serializable
data class DirectorySkill(
    val id: String,
    val source: String = "",
    val skillId: String = "",
    val name: String = "",
    val installs: Long = 0,
)

@Serializable
data class SkillPreview(
    val name: String = "",
    val description: String = "",
    val instructions: String = "",
    val source: String = "",
    val path: String = "",
    val url: String = "",
    val files: List<SkillFileInfo> = emptyList(),
    val size: Long = 0,
)

@Serializable
data class WorkspaceFile(val path: String, val size: Long = 0, val mtime: Long = 0)

@Serializable
data class WorkspaceFileContent(val path: String, val content: String? = null, val size: Long = 0)

@Serializable
data class CommandResult(val stdout: String = "", val stderr: String = "", val exitCode: Int = 0)

@Serializable
data class VmRunResult(val exitCode: Int = 0, val output: String = "")

@Serializable
data class ScheduledPrompt(
    val id: String,
    val prompt: String = "",
    val sessionId: String? = null,
    /** The next run, as an ISO time. */
    val `when`: String = "",
    val cron: String? = null,
)

@Serializable
data class QueuedMessage(
    val id: String,
    val text: String = "",
    val createdAt: Long = 0,
    /** The files sent with it (names and types only). */
    val attachments: List<AttachedFile> = emptyList(),
)

@Serializable
data class ChatArtifact(
    val key: String,
    val url: String,
    val name: String = "",
    /** video, audio, or image. */
    val kind: String = "image",
    val size: Long = 0,
    val source: String? = null,
    val createdAt: Long = 0,
)

@Serializable
data class SavedArtifact(val url: String, val name: String = "", val kind: String = "image", val size: Long = 0)

/** What connecting a key returns (`ConnectClineResult`). */
@Serializable
data class ConnectResult(val ok: Boolean = false, val note: String? = null, val error: String? = null, val login: String? = null)

/** A ChatGPT sign-in started: the page to approve on. Approving lands on a 127.0.0.1 address to paste back. */
@Serializable
data class ChatGPTSignInStart(val url: String = "", val redirectUri: String = "http://127.0.0.1:1455/auth/callback")

@Serializable
data class McpConnectResult(val ok: Boolean = false, val id: String? = null, val authUrl: String? = null, val error: String? = null)

@Serializable
data class CreatedAccessToken(val token: AccessToken, val secret: String)

@Serializable
data class ModelRefresh(val added: List<String> = emptyList(), val retired: List<String> = emptyList(), val count: Int = 0)

@Serializable
data class TranscriptImage(val data: String, val mimeType: String = "image/png")

@Serializable
data class GitHubRepo(
    val fullName: String,
    val private: Boolean = false,
    val description: String = "",
    val defaultBranch: String = "main",
    val pushedAt: String? = null,
    val fork: Boolean = false,
    val archived: Boolean = false,
    val owner: String = "",
    val ownerAvatar: String = "",
    val accessible: Boolean = false,
    val language: String? = null,
    val stars: Long = 0,
)

@Serializable
data class GitHubOrg(val login: String, val avatarUrl: String = "")

@Serializable
data class GitHubAccess(
    val connected: Boolean = false,
    val login: String? = null,
    val via: String? = null,
    val orgs: List<GitHubOrg> = emptyList(),
    val manageUrl: String? = null,
)

@Serializable
data class ProjectImageCandidate(val path: String, val dataUrl: String)

@Serializable
data class RegistryHeader(
    val name: String,
    val description: String = "",
    val required: Boolean = false,
    val secret: Boolean = false,
    val value: String? = null,
)

@Serializable
data class RegistryRun(val command: String = "", val env: List<RegistryHeader> = emptyList())

@Serializable
data class RegistryServer(
    val source: String = "smithery",
    val name: String = "",
    val title: String = "",
    val description: String = "",
    val version: String = "",
    val repository: String? = null,
    val url: String = "",
    val transport: String = "streamable-http",
    val run: RegistryRun? = null,
    val headers: List<RegistryHeader> = emptyList(),
    val templated: Boolean = false,
    val updatedAt: String? = null,
    val status: String = "",
    val uses: Long? = null,
    val verified: Boolean? = null,
)

@Serializable
data class McpCheck(val id: String, val label: String = "", val status: String = "info", val detail: String = "")

@Serializable
data class McpCheckReport(
    val url: String = "",
    val checks: List<McpCheck> = emptyList(),
    val auth: String = "none",
    val header: String? = null,
    val tools: List<String> = emptyList(),
    val checkedAt: Long = 0,
)
