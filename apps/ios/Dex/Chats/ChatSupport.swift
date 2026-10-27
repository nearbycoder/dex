import AVFoundation
import DexCore
import Observation
import SwiftUI
import UIKit

/// Chats whose title is being rewritten, so the header and the inbox can show it's on its way.
@MainActor
@Observable
final class TitleNaming {
    static let shared = TitleNaming()
    private(set) var naming: Set<String> = []

    func isNaming(_ id: String) -> Bool { naming.contains(id) }

    /// Asks the agent for a new title from the chat's messages (once at a time per chat).
    func regenerate(_ id: String, client: DexClient) {
        guard !naming.contains(id) else { return }
        naming.insert(id)
        Task {
            defer { naming.remove(id) }
            do { _ = try await ChatActions.regenerateTitle(id, client: client) } catch {
                client.notice = "Couldn't regenerate the title: \(error.localizedDescription)"
            }
        }
    }
}

/// Chat actions that don't need the chat to be open (no event subscription).
enum ChatActions {
    static func settle(_ id: String, _ settled: Bool, client: DexClient) async throws {
        try await client.run("triageSession", .string(id), ["settled": .bool(settled)])
    }
    static func snooze(_ id: String, until: Double?, client: DexClient) async throws {
        try await client.run("triageSession", .string(id), ["snoozedUntil": until.map(JSONValue.number) ?? .null])
    }
    static func rename(_ id: String, to title: String, client: DexClient) async throws {
        try await client.run("renameSession", .string(id), .string(title))
    }
    static func regenerateTitle(_ id: String, client: DexClient) async throws -> String {
        try await client.call("regenerateSessionTitle", .string(id), timeout: 60)
    }
    static func mute(_ id: String, _ muted: Bool, client: DexClient) async throws {
        try await client.run("setSessionMuted", .string(id), .bool(muted))
    }
    static func delete(_ id: String, client: DexClient) async throws {
        try await client.run("deleteSession", .string(id), timeout: 60)
    }
}

/// "6:00 PM" today, else "Sat 9:00 AM" (the time a snooze option wakes the chat).
func snoozeTime(_ date: Date) -> String {
    let time = date.formatted(date: .omitted, time: .shortened)
    return Calendar.current.isDateInToday(date) ? time : "\(date.formatted(.dateTime.weekday(.abbreviated))) \(time)"
}

/// What the message box holds, shared by the chat so a message's "Edit" can put its text back in the box.
@MainActor
@Observable
final class ComposerModel {
    var text = ""
    /// Files attached to the message being written (see Attachments.swift).
    var attachments: [DraftAttachment] = []
    /// Bumped to put the caret in the box.
    var focusRequest = 0

    func fill(_ text: String) {
        self.text = text
        focusRequest += 1
    }
}

/// Loads media Dex stores (`/api/media/…`) with the session cookie, and keeps recent images in memory.
@MainActor
final class MediaLoader {
    static let shared = MediaLoader()
    private let images = NSCache<NSString, UIImage>()

    /// The mock agent's server: there's nothing to fetch, so media shows as a drawn placeholder.
    static func isMock(_ server: URL?) -> Bool { server?.host() == "mock.dex.local" }

    func cached(_ key: String) -> UIImage? { images.object(forKey: key as NSString) }

    func image(_ url: URL, client: DexClient) async throws -> UIImage {
        if let image = cached(url.absoluteString) { return image }
        let image: UIImage
        if Self.isMock(client.server) {
            image = Self.placeholder(seed: url.lastPathComponent)
        } else {
            let own = client.server.map { url.host() == $0.host() } ?? false
            let request = DexHTTP.request(url, token: own ? client.credentials?.token : nil)
            let (data, response) = try await DexHTTP.session.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { throw URLError(.badServerResponse) }
            guard let decoded = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
            image = decoded
        }
        images.setObject(image, forKey: url.absoluteString as NSString)
        return image
    }

    /// A screenshot left out of the transcript, loaded by its ref (once per chat and ref).
    func screenshot(ref: String, feed: ChatFeed) async throws -> UIImage? {
        let key = "\(feed.sessionId):\(ref)"
        if let image = cached(key) { return image }
        guard let loaded = try await feed.image(ref: ref), let image = UIImage(data: loaded.data) else { return nil }
        images.setObject(image, forKey: key as NSString)
        return image
    }

    /// An asset for AVPlayer that sends the session cookie to Dex.
    func asset(_ url: URL, client: DexClient) -> AVURLAsset {
        var options: [String: Any] = [:]
        if let server = client.server, let token = client.credentials?.token, url.host() == server.host(),
           let cookie = DexHTTP.cookie(server: server, token: token) {
            options[AVURLAssetHTTPCookiesKey] = [cookie]
        }
        return AVURLAsset(url: url, options: options)
    }

    /// A soft gradient picture with a chart-like shape (mock media).
    static func placeholder(seed: String) -> UIImage {
        let size = CGSize(width: 640, height: 400)
        return UIGraphicsImageRenderer(size: size).image { context in
            let hue = CGFloat(abs(seed.hashValue % 360)) / 360
            let colors = [UIColor(hue: hue, saturation: 0.5, brightness: 0.95, alpha: 1).cgColor, UIColor(hue: hue, saturation: 0.7, brightness: 0.6, alpha: 1).cgColor]
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])!
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            UIColor.white.withAlphaComponent(0.85).setFill()
            for (index, height) in [120, 180, 150, 210, 260, 190, 230].enumerated() {
                context.fill(CGRect(x: 60 + index * 76, y: 340 - height, width: 48, height: height))
            }
        }
    }
}

extension View {
    /// The pulse the web shows while a title is being written ("animate-pulse").
    func namingPulse(_ active: Bool) -> some View {
        modifier(NamingPulse(active: active))
    }
}

private struct NamingPulse: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View {
        if active {
            content
                .foregroundStyle(.secondary)
                .phaseAnimator([1.0, 0.4]) { view, phase in view.opacity(phase) } animation: { _ in .easeInOut(duration: 0.8) }
                .accessibilityLabel("Writing a new title")
        } else {
            content
        }
    }
}
