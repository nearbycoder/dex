import XCTest

/// Spaces on the mock agent ("Launch the new site": four threads, one done, one working, one waiting on you, one
/// failed, and two updates back): listed above the chats, the coordinator's chat with its thread cards and update rows,
/// the Threads and Notes panel, a thread's way back to its space, and making and deleting a space.
final class SpacesUITests: ChatTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func waitGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    func testSpaceChatThreadsAndNotes() {
        launch()
        let row = element("space.row.launch")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Launch the new site") && row.label.contains("1 needs you · 1 working · 1 failed"), row.label)
        // Its chats live under it, not in the list.
        XCTAssertFalse(element("chat.row.s-thread-speed").exists)
        snapshot("spaces-list")

        row.tap()
        // The threads it started, as cards with their status, and what two of them reported back.
        let card = element("space.thread.card.s-thread-redirects")
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertEqual(card.value as? String, "Needs you")
        XCTAssertTrue(element("space.update.s-thread-speed").exists)
        XCTAssertTrue(element("space.update.s-thread-sitemap").exists)
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "[Space update]")).firstMatch.exists)
        snapshot("space-chat")

        // The Threads panel: by status, what needs you first.
        element("space.threads").tap()
        XCTAssertTrue(element("space.thread.s-thread-redirects").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Needs you"].exists && app.staticTexts["Failed"].exists)
        snapshot("space-threads")
        app.segmentedControls.buttons["Notes"].tap()
        XCTAssertTrue(app.staticTexts["Decisions"].waitForExistence(timeout: 5))
        snapshot("space-notes")
        app.segmentedControls.buttons["Threads"].tap()

        // A thread: an ordinary chat, with its space a tap away.
        element("space.thread.s-thread-redirects").tap()
        let banner = element("thread.space")
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("Launch the new site"))
        snapshot("space-thread")
        banner.tap()
        XCTAssertTrue(element("space.thread.card.s-thread-redirects").waitForExistence(timeout: 10))
    }

    func testMakeAndDeleteASpace() {
        launch()
        let new = element("spaces.new")
        XCTAssertTrue(new.waitForExistence(timeout: 10))
        new.tap()
        let name = app.textFields["space.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Research vendors")
        snapshot("space-new")
        element("space.save").tap()

        // Straight to its chat, which says what to do.
        XCTAssertTrue(element("space.empty").waitForExistence(timeout: 10))
        XCTAssertTrue(app.navigationBars.staticTexts["Research vendors"].exists || app.navigationBars["Research vendors"].exists)

        // Asking for a thread starts one, as a card.
        let field = app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"]
        field.tap()
        field.typeText("Start a thread to compare pricing")
        element("composer.send").tap()
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "space.thread.card.")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15))

        element("chat.menu").tap()
        element("space.menu.delete").tap()
        let confirm = element("space.delete.confirm")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(waitGone(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Research vendors")).firstMatch))
    }
}
