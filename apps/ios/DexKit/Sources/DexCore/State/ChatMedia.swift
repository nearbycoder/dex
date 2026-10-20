import Foundation

/// Media in chats (apps/web/src/shared/media.ts and client/components/media.tsx). Videos, audio, and images a chat
/// shares are stored in Dex and served at `/api/media/<key>`; links to a chat VM's port (`*.on.boat.dev`) are saved
/// into the chat before they play; videos elsewhere (YouTube, Vimeo, a video file) load only when you tap play.
public enum ChatMedia {
    public enum Kind: String, Sendable, Hashable, Codable { case video, audio, image }

    /// What kind of playable media a link is.
    public enum Source: Sendable, Hashable {
        /// Stored in Dex (`/api/media/…`).
        case own(url: String, kind: Kind)
        /// On the chat's VM: saved into the chat first.
        case vm(url: String, kind: Kind)
        /// A video file on another site.
        case file(url: String)
        case youtube(id: String, url: String)
        case vimeo(id: String, url: String)

        public var url: String {
            switch self {
            case .own(let url, _), .vm(let url, _), .file(let url), .youtube(_, let url), .vimeo(_, let url): url
            }
        }
    }

    public static let prefix = "/api/media/"

    public static let types: [String: (type: String, kind: Kind)] = [
        "mp4": ("video/mp4", .video), "m4v": ("video/mp4", .video), "mov": ("video/quicktime", .video),
        "webm": ("video/webm", .video), "ogv": ("video/ogg", .video),
        "mp3": ("audio/mpeg", .audio), "m4a": ("audio/mp4", .audio), "wav": ("audio/wav", .audio), "ogg": ("audio/ogg", .audio),
        "png": ("image/png", .image), "jpg": ("image/jpeg", .image), "jpeg": ("image/jpeg", .image),
        "gif": ("image/gif", .image), "webp": ("image/webp", .image)
    ]

