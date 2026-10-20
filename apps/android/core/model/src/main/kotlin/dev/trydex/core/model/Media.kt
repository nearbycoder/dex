package dev.trydex.core.model

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** Media chats share, and links that play inline (apps/web/src/shared/media.ts and client/components/media.tsx). */
object Media {
    const val PREFIX = "/api/media/"

    enum class Kind { Video, Audio, Image }

    data class Type(val mime: String, val kind: Kind)

    private val TYPES = mapOf(
        "mp4" to Type("video/mp4", Kind.Video),
        "m4v" to Type("video/mp4", Kind.Video),
        "mov" to Type("video/quicktime", Kind.Video),
        "webm" to Type("video/webm", Kind.Video),
        "ogv" to Type("video/ogg", Kind.Video),
        "mp3" to Type("audio/mpeg", Kind.Audio),
        "m4a" to Type("audio/mp4", Kind.Audio),
        "wav" to Type("audio/wav", Kind.Audio),
        "ogg" to Type("audio/ogg", Kind.Audio),
        "png" to Type("image/png", Kind.Image),
        "jpg" to Type("image/jpeg", Kind.Image),
        "jpeg" to Type("image/jpeg", Kind.Image),
        "gif" to Type("image/gif", Kind.Image),
        "webp" to Type("image/webp", Kind.Image),
    )

    private val EXTENSION = Regex("\\.([a-z0-9]+)$", RegexOption.IGNORE_CASE)
    private val VM_PORT_HOST = Regex("^[a-z0-9-]+-(\\d{2,5})\\.on\\.boat\\.dev$")
    private val VM_LINK = Regex("https://[a-z0-9-]+\\.on\\.boat\\.dev/[^\\s)<>\"'\\]]+", RegexOption.IGNORE_CASE)
    private val DIRECT_VIDEO = Regex("\\.(mp4|m4v|webm|mov|ogv)$", RegexOption.IGNORE_CASE)
    private val YOUTUBE_PATH = Regex("^/(?:shorts|embed|live)/([^/]+)")
    private val YOUTUBE_ID = Regex("^[\\w-]{11}$")
    private val VIMEO_ID = Regex("/(\\d{6,12})(?:/|$)")

    fun extensionOf(path: String): String? = EXTENSION.find(path.split('?', '#').first())?.groupValues?.get(1)?.lowercase()

    fun typeOf(path: String): Type? = extensionOf(path)?.let { TYPES[it] }

    data class VmSource(val source: String, val port: Int, val path: String)

    private fun parse(raw: String): URI? = runCatching { URI(raw.trim()) }.getOrNull()?.takeIf { it.scheme != null && it.host != null }

    /** A media file served from a chat VM's port, as the key Dex saves it under (host and path, no token query). */
    fun vmSource(raw: String): VmSource? {
        val url = parse(raw) ?: return null
        val host = url.host.lowercase()
        val port = VM_PORT_HOST.find(host)?.groupValues?.get(1) ?: return null
        val path = url.rawPath ?: ""
        if (url.scheme != "https" || typeOf(path) == null) return null
        return VmSource("$host$path", port.toInt(), path)
    }

    /** Every VM-served media link in some Markdown, deduplicated by source. */
    fun vmLinks(text: String): List<String> {
        val found = LinkedHashMap<String, String>()
        for (match in VM_LINK.findAll(text)) {
            val source = vmSource(match.value) ?: continue
            if (source.source !in found) found[source.source] = match.value
        }
        return found.values.toList()
    }

    sealed interface Source {
        val url: String

        /** Stored by Dex (`/api/media/…`): plays at once, with the session cookie. */
        data class Own(override val url: String, val kind: Kind) : Source
        /** On a chat VM's port: saved into the chat before it plays. */
        data class Vm(override val url: String, val kind: Kind) : Source
        data class YouTube(override val url: String, val id: String) : Source
        data class Vimeo(override val url: String, val id: String) : Source
        /** A video file elsewhere on the web: loads only when you tap play. */
        data class File(override val url: String) : Source
    }

    /** What a link or image source plays as, or null if it's an ordinary link (videoSource on the web). */
    fun source(raw: String): Source? {
        if (raw.startsWith(PREFIX)) return typeOf(raw)?.let { Source.Own(raw, it.kind) }
        vmSource(raw)?.let { vm -> return typeOf(vm.path)?.let { Source.Vm(raw, it.kind) } }
        val url = parse(raw) ?: return null
        if (url.scheme != "https") return null
        val host = url.host.lowercase().replace(Regex("^(www\\.|m\\.)"), "")
        val path = url.rawPath ?: ""
        if (host == "youtube.com" || host == "youtube-nocookie.com" || host == "youtu.be") {
            val id = when {
                host == "youtu.be" -> path.removePrefix("/")
                path == "/watch" -> query(url, "v")
                else -> YOUTUBE_PATH.find(path)?.groupValues?.get(1)
            }
            return if (id != null && YOUTUBE_ID.matches(id)) Source.YouTube(raw, id) else null
        }
        if (host == "vimeo.com" || host == "player.vimeo.com") {
            return VIMEO_ID.find(path)?.groupValues?.get(1)?.let { Source.Vimeo(raw, it) }
        }
        return if (DIRECT_VIDEO.containsMatchIn(path)) Source.File(raw) else null
    }

