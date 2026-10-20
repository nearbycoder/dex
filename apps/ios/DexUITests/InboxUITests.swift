import XCTest

/// The chat list as an inbox: groups, swipe actions, the long-press menu, and keyboard navigation.
final class InboxUITests: ChatTestCase {
    func row(_ id: String) -> XCUIElement { app.descendants(matching: .any)["chat.row.\(id)"].firstMatch }

    @discardableResult
    func wait(_ element: XCUIElement, _ format: String, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    func header(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// Scrolls the list until an element is on screen (rows below the fold aren't loaded).
    func reveal(_ element: XCUIElement) {
        let list = app.collectionViews["chats.list"]
        for _ in 0..<5 where !(element.exists && element.isHittable) { list.swipeUp() }
    }

    /// Opens a collapsed group by tapping its header.
    func expand(_ id: String, showing rowId: String) {
        reveal(header(id))
        if row(rowId).exists { return }
        header(id).tap()
        reveal(row(rowId))
        XCTAssertTrue(row(rowId).waitForExistence(timeout: 5), "\(id) opens")
    }

    /// Waits for a group's header to show a count.
    func expectCount(_ id: String, _ count: Int) {
        reveal(header(id))
        XCTAssertTrue(wait(header(id), "label CONTAINS ', \(count) chats'"), "\(id) has \(count)")
    }

    func testGroupsAndRows() {
        launch()
        XCTAssertTrue(row("s-welcome").waitForExistence(timeout: 10))
        reveal(header("inbox.settled"))
        XCTAssertTrue(header("inbox.snoozed").exists)
        XCTAssertTrue(header("inbox.settled").exists)
        XCTAssertTrue(row("s-vm").label.contains("PR Author"), "a project chat shows its project and agent: \(row("s-vm").label)")
        snapshot("inbox")
        expand("inbox.snoozed", showing: "s-snoozed")
        XCTAssertTrue(row("s-snoozed").label.contains("until"), "a snoozed chat says when it wakes")
        expand("inbox.settled", showing: "s-settled")
        snapshot("inbox-expanded")
    }

    func testSwipeToSettleAndBack() {
        launch()
        let chat = row("s-chart")
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.swipeRight()
        // A long swipe (iPad) settles it outright; a short one shows the button.
        if app.buttons["Settle"].waitForExistence(timeout: 2) { app.buttons["Settle"].firstMatch.tap() }
        expectCount("inbox.settled", 2)
        expand("inbox.settled", showing: "s-chart")
        row("s-chart").swipeRight()
        if app.buttons["Inbox"].waitForExistence(timeout: 2) { app.buttons["Inbox"].firstMatch.tap() }
        expectCount("inbox.settled", 1)
    }

    func testSwipeToSnoozeAndUnsnooze() {
        launch()
        let chat = row("s-welcome")
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.swipeLeft()
        app.buttons["Snooze"].firstMatch.tap()
        let tomorrow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Tomorrow'")).firstMatch
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        expectCount("inbox.snoozed", 2)
        expand("inbox.snoozed", showing: "s-welcome")
        row("s-welcome").swipeLeft()
        app.buttons["Unsnooze"].firstMatch.tap()
        expectCount("inbox.snoozed", 1)
    }

    func testSwipeToDelete() {
        launch()
        XCTAssertTrue(row("s-welcome").waitForExistence(timeout: 10))
        let chat = row("s-settled")
        expand("inbox.settled", showing: "s-settled")
        chat.swipeLeft()
        app.buttons["Delete"].firstMatch.tap()
        app.buttons["Delete Chat"].firstMatch.tap()
        XCTAssertTrue(wait(chat, "exists == false"))
    }

    func testContextMenu() {
        launch()
        let chat = row("s-vm")
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Regenerate Title"].waitForExistence(timeout: 5))
        snapshot("inbox-menu")
        app.buttons["Regenerate Title"].tap()
        XCTAssertTrue(wait(chat, "label CONTAINS 'Regenerated'"))

        chat.press(forDuration: 1.2)
        app.buttons["Snooze Until"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Next week'")).firstMatch.tap()
        expectCount("inbox.snoozed", 2)
        expand("inbox.snoozed", showing: "s-vm")

        row("s-vm").press(forDuration: 1.2)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Unsnooze'")).firstMatch.tap()
        expectCount("inbox.snoozed", 1)
        app.collectionViews["chats.list"].swipeDown()

        row("s-vm").press(forDuration: 1.2)
        app.buttons["Settle"].firstMatch.tap()
        expand("inbox.settled", showing: "s-vm")
        reveal(row("s-vm"))

        row("s-vm").press(forDuration: 1.2)
        app.buttons["Mute"].firstMatch.tap()
        XCTAssertTrue(wait(row("s-vm"), "label CONTAINS 'Muted'"))

        row("s-vm").press(forDuration: 1.2)
        app.buttons["Delete"].firstMatch.tap()
        app.buttons["Delete Chat"].firstMatch.tap()
        XCTAssertTrue(wait(row("s-vm"), "exists == false"))
    }

    func testBusyChatShowsWorking() {
        launch(["-DexOpenChat", "s-welcome"])
        let box = app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"]
        XCTAssertTrue(box.waitForExistence(timeout: 10))
        box.tap()
        box.typeText("Hold on a moment")
        app.buttons["composer.send"].tap()
        if !isRegularWidth { app.navigationBars.buttons.firstMatch.tap() }
        XCTAssertTrue(wait(row("s-welcome"), "label CONTAINS 'working'"))
        snapshot("inbox-working")
    }

    func testKeyboardMovesThroughTheList() throws {
        launch()
        guard isRegularWidth else { throw XCTSkip("Arrow keys move through the list on iPad (hardware keyboard).") }
        XCTAssertTrue(row("s-welcome").waitForExistence(timeout: 10))
        row("s-welcome").tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat.transcript"].waitForExistence(timeout: 10))
        row("s-welcome").tap()
        app.typeKey(.downArrow, modifierFlags: [])
        XCTAssertTrue(titleButton("Fix the flaky test").waitForExistence(timeout: 5), "↓ opens the next chat")
        app.typeKey(.upArrow, modifierFlags: [])
        XCTAssertTrue(titleButton("Plan a weekend").waitForExistence(timeout: 5), "↑ goes back")
    }

    func testNewChatShortcut() throws {
        launch()
        XCTAssertTrue(row("s-welcome").waitForExistence(timeout: 10))
        row("s-welcome").tap()
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(app.descendants(matching: .any)["newchat.heading"].waitForExistence(timeout: 5), "⌘N starts a new chat")
    }
}
