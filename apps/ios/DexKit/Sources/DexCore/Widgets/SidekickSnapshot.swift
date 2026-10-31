import Foundation

// What the home-screen widgets show, and how they get it: `GET /api/sidekicks` (apps/web/src/routes/api.sidekicks.ts)
// with the app's session, kept in the App Group the app shares with its widget extension.

/// The App Group the app shares with its widgets: the latest snapshot and the sidekicks' pictures (files), the theme's
/// accent (defaults), and the session (the Keychain, with the group as its access group).
public enum AppGroup {
    public static let id = "group.dev.trydex.Dex"

    /// The group's folder, or nil where the entitlement is missing (tests on macOS, an unsigned build).
    public static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) }
    public static var defaults: UserDefaults? { UserDefaults(suiteName: id) }

    /// The session the widgets fetch with: a copy of the app's, readable by the extension.
    public static let credentials = CredentialStore(service: "dev.trydex.app.widgets", accessGroup: id)

    /// The theme's accent (light and dark, as 0xRRGGBB), for the widgets.
    public static let accentKey = "dex.widget.accent"
}

/// One sidekick on a widget.
public struct WidgetSidekick: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var tagline: String
    public var color: String
    /// Their picture as a data: URL (PNG or WebP); left out with `?images=0`, and kept as a file in the store.
    public var image: String?
    /// An emoji, from before looks; empty shows the name's initial.
    public var avatar: String
    public var sessionId: String
    /// They said something you haven't seen.
    public var unread: Bool
    /// They're answering right now.
    public var busy: Bool
    /// Their latest words, shortened.
    public var lastReply: String?
    public var repliedAt: Double?

    public init(id: String, name: String, tagline: String = "", color: String = "violet", image: String? = nil, avatar: String = "", sessionId: String,
                unread: Bool = false, busy: Bool = false, lastReply: String? = nil, repliedAt: Double? = nil) {
        self.id = id; self.name = name; self.tagline = tagline; self.color = color; self.image = image; self.avatar = avatar; self.sessionId = sessionId
        self.unread = unread; self.busy = busy; self.lastReply = lastReply; self.repliedAt = repliedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, tagline, color, image, avatar, sessionId, unread, busy, lastReply, repliedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        tagline = c.value(.tagline, default: "")
        color = c.value(.color, default: "violet")
        image = c.value(.image, default: nil)
        avatar = c.value(.avatar, default: "")
        sessionId = c.value(.sessionId, default: "")
        unread = c.value(.unread, default: false)
        busy = c.value(.busy, default: false)
        lastReply = c.value(.lastReply, default: nil)
        repliedAt = c.value(.repliedAt, default: nil)
    }

    /// What their face shows without a picture: the emoji, else the name's first letter.
    public var glyph: String {
        if !avatar.isEmpty { return avatar }
        return name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
    }

    /// Their latest words, else their tagline (what a widget with room for a line says under their name).
    public var line: String {
        if let lastReply, !lastReply.isEmpty { return lastReply }
        return tagline
    }

    /// The picture's bytes, from its data: URL.
    public var imageData: Data? {
        guard let image, image.hasPrefix("data:"), let comma = image.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(image[image.index(after: comma)...]))
    }
}

/// Every sidekick, and how many chats are unread (the app icon's badge).
public struct SidekickSnapshot: Codable, Sendable, Hashable {
    public var unread: Int
    public var sidekicks: [WidgetSidekick]
    /// When this was fetched or written (ms since 1970). Not on the wire.
    public var updatedAt: Double

    public init(unread: Int = 0, sidekicks: [WidgetSidekick] = [], updatedAt: Double = .nowMs) {
        self.unread = unread; self.sidekicks = sidekicks; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case unread, sidekicks, updatedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        unread = c.value(.unread, default: 0)
        sidekicks = c.value(.sidekicks, default: [])
        updatedAt = c.value(.updatedAt, default: 0)
    }

    /// The same snapshot from the app's synced state (what `widgetSnapshot` builds on the agent), pictures included.
    public init(state: DexState, now: Double = .nowMs) {
        let sidekicks = state.characters.map { character in
            let session = state.session(character.sessionId)
            return WidgetSidekick(id: character.id, name: character.name, tagline: character.tagline, color: character.color, image: character.image,
                                  avatar: character.avatar, sessionId: character.sessionId, unread: session?.unread ?? false, busy: session?.busy ?? false,
                                  lastReply: session?.lastReply, repliedAt: session?.repliedAt)
        }
        self.init(unread: state.unreadCount, sidekicks: sidekicks, updatedAt: now)
    }