    private fun query(url: URI, name: String): String? =
        url.rawQuery?.split('&')?.map { it.split('=', limit = 2) }?.firstOrNull { it[0] == name }?.getOrNull(1)
            ?.let { URLDecoder.decode(it, StandardCharsets.UTF_8) }

    /** The decoded last path segment, or "the file". */
    fun fileName(url: String): String {
        val path = runCatching { URI("https://dex.invalid/").resolve(url.trim()).rawPath }.getOrNull() ?: return "the file"
        val last = path.split('/').lastOrNull().orEmpty()
        val decoded = runCatching { URLDecoder.decode(last.replace("+", "%2B"), StandardCharsets.UTF_8) }.getOrDefault(last)
        return decoded.ifEmpty { "the file" }
    }

    /** A host label for a play card's detail line. */
    fun hostLabel(source: Source): String = when (source) {
        is Source.YouTube -> "YouTube"
        is Source.Vimeo -> "Vimeo"
        else -> parse(source.url)?.host ?: "external site"
    }

    fun youTubeThumbnail(id: String) = "https://i.ytimg.com/vi/$id/hqdefault.jpg"
    fun youTubeEmbed(id: String) = "https://www.youtube-nocookie.com/embed/$id?autoplay=1&playsinline=1&rel=0"
    fun vimeoEmbed(id: String) = "https://player.vimeo.com/video/$id?autoplay=1&dnt=1"

    /**
     * Images a reply may load: inline ones (data: and blob:) and Dex's own paths. Images elsewhere could leak chat content
     * through their URL, so they show as links instead.
     */
    fun isInlineImage(src: String): Boolean =
        src.startsWith("data:image/") || src.startsWith("blob:") || (src.startsWith("/") && !src.startsWith("//"))
}

/** Project repo helpers (apps/web/src/shared/projects.ts). */
object Repos {
    const val PROJECT_ROOT = "/home/user/work"
    private val GITHUB_FULL_NAME = Regex("^https://github\\.com/([\\w.-]+/[\\w.-]+?)(?:\\.git)?/?$")
    private val SHORTHAND = Regex("^(?:github\\.com/)?([\\w.-]+)/([\\w.-]+?)(?:\\.git)?$")
    private val LABEL = Regex("github\\.com/([\\w.-]+/[\\w.-]+?)(?:\\.git)?$")
    private val OWNER_REPO = Regex("^[\\w.-]+/[\\w.-]+$")

    fun githubFullName(url: String): String? = GITHUB_FULL_NAME.find(url)?.groupValues?.get(1)

    /** `owner/repo`, `github.com/owner/repo`, or a full URL, as a clone URL; null if it isn't a repo. */
    fun normalize(input: String): String? {
        val value = input.trim().replace(Regex("/+$"), "")
        val shorthand = SHORTHAND.find(value)
        if (shorthand != null && ':' !in value) return "https://github.com/${shorthand.groupValues[1]}/${shorthand.groupValues[2]}.git"
        val url = runCatching { URI(value) }.getOrNull() ?: return null
        if (url.scheme != "https" || url.host == null || url.rawUserInfo != null) return null
        if ((url.rawPath ?: "").split('/').count { it.isNotEmpty() } < 2) return null
        return url.toString()
    }

    fun dirName(url: String): String =
        (url.split('/').lastOrNull { it.isNotEmpty() } ?: "repo").removeSuffix(".git").replace(Regex("[^\\w.-]"), "-").ifEmpty { "repo" }

    /** `owner/repo` for GitHub repos, else the URL without its scheme and `.git`. */
    fun label(url: String): String =
        LABEL.find(url)?.groupValues?.get(1) ?: url.removePrefix("https://").removeSuffix(".git")

    fun isGitHubLabel(label: String) = OWNER_REPO.matches(label)

    fun ownerAvatar(owner: String) = "https://avatars.githubusercontent.com/$owner?s=96"

    val LANGUAGE_COLORS = mapOf(
        "TypeScript" to 0xFF3178C6, "JavaScript" to 0xFFF1E05A, "Python" to 0xFF3572A5, "Rust" to 0xFFDEA584,
        "Go" to 0xFF00ADD8, "Swift" to 0xFFF05138, "Kotlin" to 0xFFA97BFF, "Java" to 0xFFB07219, "Ruby" to 0xFF701516,
        "C#" to 0xFF178600, "C++" to 0xFFF34B7D, "C" to 0xFF555555, "HTML" to 0xFFE34C26, "CSS" to 0xFF563D7C,
        "Shell" to 0xFF89E051, "Vue" to 0xFF41B883, "Svelte" to 0xFFFF3E00, "Dart" to 0xFF00B4AB, "PHP" to 0xFF4F5D95,
        "Elixir" to 0xFF6E4A7E,
    )
}
