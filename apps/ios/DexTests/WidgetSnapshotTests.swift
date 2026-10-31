import DexCore
import SwiftUI
import Testing
import UIKit
import WidgetKit
@testable import Dex

/// The widgets' views, drawn at their sizes on an iPhone 18 Pro (WidgetKit's previews can't be captured) in light and
/// dark, saved as one sheet per appearance to `apps/ios/artifacts/widgets/` (or `$DEX_SCREENSHOTS/../widgets`).
@MainActor
@Suite struct WidgetSnapshotTests {
    /// Widget sizes on a 402-point-wide iPhone.
    static let small = CGSize(width: 170, height: 170)
    static let medium = CGSize(width: 364, height: 170)
    static let large = CGSize(width: 364, height: 382)
    static let circular = CGSize(width: 76, height: 76)
    static let rectangular = CGSize(width: 172, height: 76)

    let palette = WidgetPalette.standard
    let items = WidgetSamples.items()

    static var folder: URL {
        if let shots = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"], !shots.isEmpty {
            return URL(fileURLWithPath: shots).deletingLastPathComponent().appending(path: "widgets")
        }
        // apps/ios/DexTests/<this file> → apps/ios/artifacts/widgets
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "artifacts/widgets")
    }

    /// A home-screen widget as the system draws it: its content margins on its background, in a rounded rectangle.
    private func home(_ content: some View, _ size: CGSize, tint: Color) -> some View {
        content
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(WidgetBackdrop(tint: tint))
            .clipShape(.rect(cornerRadius: 24, style: .continuous))
    }

    /// A Lock Screen widget: white, on a wallpaper.
    private func lock(_ content: some View, _ size: CGSize) -> some View {
        content
            .frame(width: size.width, height: size.height)
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }

    private func sheet(_ scheme: ColorScheme) -> some View {
        let atlas = items[0]
        let muse = items[1]
        let accent = palette.accent
        let onAccent = palette.onAccent
        return VStack(alignment: .leading, spacing: 14) {
            label("Sidekick · small (unread, read) and medium")
            HStack(spacing: 20) {
                home(SidekickWidgetView(content: .sidekick(atlas), family: .systemSmall, accent: accent, onAccent: onAccent), Self.small, tint: AgentColors.color(atlas.sidekick.color))
                home(SidekickWidgetView(content: .sidekick(muse), family: .systemSmall, accent: accent, onAccent: onAccent), Self.small, tint: AgentColors.color(muse.sidekick.color))
            }
            home(SidekickWidgetView(content: .sidekick(atlas), family: .systemMedium, accent: accent, onAccent: onAccent), Self.medium, tint: AgentColors.color(atlas.sidekick.color))
            home(SidekickWidgetView(content: .sidekick(items[2]), family: .systemMedium, accent: accent, onAccent: onAccent), Self.medium, tint: AgentColors.color(items[2].sidekick.color))
            label("Sidekick · Lock Screen")
            HStack(spacing: 16) {
                lock(SidekickWidgetView(content: .sidekick(atlas), family: .accessoryCircular, accent: accent), Self.circular)
                lock(SidekickWidgetView(content: .sidekick(atlas), family: .accessoryRectangular, accent: accent), Self.rectangular)
                lock(SidekickWidgetView(content: .signedOut, family: .accessoryRectangular, accent: accent), Self.rectangular)
            }
            .padding(10)
            .background(LinearGradient(colors: [.indigo, .purple.opacity(0.7)], startPoint: .top, endPoint: .bottom), in: .rect(cornerRadius: 16))
            label("Sidekicks · medium and large")
            home(SidekicksWidgetView(content: .sidekicks(items, unread: 3), family: .systemMedium, accent: accent, onAccent: onAccent), Self.medium, tint: accent)
            home(SidekicksWidgetView(content: .sidekicks(items + items.map(Self.renamed), unread: 5), family: .systemLarge, accent: accent, onAccent: onAccent), Self.large, tint: accent)
            label("Signed out, none yet, offline")
            HStack(spacing: 20) {
                home(SidekickWidgetView(content: .signedOut, family: .systemSmall, accent: accent), Self.small, tint: accent)
                home(SidekickWidgetView(content: .noSidekicks, family: .systemSmall, accent: accent), Self.small, tint: accent)
            }
            home(SidekicksWidgetView(content: .unavailable, family: .systemMedium, accent: accent), Self.medium, tint: accent)
        }
        .padding(20)
        .background(Color(uiColor: .systemGroupedBackground))
        .environment(\.colorScheme, scheme)
    }

    /// A second row of sidekicks for the large widget.
    static func renamed(_ item: WidgetSidekickItem) -> WidgetSidekickItem {
        var sidekick = item.sidekick
        sidekick.id += "-2"
        sidekick.name = ["Atlas": "Juno", "Muse": "Pip", "Sage": "Orbit", "Rex": "Nova"][sidekick.name] ?? sidekick.name
        sidekick.unread = false
        sidekick.busy = false
        return WidgetSidekickItem(sidekick, picture: item.picture)
    }

    @Test func drawsEveryWidget() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        for (scheme, name) in [(ColorScheme.light, "light"), (.dark, "dark")] {
            let renderer = ImageRenderer(content: sheet(scheme))
            renderer.scale = 3
            let image = try #require(renderer.uiImage, "renders")
            #expect(image.size.width > 400 && image.size.height > 1_000)
            try #require(image.pngData()).write(to: Self.folder.appending(path: "widgets-\(name).png"))
        }
    }

    @Test func gridPicksUnreadFirstAndKeepsOrder() {
        let many = items + items.map(Self.renamed)
        #expect(SidekicksWidgetView.capacity(.systemMedium) == 4 && SidekicksWidgetView.capacity(.systemLarge) == 8)
        #expect(SidekicksWidgetView.shown(items, capacity: 4).map(\.id) == items.map(\.id))
        // Five of eight on a four-wide widget: Atlas and Rex (unread) stay, in order.
        let shown = SidekicksWidgetView.shown(Array(many.prefix(5)), capacity: 2)
        #expect(shown.map(\.id) == ["atlas", "rex"])
    }

    @Test func paletteRoundTrips() throws {
        let defaults = try #require(UserDefaults(suiteName: "dex.tests.\(UUID().uuidString)"))
        #expect(WidgetPalette.load(from: defaults) == .standard)
        let ocean = WidgetPalette(light: 0x2563EB, dark: 0x60A5FA)
        ocean.save(to: defaults)
        #expect(WidgetPalette.load(from: defaults) == ocean)
    }
}