    /// A path's extension, lowercased, ignoring any query or fragment.
    public static func extensionOf(_ path: String) -> String? {
        let bare = path.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? ""
        guard let dot = bare.lastIndex(of: "."), !bare[bare.index(after: dot)...].contains("/") else { return nil }
        let ext = bare[bare.index(after: dot)...].lowercased()
        return ext.isEmpty || !ext.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) ? nil : ext
    }

    public static func kind(of path: String) -> Kind? { extensionOf(path).flatMap { types[$0]?.kind } }

    /// `/api/media/…` URLs (relative, or on the Dex server) as their key; nil for anything else.
    public static func ownKey(_ url: String, server: URL? = nil) -> String? {
        var path = url
        if let origin = server.map(origin), url.hasPrefix(origin) { path = String(url.dropFirst(origin.count)) }
        guard path.hasPrefix(prefix) else { return nil }
        return path.dropFirst(prefix.count).split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init)
    }

    /// `https://host[:port]` of a server URL.
    static func origin(_ server: URL) -> String {
        var origin = "\(server.scheme ?? "https")://\(server.host() ?? "")"
        if let port = server.port { origin += ":\(port)" }
        return origin
    }

    /// A media file served from a chat VM's port, as the key Dex saves it under: host and path, without the query
    /// (which carries the port's access token). Nil for anything else.
    public static func vmSource(_ raw: String) -> (source: String, port: Int, path: String)? {
        guard let url = URL(string: raw), url.scheme == "https", let host = url.host()?.lowercased() else { return nil }
        guard let match = host.firstMatch(of: /^[a-z0-9-]+-(\d{2,5})\.on\.boat\.dev$/), let port = Int(match.1) else { return nil }
        let path = url.path(percentEncoded: true)
        guard kind(of: path) != nil else { return nil }
        return ("\(host)\(path)", port, path)
    }

    /// Every VM-served media link in some Markdown, deduplicated by source.
    public static func vmLinks(in text: String) -> [String] {
        var seen = Set<String>()
        var links: [String] = []
        for match in text.matches(of: /(?i)https:\/\/[a-z0-9-]+\.on\.boat\.dev\/[^\s)<>"'\]]+/) {
            let link = String(match.0)
            if let source = vmSource(link)?.source, seen.insert(source).inserted { links.append(link) }
        }
        return links
    }

    /// What kind of playable media a link is, if any (the web's `videoSource`). `server` lets an absolute link to
    /// Dex's own media count as stored media.
    public static func source(_ raw: String, server: URL? = nil) -> Source? {
        if let key = ownKey(raw, server: server) {
            return kind(of: key).map { .own(url: raw, kind: $0) }
        }
        if vmSource(raw) != nil, let url = URL(string: raw) {
            return kind(of: url.path(percentEncoded: true)).map { .vm(url: raw, kind: $0) }
        }
        guard let url = URL(string: raw), url.scheme == "https", let rawHost = url.host()?.lowercased() else { return nil }
        let host = rawHost.replacing(/^(www\.|m\.)/, with: "")
        let path = url.path(percentEncoded: true)
        if host == "youtube.com" || host == "youtube-nocookie.com" || host == "youtu.be" {
            var id: String?
            if host == "youtu.be" { id = String(path.dropFirst()) }
            else if path == "/watch" { id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value }
            else if let match = path.firstMatch(of: /^\/(?:shorts|embed|live)\/([^\/]+)/) { id = String(match.1) }
            guard let id, id.wholeMatch(of: /[\w-]{11}/) != nil else { return nil }
            return .youtube(id: id, url: raw)
        }
        if host == "vimeo.com" || host == "player.vimeo.com" {
            guard let match = path.firstMatch(of: /\/(\d{6,12})(?:\/|$)/) else { return nil }
            return .vimeo(id: String(match.1), url: raw)
        }
        return path.firstMatch(of: /(?i)\.(mp4|m4v|webm|mov|ogv)$/) != nil ? .file(url: raw) : nil
    }

    /// The file name a link ends in, or "the file".
    public static func fileName(_ raw: String) -> String {
        let url = URL(string: raw, relativeTo: URL(string: "https://dex.invalid"))
        let name = url?.lastPathComponent ?? ""
        return name.isEmpty || name == "/" ? "the file" : name
    }

    /// An absolute URL for a link in a chat (Dex's own media links are relative to the server).
    public static func absolute(_ raw: String, server: URL?) -> URL? {
        if raw.hasPrefix("/"), !raw.hasPrefix("//"), let server { return URL(string: raw, relativeTo: server)?.absoluteURL }
        return URL(string: raw)
    }

    /// The embed page that plays a YouTube or Vimeo video (nil for others).
    public static func embedURL(_ source: Source) -> URL? {
        switch source {
        case .youtube(let id, _): URL(string: "https://www.youtube-nocookie.com/embed/\(id)?autoplay=1&playsinline=1&rel=0")
        case .vimeo(let id, _): URL(string: "https://player.vimeo.com/video/\(id)?autoplay=1&dnt=1")
        default: nil
        }
    }

    /// A YouTube video's thumbnail.
    public static func thumbnail(_ source: Source) -> URL? {
        if case .youtube(let id, _) = source { return URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg") }
        return nil
    }

    /// Who hosts a video elsewhere, for its play card ("YouTube", "Vimeo", or the site's host).
    public static func host(_ source: Source) -> String {
        switch source {
        case .youtube: "YouTube"
        case .vimeo: "Vimeo"
        default: URL(string: source.url)?.host() ?? "the web"
        }
    }

    /// Stored files by the VM link they were saved from (the chat shows the stored copy in place of the link).
    public static func bySource(_ artifacts: [ChatArtifact]) -> [String: ChatArtifact] {
        Dictionary(artifacts.compactMap { artifact in artifact.source.map { ($0, artifact) } }, uniquingKeysWith: { _, last in last })
    }
}
