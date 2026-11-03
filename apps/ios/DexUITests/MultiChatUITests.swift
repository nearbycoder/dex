import XCTest

/// Running many chats at once: drafts kept across chats, the switcher, the strip over a chat, Send and Start Another,
/// and the chat's VM files. On the mock agent.
final class MultiChatUITests: ChatTestCase {
    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    var field: XCUIElement { app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"] }

    func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    func openChat(_ id: String) {
        launch(["-DexOpenChat", id])
        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 15), "the chat opens")
    }

    /// Back to the chat list (iPhone); on iPad it's beside the chat.
    func backToList() {
        guard !isRegularWidth else { return }
        let back = app.buttons["BackButton"].firstMatch
        if back.exists { back.tap() } else { app.navigationBars.buttons.element(boundBy: 0).tap() }
    }

    func testDraftIsKeptAcrossChats() {
        openChat("s-welcome")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Half a thought about Sintra")
        backToList()
        let other = element("chat.row.s-vm")
        XCTAssertTrue(other.waitForExistence(timeout: 10))
        other.tap()
        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 10))
        XCTAssertFalse((field.value as? String ?? "").contains("Sintra"), "Each chat has its own box")
        backToList()
        // The list says there's a draft, and what it is.
        let row = element("chat.row.s-welcome")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Draft"), "The row shows the draft: \(row.label)")
        snapshot("draft-row")
        row.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertTrue((field.value as? String ?? "").contains("Half a thought about Sintra"), "The draft is back")
    }

    func testSwitcherOpensAChat() {
        openChat("s-welcome")
        let menu = app.buttons["chat.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        app.buttons["chat.menu.switch"].tap()
        XCTAssertTrue(element("switcher.new").waitForExistence(timeout: 5), "The switcher opens")
        snapshot("switcher")
        let target = element("switcher.chat.s-vm")
        XCTAssertTrue(target.waitForExistence(timeout: 5))
        target.tap()
        XCTAssertTrue(element("switcher.new").waitForNonExistence(timeout: 5))
        XCTAssertTrue(revealTitle("Fix the flaky test").waitForExistence(timeout: 10), "The picked chat opens")
    }

    func testStripShowsAWorkingChat() throws {
        try XCTSkipIf(isRegularWidth, "The strip is for iPhone; iPad has the list beside the chat")
        openChat("s-welcome")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Hold on, keep working")
        app.buttons["composer.send"].tap()
        // Over another chat, the working one is a tap away.
        backToList()
        element("chat.row.s-vm").tap()
        let chip = element("strip.chat.s-welcome")
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "The working chat is in the strip")
        snapshot("strip")
        chip.tap()
        XCTAssertTrue(revealTitle("Plan a weekend").waitForExistence(timeout: 10))
    }

    func testSendAndStartAnother() {
        launch()
        if !isRegularWidth { app.buttons["chats.new"].tap() }
        XCTAssertTrue(element("newchat.heading").waitForExistence(timeout: 10))
        field.tap()
        field.typeText("First worker: tidy the docs")
        app.buttons["composer.send"].press(forDuration: 1.2)
        let stay = app.buttons["composer.sendAndStay"]
        XCTAssertTrue(stay.waitForExistence(timeout: 5))
        stay.tap()
        XCTAssertTrue(element("newchat.started").waitForExistence(timeout: 10), "It says the chat started")
        XCTAssertTrue(element("newchat.heading").exists, "Still on New Chat, for the next one")
        XCTAssertEqual((field.value as? String ?? "").contains("First worker"), false, "The box is clear for the next one")
        snapshot("started")
        element("newchat.started.open").tap()
        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 10), "Open goes to it")
    }

    func testVmFiles() {
        openChat("s-vm")
        if isRegularWidth {
            let files = app.buttons["chat.files"]
            XCTAssertTrue(files.waitForExistence(timeout: 10))
            files.tap()
        } else {
            app.buttons["chat.menu"].tap()
            app.buttons["chat.menu.files"].tap()
        }
        let folder = element("files.entry.dex")
        XCTAssertTrue(folder.waitForExistence(timeout: 10), "~/work lists its repository")
        folder.tap()
        XCTAssertTrue(element("files.entry.src").waitForExistence(timeout: 10))
        snapshot("files")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.segmentedControls["files.tab"].buttons.element(boundBy: 1).tap()
        let change = element("files.change.dates.ts")
        XCTAssertTrue(change.waitForExistence(timeout: 10), "The changes list the edited file")
        change.tap()
        XCTAssertTrue(element("files.file").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "setUTCHours").waitForExistence(timeout: 5), "The diff shows the change")
        snapshot("files-diff")
    }
}
