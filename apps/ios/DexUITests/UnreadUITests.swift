import XCTest

/// Unread chats and sidekicks, Mark as Unread, scheduled notes, and a sidekick's notification setting, on the mock agent
/// (Atlas checked in on a schedule while you were away; "Site traffic this week" has a reply you haven't seen).
final class UnreadUITests: ChatTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    func sidekick(_ id: String) -> XCUIElement { element("character.row.\(id)") }
    func chat(_ id: String) -> XCUIElement { element("chat.row.\(id)") }

    func text(_ words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    @discardableResult
    func wait(_ element: XCUIElement, _ format: String, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    /// Back to the chat list (compact width pushes the chat over it).
    func backToList() {
        guard !isRegularWidth else { return }
        let back = app.buttons["BackButton"].firstMatch
        if back.waitForExistence(timeout: 3) { back.tap() } else { app.navigationBars.buttons.element(boundBy: 0).tap() }
    }

    func testUnreadSidekickAndScheduledNote() {
        launch()
        let atlas = sidekick("atlas")
        XCTAssertTrue(atlas.waitForExistence(timeout: 10))
        // Unread: a dot, and what he said instead of his tagline.
        XCTAssertTrue(atlas.label.contains("Unread"), atlas.label)
        XCTAssertTrue(atlas.label.contains("Quick check-in"), "his latest words: \(atlas.label)")
        XCTAssertFalse(sidekick("muse").label.contains("Unread"), sidekick("muse").label)
        XCTAssertTrue(chat("s-chart").label.contains("Unread"), chat("s-chart").label)
        XCTAssertFalse(chat("s-welcome").label.contains("Unread"))
        snapshot("unread-list")

        // His conversation: the schedule that ran is a note, not a message from you.
        atlas.tap()
        let note = element("chat.scheduled")
        XCTAssertTrue(note.waitForExistence(timeout: 10), "the scheduled prompt shows as a note")
        XCTAssertTrue(note.label.contains("Scheduled: Check in on how the week's plan is going"), note.label)
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'chat.user' AND label CONTAINS 'Scheduled task'")).firstMatch.exists)
        XCTAssertTrue(text("studio lease").exists, "his check-in")
        snapshot("scheduled-note")

        // Seen: no longer unread.
        backToList()
        XCTAssertTrue(wait(sidekick("atlas"), "NOT (label CONTAINS 'Unread')"), sidekick("atlas").label)
        XCTAssertTrue(sidekick("atlas").label.contains("Keeps your life organized"), "his tagline again: \(sidekick("atlas").label)")
    }

    func testMarkAsUnreadAndRead() {
        launch()
        let muse = sidekick("muse")
        XCTAssertTrue(muse.waitForExistence(timeout: 10))
        muse.press(forDuration: 1.2)
        let markUnread = app.buttons["Mark as Unread"].firstMatch
        XCTAssertTrue(markUnread.waitForExistence(timeout: 5))
        snapshot("sidekick-menu")
        markUnread.tap()
        XCTAssertTrue(wait(sidekick("muse"), "label CONTAINS 'Unread'"), sidekick("muse").label)

        // A chat: read from its menu, unread again from a swipe.
        let traffic = chat("s-chart")
        XCTAssertTrue(traffic.waitForExistence(timeout: 5))
        traffic.press(forDuration: 1.2)
        let markRead = app.buttons["Mark as Read"].firstMatch
        XCTAssertTrue(markRead.waitForExistence(timeout: 5))
        markRead.tap()
        XCTAssertTrue(wait(chat("s-chart"), "NOT (label CONTAINS 'Unread')"), chat("s-chart").label)
        chat("s-chart").swipeRight()
        let unread = app.buttons["Unread"].firstMatch
        XCTAssertTrue(unread.waitForExistence(timeout: 5), "the swipe offers Unread beside Settle")
        unread.tap()
        XCTAssertTrue(wait(chat("s-chart"), "label CONTAINS 'Unread'"), chat("s-chart").label)
    }

    func testSidekickBell() {
        launch(["-DexOpenChat", "s-muse"])
        let bell = element("chat.notify")
        // The foldable's cover screen hides the title bar once the chat is scrolled down: a drag down shows it again.
        if !(bell.waitForExistence(timeout: 8) && bell.isHittable) {
            let transcript = element("chat.transcript")
            let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 120)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(bell.waitForExistence(timeout: 10), "a sidekick's chat has their bell")
        XCTAssertTrue(bell.label.contains("every message"), bell.label)
        bell.tap()
        XCTAssertTrue(wait(bell, "label CONTAINS 'are off'"), "off: \(bell.label)")
        snapshot("sidekick-bell-off")
        bell.tap()
        XCTAssertTrue(wait(bell, "label CONTAINS 'every message'"), bell.label)
    }
}
