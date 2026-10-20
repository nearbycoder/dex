import XCTest

/// The shell on iPad: pages opened from the sidebar keep their navigation bar clear of the floating tab bar.
final class ShellLayoutUITests: DexUITestCase {
    func testPagesFromTheSidebar() throws {
        launch()
        guard isRegularWidth else { throw XCTSkip("Sidebar layout is for regular width") }
        XCTAssertTrue(app.staticTexts["Plan a weekend in Lisbon"].waitForExistence(timeout: 10))
        snapshot("shell-ipad-chats")
        // Show the sidebar, then open pages from it.
        let toggles = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'sidebar' OR identifier CONTAINS[c] 'sidebar'"))
        snapshot("shell-ipad-sidebar")
        for title in ["Settings", "Agents"] {
            // Picking a page closes the overlay sidebar in portrait: open it again.
            if !app.descendants(matching: .any).matching(NSPredicate(format: "label == 'MCP Servers'")).allElementsBoundByIndex.contains(where: { $0.isHittable }) {
                toggles.element(boundBy: 0).tap()
                sleep(1)
            }
            let matches = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title))
            guard let item = matches.allElementsBoundByIndex.first(where: { $0.isHittable }) else {
                XCTFail("No \(title) in the sidebar")
                return
            }
            item.tap()
            sleep(2)
            snapshot("shell-ipad-\(title.lowercased())")
        }
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        snapshot("shell-ipad-landscape")
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        snapshot("shell-ipad-back")
    }
}
