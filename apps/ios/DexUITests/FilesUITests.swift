import XCTest

/// The Files tab on the mock agent's workspace.
final class FilesUITests: DexUITestCase {
    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func openFiles() {
        launch()
        openTab("Files")
        XCTAssertTrue(element("file.MEMORY.md").waitForExistence(timeout: 10))
    }

    /// Finds a file by searching for it (folders start collapsed), then opens it.
    func open(_ relative: String, search: String) {
        let field = app.searchFields.firstMatch
        if !field.exists { app.swipeDown() }
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(search)
        let row = element("file.\(relative)")
        XCTAssertTrue(row.waitForExistence(timeout: 5), "No row for \(relative)")
        row.tap()
    }

    /// The overflow menu's item (the toolbar's secondary actions).
    func menuItem(_ title: String) -> XCUIElement {
        let more = app.buttons["More"].firstMatch
        if more.exists { more.tap() }
        return app.buttons[title].firstMatch
    }

    func testMarkdownOpenEditSave() {
        openFiles()
        snapshot("files-list")
        element("file.MEMORY.md").tap()
        XCTAssertTrue(element("file.markdown").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Memory"].exists)
        snapshot("files-markdown")

        element("file.edit").tap()
        let editor = app.textViews["file.editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("\n- Likes Lisbon.")
        element("file.save").tap()
        element("file.done").tap()
        XCTAssertTrue(app.staticTexts["Likes Lisbon."].waitForExistence(timeout: 5))
    }

    func testDiscardAsksFirst() {
        openFiles()
        element("file.MEMORY.md").tap()
        element("file.edit").tap()
        let editor = app.textViews["file.editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("draft")
        element("file.done").tap()
        let discard = element("file.discardChanges")
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        discard.tap()
        XCTAssertTrue(element("file.markdown").waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'draft'")).firstMatch.exists)
    }

    func testHtmlPreviewAndSearch() {
        openFiles()
        open("reports/traffic.html", search: "traffic")
        XCTAssertTrue(element("file.html").waitForExistence(timeout: 5))
        // The page's script ran.
        XCTAssertTrue(app.webViews.staticTexts["Weekly traffic (live)"].waitForExistence(timeout: 10))
        snapshot("files-html")
    }

    func testCodeFileIsMonospacedText() {
        openFiles()
        open("scripts/fetch.sh", search: "fetch")
        XCTAssertTrue(element("file.text").waitForExistence(timeout: 5))
    }

    func testNewFileThenDelete() {
        openFiles()
        element("files.new").tap()
        let path = app.alerts.textFields.firstMatch
        XCTAssertTrue(path.waitForExistence(timeout: 5))
        path.typeText("notes/ideas.md")
        app.alerts.buttons["Create"].firstMatch.tap()
        XCTAssertTrue(element("file.markdown").waitForExistence(timeout: 15))
        let delete = menuItem("Delete")
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        element("file.confirmDelete").tap()
        if !isRegularWidth { XCTAssertTrue(element("file.MEMORY.md").waitForExistence(timeout: 5)) }
        let search = app.searchFields.firstMatch
        if !search.exists { app.swipeDown() }
        search.tap()
        search.typeText("ideas")
        XCTAssertTrue(element("file.notes/ideas.md").waitForNonExistence(timeout: 5))
    }

    func testSwipeToDelete() {
        openFiles()
        let row = element("file.MEMORY.md")
        row.swipeLeft()
        // A long swipe runs the action at once (iPad); a short one shows the button.
        let confirm = element("files.confirmDelete")
        if !confirm.waitForExistence(timeout: 2) { app.buttons["Delete"].firstMatch.tap() }
        confirm.tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 5))
    }

    func testRunCommand() {
        openFiles()
        element("files.terminal").tap()
        let input = app.textFields["terminal.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("echo hello > hi.txt\n")
        XCTAssertTrue(element("terminal.line").waitForExistence(timeout: 5))
        input.tap()
        input.typeText("cat hi.txt\n")
        XCTAssertTrue(app.staticTexts["hello"].waitForExistence(timeout: 5))
        snapshot("files-terminal")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(element("file.hi.txt").waitForExistence(timeout: 5))
    }

    func testDeepLinkOpensFile() {
        launch()
        openTab("Settings")
        let row = element("settings.page.defaults")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        let memory = element("defaults.memory")
        XCTAssertTrue(memory.waitForExistence(timeout: 5))
        memory.tap()
        XCTAssertTrue(element("file.markdown").waitForExistence(timeout: 10))
    }
}
