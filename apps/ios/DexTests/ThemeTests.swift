import Testing
import UIKit
@testable import Dex

/// The color themes in Settings → Appearance.
@MainActor
@Suite struct ThemeTests {
    @Test func tenThemesWithEmeraldFirst() {
        #expect(Theme.all.count == 10)
        #expect(Set(Theme.all.map(\.id)).count == 10)
        #expect(Set(Theme.all.map(\.name)).count == 10)
        #expect(Theme.default.id == "emerald")
    }

    @Test func unknownIdsFallBackToTheDefault() {
        #expect(Theme.named("ocean").name == "Ocean")
        #expect(Theme.named("nope") == .default)
        #expect(Theme.named(nil) == .default)
    }

    @Test func textOnAccentIsReadable() {
        // Light accents (graphite and amber in dark mode) take black text; deep ones take white.
        #expect(UIColor.isLight(0xD4D4D8))
        #expect(UIColor.isLight(0xFBBF24))
        #expect(!UIColor.isLight(0x059669))
        #expect(!UIColor.isLight(0x1D4ED8))
        // Every selection shade (behind white text on selected rows and your messages) is dark enough for white.
        for theme in Theme.all {
            #expect(!UIColor.isLight(theme.selectionLight), "\(theme.id) light")
            #expect(!UIColor.isLight(theme.selectionDark), "\(theme.id) dark")
        }
    }
}
