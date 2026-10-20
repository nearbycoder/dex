import XCTest

/// Scrolling a chat's transcript: the first drag up moves it at once (nothing pulls it back to the bottom while your
/// finger is on it), and it follows the bottom again once you're back there.
final class TranscriptScrollUITests: DexUITestCase {
    private func transcript() -> XCUIElement { app.descendants(matching: .any)["chat.transcript"].firstMatch }

    /// One short, slow drag down (scrolling the content up) from the transcript's middle.
    private func dragUp(by points: CGFloat) {
        let start = transcript().coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: points)), withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    func testFirstDragScrollsAtOnce() {
        launch(["-DexOpenChat", "s-ui-gallery"])
        XCTAssertTrue(transcript().waitForExistence(timeout: 10))
        // Let it settle at the bottom.
        sleep(2)
        dragUp(by: 260)
        XCTAssertTrue(app.buttons["chat.scrollToBottom"].waitForExistence(timeout: 3), "a first short drag scrolls away from the bottom")
        snapshot("transcript-first-drag")
        app.buttons["chat.scrollToBottom"].tap()
        XCTAssertTrue(app.buttons["chat.scrollToBottom"].waitForNonExistence(timeout: 5), "the button brings you back down")
    }
}