    public func sidekick(_ id: String?) -> WidgetSidekick? { id.flatMap { id in sidekicks.first { $0.id == id } } }

    /// Sidekicks with something unread.
    public var unreadSidekicks: Int { sidekicks.filter(\.unread).count }

    /// The same, without pictures (the store keeps them as files).
    public var withoutImages: SidekickSnapshot {
        var copy = self
        for index in copy.sidekicks.indices { copy.sidekicks[index].image = nil }
        return copy
    }

    /// Whether there's no change worth redrawing a widget for (the time it was written aside).
    public func sameContent(as other: SidekickSnapshot?) -> Bool {
        guard let other else { return false }
        return unread == other.unread && sidekicks == other.sidekicks
    }
}

/// The widgets' copy of the snapshot and the pictures, in the App Group container: `snapshot.json` (no pictures) and
/// one file per sidekick's picture.
public struct WidgetStore: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
        try? FileManager.default.createDirectory(at: root.appending(path: "pictures"), withIntermediateDirectories: true)
    }

    /// The store in the App Group, where there is one.
    public static var shared: WidgetStore? { AppGroup.container.map { WidgetStore(root: $0.appending(path: "Widgets")) } }

    /// Pictures fetched longer ago than this are fetched again (a sidekick may have a new one).
    public static let pictureLifetime: Double = 6 * 3_600_000

    private var snapshotURL: URL { root.appending(path: "snapshot.json") }
    /// When the pictures were written, and for which sidekicks (some have none).
    private var picturesURL: URL { root.appending(path: "pictures.json") }
    private struct Pictures: Codable {
        var at: Double
        var ids: [String]
    }
    private func pictureURL(_ id: String) -> URL {
        root.appending(path: "pictures/\(String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })).img")
    }

    public func load() -> SidekickSnapshot? {
        guard let data = try? Data(contentsOf: snapshotURL) else { return nil }
        return try? JSONDecoder().decode(SidekickSnapshot.self, from: data)
    }

    /// Keeps a snapshot. With `pictures` (it came with them), each sidekick's picture is written, and removed for one
    /// without; otherwise the pictures already kept stay.
    public func save(_ snapshot: SidekickSnapshot, pictures: Bool) {
        if pictures {
            for sidekick in snapshot.sidekicks {
                let url = pictureURL(sidekick.id)
                if let data = sidekick.imageData {
                    if (try? Data(contentsOf: url)) != data { try? data.write(to: url, options: .atomic) }
                } else {
                    try? FileManager.default.removeItem(at: url)
                }
            }
            let record = Pictures(at: snapshot.updatedAt, ids: snapshot.sidekicks.map(\.id))
            if let data = try? JSONEncoder().encode(record) { try? data.write(to: picturesURL, options: .atomic) }
        }
        if let data = try? JSONEncoder().encode(snapshot.withoutImages) { try? data.write(to: snapshotURL, options: .atomic) }
    }

    /// A sidekick's kept picture.
    public func picture(_ id: String) -> Data? { try? Data(contentsOf: pictureURL(id)) }

    private var pictures: Pictures? { (try? Data(contentsOf: picturesURL)).flatMap { try? JSONDecoder().decode(Pictures.self, from: $0) } }

    /// Whether the kept pictures are recent enough to fetch without them (`?images=0`).
    public func picturesAreRecent(now: Double = .nowMs) -> Bool {
        guard let at = pictures?.at else { return false }
        return now - at < Self.pictureLifetime
    }

    /// Whether the kept pictures cover these sidekicks (a new one needs a fetch with pictures).
    public func hasPictures(for snapshot: SidekickSnapshot) -> Bool {
        guard let ids = pictures?.ids else { return false }
        return Set(snapshot.sidekicks.map(\.id)).isSubset(of: ids)
    }

    /// Forgets everything (signing out).
    public func clear() {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.createDirectory(at: root.appending(path: "pictures"), withIntermediateDirectories: true)
    }
}

