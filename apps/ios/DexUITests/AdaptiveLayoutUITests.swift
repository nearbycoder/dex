import XCTest

/// Size-class changes (rotating a phone, folding or unfolding a foldable, resizing an iPad window) keep the window's
/// place: the open chat stays open, and the layout switches between the tab bar stack and the sidebar split view.
final class AdaptiveLayoutUITests: DexUITestCase {
    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    func testOpenChatSurvivesRotation() {
        launch(["-DexOpenChat", "s-welcome"])
        XCTAssertTrue(app.staticTexts["Here’s an easy weekend, with time to wander."].waitForExistence(timeout: 10))
        snapshot("adaptive-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.staticTexts["Here’s an easy weekend, with time to wander."].waitForExistence(timeout: 10), "the chat stays open")
        XCTAssertTrue(app.textFields["composer.field"].exists || app.textViews["composer.field"].exists)
        snapshot("adaptive-landscape")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["Here’s an easy weekend, with time to wander."].waitForExistence(timeout: 10))
    }

    func testInboxAndChatAtThisSize() {
        launch()
        XCTAssertTrue(app.staticTexts["Plan a weekend in Lisbon"].waitForExistence(timeout: 10))
        app.staticTexts["Plan a weekend in Lisbon"].tap()
        XCTAssertTrue(app.staticTexts["Here’s an easy weekend, with time to wander."].waitForExistence(timeout: 10))
        if isRegularWidth {
            // Side by side: the inbox stays visible next to the chat.
            XCTAssertTrue(app.staticTexts["Fix the flaky test in dex"].isHittable)
        }
        snapshot("adaptive-chat")
    }
}
