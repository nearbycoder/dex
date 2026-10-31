import XCTest

/// Characters on the mock agent (Muse, with a conversation going and an earlier one, and Atlas, with a check-in): pinned above
/// the chats, their conversation (greeting, header, placeholder), their page (from the chat and from Library), making
/// one from a template, editing, Start over, and Delete.
final class CharactersUITests: ChatTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    // MARK: Helpers

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func row(_ id: String) -> XCUIElement { element("character.row.\(id)") }

    func starting(_ prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

    func text(_ words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    var field: XCUIElement { app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"] }

    func waitGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    /// Scrolls the frontmost form (the sheet's, when one is up) until the element can be tapped.
    @discardableResult
    func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        _ = element.waitForExistence(timeout: 4)
        var tries = 0
        while !(element.exists && element.isHittable) && tries < 16 {
            let scroller = app.collectionViews.allElementsBoundByIndex.last { $0.isHittable } ?? app.windows.firstMatch
            if tries < 10 { scroller.swipeUp(velocity: .slow) } else { scroller.swipeDown(velocity: .slow) }
            tries += 1
        }
        XCTAssertTrue(element.exists, "missing \(element)", file: file, line: line)
        if tries > 0 { usleep(700_000) }
        return element
    }

    func tap(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        reveal(element(id), file: file, line: line).tap()
    }

    /// Opens the chat's ⋯ menu and picks an item. On the foldable's cover screen the bar hides after scrolling down.
    func menu(_ item: String) {
        let more = element("chat.menu")
        if !(more.waitForExistence(timeout: 3) && more.isHittable) {
            let transcript = element("chat.transcript")
            let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 120)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        let button = element(item)
        XCTAssertTrue(button.waitForExistence(timeout: 5), "\(item) in the menu")
        button.tap()
    }

    func openChat(_ id: String) {
        launch(["-DexOpenChat", id])
        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 15), "the chat opens")
    }

    /// Back to the chat list (compact width pushes the chat over it).
    func backToList() {
        guard !isRegularWidth else { return }
        let back = app.buttons["BackButton"].firstMatch
        if back.waitForExistence(timeout: 3) { back.tap() }
    }

    // MARK: Tests

    func testPinnedAboveTheChats() {
        launch()
        XCTAssertTrue(row("muse").waitForExistence(timeout: 10), "Muse is pinned")
        XCTAssertTrue(row("atlas").exists)
        XCTAssertTrue(row("muse").label.contains("Your creative sparring partner"), "the tagline: \(row("muse").label)")
        XCTAssertTrue(element("characters.new").exists)
        // Characters sit above the chats; their conversations aren't among them.
        XCTAssertLessThan(row("atlas").frame.minY, element("chat.row.s-welcome").frame.minY)
        XCTAssertFalse(element("chat.row.s-muse").exists)
        XCTAssertFalse(element("chat.row.s-muse-earlier").exists)
        snapshot("characters-list")
    }

    func testGreetingAndHeader() {
        launch()
        XCTAssertTrue(row("atlas").waitForExistence(timeout: 10))
        row("atlas").tap()
        let greeting = element("chat.greeting")
        XCTAssertTrue(greeting.waitForExistence(timeout: 10), "Atlas greets you")
        XCTAssertTrue(greeting.label.contains("What's on your plate?"), greeting.label)
        XCTAssertTrue(element("chat.character").label.contains("Atlas"))
        XCTAssertFalse(element("chat.settle").exists, "no inbox triage in a character's conversation")
        XCTAssertTrue((field.placeholderValue ?? "").contains("Message Atlas…") || "\(field.value ?? "")".contains("Message Atlas…"), "the composer says who you're talking to")
        snapshot("character-greeting")

        // A reply comes from Atlas, under his greeting.
        field.tap()
        field.typeText("Plan my week")
        app.buttons["composer.send"].tap()
        XCTAssertTrue(text("answer to").waitForExistence(timeout: 15), "Atlas answers")
        XCTAssertTrue(greeting.exists)
        snapshot("character-reply")
    }

    func testConversationAndPage() {
        openChat("s-muse")
        XCTAssertTrue(text("Mud Club has a secret-society feel").waitForExistence(timeout: 10))
        XCTAssertTrue(element("chat.greeting").exists || text("Hey you.").exists, "her greeting comes first")
        snapshot("character-chat")
        menu("chat.menu.about")
        let name = element("character.name")
        XCTAssertTrue(name.waitForExistence(timeout: 10), "her page opens")
        XCTAssertEqual(name.value as? String, "Muse")
        snapshot("character-page")
        // Her memory and conversations.
        XCTAssertTrue(reveal(element("character.memory")).value.map { "\($0)".contains("Mud Club") } ?? false, "her memory loads")
        XCTAssertTrue(reveal(element("character.conversation.s-muse-earlier")).exists)
        snapshot("character-page-conversations")
        // The earlier conversation, and back to the current one.
        element("character.conversation.s-muse-earlier").tap()
        XCTAssertTrue(text("A lighthouse keeper").waitForExistence(timeout: 10), "the earlier conversation opens")
        XCTAssertTrue(element("chat.character").label.contains("Earlier conversation"))
        let current = element("chat.character.current")
        XCTAssertTrue(current.waitForExistence(timeout: 5))
        snapshot("character-earlier")
        current.tap()
        XCTAssertTrue(text("Mud Club has a secret-society feel").waitForExistence(timeout: 10), "back to the current conversation")
    }

    func testCreateFromATemplate() {
        launch()
        XCTAssertTrue(element("characters.new").waitForExistence(timeout: 10))
        element("characters.new").tap()
        let sage = element("character.template.sage")
        XCTAssertTrue(sage.waitForExistence(timeout: 10), "templates for a new character")
        snapshot("character-new")
        sage.tap()
        XCTAssertEqual(element("character.name").value as? String, "Sage")
        snapshot("character-new-sage")
        element("character.save").tap()
        // Straight to saying hi.
        let greeting = element("chat.greeting")
        XCTAssertTrue(greeting.waitForExistence(timeout: 10), "her conversation opens")
        XCTAssertTrue(greeting.label.contains("What's been on your mind?"), greeting.label)
        XCTAssertTrue(element("chat.character").label.contains("Sage"))
        backToList()
        XCTAssertTrue(starting("character.row.sage-").waitForExistence(timeout: 10), "Sage is pinned with the others")
    }

    func testEditFromTheList() {
        launch()
        XCTAssertTrue(row("muse").waitForExistence(timeout: 10))
        row("muse").press(forDuration: 1.2)
        let about = app.buttons["About Muse"].firstMatch
        XCTAssertTrue(about.waitForExistence(timeout: 5))
        about.tap()
        let tagline = element("character.tagline")
        XCTAssertTrue(tagline.waitForExistence(timeout: 10))
        tagline.tap()
        tagline.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + "Ideas at midnight")
        tap("character.look.mochi")
        tap("character.save")
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10), "saved: nothing left to cancel")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(waitGone(element("character.tagline")))
        let edited = NSPredicate(format: "label CONTAINS 'Ideas at midnight'")
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: edited, evaluatedWith: row("muse"))], timeout: 10), .completed, "the list shows the new tagline: \(row("muse").label)")
    }

    func testStartOver() {
        openChat("s-muse")
        XCTAssertTrue(text("Mud Club has a secret-society feel").waitForExistence(timeout: 10))
        menu("chat.menu.startOver")
        let confirm = app.buttons["Start Over"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        // A new conversation: only her greeting.
        XCTAssertTrue(waitGone(text("Mud Club has a secret-society feel")), "the new conversation is empty")
        XCTAssertTrue(element("chat.greeting").waitForExistence(timeout: 10))
        XCTAssertFalse(element("chat.character.current").exists, "this is the current one")
        snapshot("character-start-over")
        // The one before is on her page.
        menu("chat.menu.about")
        XCTAssertTrue(reveal(element("character.conversation.s-muse")).exists, "the conversation before stays")
    }

    func testDeleteFromLibrary() {
        launch()
        XCTAssertTrue(row("atlas").waitForExistence(timeout: 10))
        if isRegularWidth {
            let item = element("tab.characters")
            let show = app.buttons.matching(NSPredicate(format: "identifier ==[c] 'ToggleSidebar'")).firstMatch
            if !(item.exists && item.isHittable), show.exists { show.tap() }
            XCTAssertTrue(item.waitForExistence(timeout: 5))
            item.tap()
            let hide = app.buttons["Hide Sidebar"].firstMatch
            if app.windows.firstMatch.frame.width < 1100, hide.exists, hide.isHittable { hide.tap() }
        } else {
            openTab("Library")
            XCTAssertTrue(element("library.characters").waitForExistence(timeout: 10))
            element("library.characters").tap()
        }
        let atlas = element("character.item.atlas")
        XCTAssertTrue(atlas.waitForExistence(timeout: 10), "Library lists characters")
        snapshot("library-characters")
        atlas.tap()
        tap("character.delete")
        let confirm = app.buttons["Delete Sidekick"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(waitGone(atlas), "Atlas is gone from Library")
        // The tab bar minimizes on scroll; tapping it brings the tabs back.
        let collapsed = app.tabBars.buttons.matching(NSPredicate(format: "value == 'Collapsed'")).firstMatch
        if !app.tabBars.buttons["Chats"].exists, collapsed.exists { collapsed.tap() }
        if isRegularWidth { element("tab.chats").tap() } else { openTab("Chats") }
        XCTAssertTrue(row("muse").waitForExistence(timeout: 10))
        XCTAssertFalse(row("atlas").exists, "and from the chat list")
    }
}