/// Fetching the snapshot from Dex, as the widgets do (`GET /api/sidekicks` with the `dex_session` cookie, no Origin).
public enum WidgetFeed {
    public enum Failure: Error, Equatable {
        /// The session ended: sign in again in the app.
        case signedOut
        /// Dex is updating (503): try again after this many seconds.
        case unavailable(retryAfter: Double)
        case http(Int)
        case offline
    }

    public static func request(server: URL, token: String, images: Bool) -> URLRequest {
        var url = server.appending(path: "api/sidekicks")
        if !images { url.append(queryItems: [URLQueryItem(name: "images", value: "0")]) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("dex_session=\(token)", forHTTPHeaderField: "Cookie")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    /// Reads an answer: the snapshot, or why there isn't one.
    public static func decode(_ data: Data, status: Int, retryAfter: String?, now: Double = .nowMs) throws(Failure) -> SidekickSnapshot {
        switch status {
        case 200..<300:
            guard var snapshot = try? JSONDecoder().decode(SidekickSnapshot.self, from: data) else { throw .http(status) }
            snapshot.updatedAt = now
            return snapshot
        case 401, 403: throw .signedOut
        case 503: throw .unavailable(retryAfter: retryAfter.flatMap(Double.init) ?? 2)
        default: throw .http(status)
        }
    }

    /// One fetch; a 503 (an agent restarting onto a new build) is asked again once, shortly after.
    public static func fetch(server: URL, token: String, images: Bool, session: URLSession = .shared) async throws(Failure) -> SidekickSnapshot {
        var attempt = 0
        while true {
            attempt += 1
            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request(server: server, token: token, images: images))
            } catch {
                throw .offline
            }
            let http = response as? HTTPURLResponse
            do {
                return try decode(data, status: http?.statusCode ?? 0, retryAfter: http?.value(forHTTPHeaderField: "retry-after"))
            } catch .unavailable(let after) where attempt == 1 {
                try? await Task.sleep(for: .seconds(min(max(after, 0.5), 4)))
            }
        }
    }
}

/// What a widget has to show after trying to refresh.
public enum WidgetLoad: Sendable, Equatable {
    /// No session to fetch with (never signed in, signed out, or the session ended).
    case signedOut
    /// The snapshot; `stale` when Dex couldn't be reached and this is the last one kept.
    case ready(SidekickSnapshot, stale: Bool)
    /// Dex couldn't be reached and nothing is kept yet.
    case unavailable
}

public extension WidgetFeed {
    /// Refreshes the kept snapshot from Dex: without pictures while the kept ones are recent and cover everyone, with
    /// them otherwise. Falls back to what's kept when Dex can't be reached.
    static func load(store: WidgetStore?, credentials: Credentials?, session: URLSession = .shared, now: Double = .nowMs) async -> WidgetLoad {
        let kept = store?.load()
        guard let credentials, !credentials.isExpired(now: Date(timeIntervalSince1970: now / 1000)) else { return .signedOut }
        do {
            let lean = kept != nil && store?.picturesAreRecent(now: now) == true
            var fresh = try await fetch(server: credentials.server, token: credentials.token, images: !lean, session: session)
            var pictures = !lean
            if lean, store?.hasPictures(for: fresh) != true {
                fresh = try await fetch(server: credentials.server, token: credentials.token, images: true, session: session)
                pictures = true
            }
            store?.save(fresh, pictures: pictures)
            return .ready(fresh.withoutImages, stale: false)
        } catch .signedOut {
            return .signedOut
        } catch {
            return kept.map { .ready($0, stale: true) } ?? .unavailable
        }
    }
}

/// Links into the app (`dex://`), which `Router.handle` opens.
public enum DexLink {
    /// A chat; `compose` puts the caret in its message box.
    public static func chat(_ sessionId: String, compose: Bool = false) -> URL {
        var components = URLComponents()
        components.scheme = "dex"
        components.host = "chat"
        components.path = "/" + sessionId
        if compose { components.queryItems = [URLQueryItem(name: "compose", value: "1")] }
        return components.url ?? URL(string: "dex://new")!
    }

    public static let notificationSettings = URL(string: "dex://settings/notifications")!
    /// Making a sidekick (from a widget with none to show).
    public static let newSidekick = URL(string: "dex://sidekicks/new")!
}
