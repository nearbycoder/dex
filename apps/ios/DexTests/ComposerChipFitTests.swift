import DexCore
import Testing
import SwiftUI
@testable import Dex

/// How much the composer's chips show for the room they have (narrow phones, a foldable's cover screen, large text).
@MainActor
@Suite struct ComposerChipFitTests {
    /// Measured widths of each fit's chips (`shortName` without the model's name).
    let widths: [ComposerChipFit: CGFloat] = [.full: 520, .noSubscription: 450, .noVision: 425, .shortName: 250, .compact: 315, .logoOnly: 140]

    private func fit(_ room: CGFloat?) -> ComposerChipFit { ComposerChips<EmptyView>.fit(widths: widths, room: room) }

    @Test func showsEverythingWhereItFits() {
        #expect(fit(600) == .full)
        #expect(fit(520) == .full)
        #expect(fit(nil) == .full, "before the room is measured")
    }

    @Test func dropsTheSubscriptionThenTheEye() {
        #expect(fit(519) == .noSubscription)
        #expect(fit(430) == .noVision)
    }

    @Test func cutsTheNameShortBeforeTurningThinkingAndMcpIntoIcons() {
        #expect(fit(424) == .shortName)
        #expect(fit(250 + ComposerChipFit.shortNameRoom) == .shortName)
        #expect(fit(250 + ComposerChipFit.shortNameRoom - 1) == .compact)
    }

    @Test func theLogoAloneWhereNotEvenAFewLettersFit() {
        #expect(fit(140 + ComposerChipFit.shortestName) == .compact)
        #expect(fit(140 + ComposerChipFit.shortestName - 1) == .logoOnly)
        #expect(fit(100) == .logoOnly)
    }

    @Test func unmeasuredFitsDontCount() {
        #expect(ComposerChips<EmptyView>.fit(widths: [:], room: 300) == .logoOnly)
    }

    @Test func thinkingBarsRiseWithTheLevel() {
        let levels = ThinkingLevels.all
        #expect(ThinkingPicker.amount("off", of: levels) == 0)
        #expect(ThinkingPicker.amount("minimal", of: levels) == 0.25)
        #expect(ThinkingPicker.amount("xhigh", of: levels) == 1)
        #expect(ThinkingPicker.amount("low", of: levels) < ThinkingPicker.amount("high", of: levels))
        // A model with one level shows it full.
        #expect(ThinkingPicker.amount("high", of: ["high"]) == 1)
    }
}
