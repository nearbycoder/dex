import XCTest

final class ShellUITests: DexUITestCase {
    func testLaunchShowsInbox() {
        launch()
        // The tab bar (a side rail on the foldable's cover screen; part of the sidebar on iPad).
        XCTAssertTrue(app.buttons["tab.chats"].firstMatch.waitForExistence(timeout: 10) || app.tabBars.firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Plan a weekend in Lisbon"].waitForExistence(timeout: 10))
        snapshot("inbox")
    }
}
