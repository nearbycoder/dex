import CoreGraphics
import Foundation
import Testing
@testable import Dex

/// Where the chat's floating VM preview rests and how it snaps.
@MainActor
@Suite struct MachinePreviewTests {
    let bounds = PreviewBounds(size: CGSize(width: 400, height: 800))
    let box = CGSize(width: 52, height: 52)

    @Test func spotsRoundTrip() {
        #expect(PreviewSpot(raw: PreviewSpot(right: false, y: 0.25).raw) == PreviewSpot(right: false, y: 0.25))
        #expect(PreviewSpot(raw: "garbage") == PreviewSpot(right: true, y: 0.85))
        #expect(PreviewSpot(right: true, y: 4).y == 1)
    }

    @Test func restsAgainstASide() {
        let right = bounds.origin(PreviewSpot(right: true, y: 0), size: box)
        #expect(right == CGPoint(x: 400 - PreviewBounds.margin - 52, y: PreviewBounds.top))
        let left = bounds.origin(PreviewSpot(right: false, y: 1), size: box)
        #expect(left == CGPoint(x: PreviewBounds.margin, y: 800 - PreviewBounds.bottom - 52))
    }

    @Test func snapsToTheNearerSide() {
        // Dropped left of the middle: snaps left, at the same height.
        let spot = bounds.spot(at: CGPoint(x: 120, y: 300), size: box)
        #expect(!spot.right)
        #expect(abs(bounds.origin(spot, size: box).y - 300) < 0.001)
        // Dropped past the bottom: rests at the lowest spot, never over the composer.
        let low = bounds.spot(at: CGPoint(x: 300, y: 2_000), size: box)
        #expect(low.right && low.y == 1)
    }

    @Test func keepsItsPlaceWhenTheAreaShrinks() {
        // The keyboard opens: the same spot maps into the smaller area.
        let spot = PreviewSpot(right: true, y: 1)
        let small = PreviewBounds(size: CGSize(width: 400, height: 300))
        let origin = small.origin(spot, size: box)
        #expect(origin.y + box.height <= 300 - PreviewBounds.bottom + 0.001)
        // Too small for any room: pinned to the top.
        let tiny = PreviewBounds(size: CGSize(width: 400, height: 100))
        #expect(tiny.origin(spot, size: box).y == PreviewBounds.top)
    }
}
