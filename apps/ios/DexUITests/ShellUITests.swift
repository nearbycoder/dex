import XCTest

final class ShellUITests: DexUITestCase {
    func testLaunchShowsInbox() {
        launch()
        if !isRegularWidth { XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10)) }
        XCTAssertTrue(app.staticTexts["Plan a weekend in Lisbon"].waitForExistence(timeout: 10))
        snapshot("inbox")
    }
}
