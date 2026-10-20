import UIKit
import XCTest

/// The Machines tab, the Machine page, and the chat's picture-in-picture preview, on the mock agent's VMs.
final class MachineUITests: DexUITestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func openMachines() {
        launch()
        openTab("Machines")
        XCTAssertTrue(element("machine.row.s-vm").waitForExistence(timeout: 10))
    }

    private func openMachine(_ key: String = "s-vm") {
        openMachines()
        element("machine.row.\(key)").tap()
        XCTAssertTrue(element("machine.desktop").waitForExistence(timeout: 10))
    }

    /// Shows a panel below the desktop (the stacked layout); the wide layout shows them all.
    private func showPanel(_ title: String) {
        let picker = app.segmentedControls["machine.panel"]
        if picker.exists { picker.buttons[title].tap() }
    }

    // MARK: List

    func testListShowsEveryMachine() {
        openMachines()
        for key in ["s-vm", "s-welcome", "s-snoozed", "s-settled", "mcp-host", "shared"] {
            XCTAssertTrue(element("machine.row.\(key)").exists, "missing \(key)")
        }
        XCTAssertTrue(element("machine.row.mcp-host").label.contains("MCP servers"))
        XCTAssertTrue(element("machine.row.s-snoozed").label.contains("Setting up"))
        XCTAssertTrue(element("machine.row.s-settled").label.contains("Setup failed"))
        snapshot("machines-list")
    }

    func testStartStopAndDeleteFromTheList() {
        openMachines()
        let row = element("machine.row.s-welcome")
        XCTAssertTrue(row.label.contains("Stopped"))
        row.swipeLeft()
        if !app.buttons["Resume"].firstMatch.waitForExistence(timeout: 2) {
            // The swipe didn't open the row's actions (it can miss on a wide list): use its menu.
            row.press(forDuration: 1.0)
        }
        app.buttons["Resume"].firstMatch.tap()
        XCTAssertTrue(waitForLabel(row, containing: "Running"))

        row.press(forDuration: 1.0)
        let stop = app.buttons["Stop"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        stop.tap()
        XCTAssertTrue(waitForLabel(row, containing: "Stopped"))

        let shared = element("machine.row.shared")
        shared.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].firstMatch.waitForExistence(timeout: 3))
        app.buttons["Delete"].firstMatch.tap()
        let confirm = app.buttons["Delete VM"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        snapshot("machines-delete-confirm")
        confirm.tap()
        XCTAssertTrue(shared.waitForNonExistence(timeout: 5))
    }

    // MARK: Machine page

    func testRunACommandAndSeeItsOutputStream() {
        openMachine()
        snapshot("machine-page")
        showPanel("Activity")
        let field = element("machine.command")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("echo hello from the test\n")
        XCTAssertTrue(labelled("echo hello from the test").waitForExistence(timeout: 10))
        // The output streams in line by line under the entry, which opens while it runs.
        let output = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'activity.output' AND label CONTAINS 'hello from the test'")).firstMatch
        XCTAssertTrue(output.waitForExistence(timeout: 10))

        field.tap()
        field.typeText("exit 3\n")
        XCTAssertTrue(labelled("exit 3").waitForExistence(timeout: 10))
        snapshot("machine-command")
    }

    func testStopStartAndDeleteOnTheMachinePage() {
        openMachine()
        element("machine.stop").tap()
        XCTAssertTrue(element("machine.start").waitForExistence(timeout: 10))
        XCTAssertTrue(element("desktop.placeholder").waitForExistence(timeout: 5))
        element("machine.start").tap()
        XCTAssertTrue(element("machine.stop").waitForExistence(timeout: 10))

        element("machine.menu").tap()
        element("machine.delete").tap()
        let confirm = app.buttons["Delete VM"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        // A chat's VM goes back to "No VM yet", with Start.
        XCTAssertTrue(element("machine.start").waitForExistence(timeout: 10))
    }

    func testTakeControlOfTheDesktop() {
        openMachine()
        let watching = element("machine.desktop.watching")
        XCTAssertTrue(watching.waitForExistence(timeout: 10))
        watching.tap()
        XCTAssertTrue(app.buttons["You Have Control"].waitForExistence(timeout: 5))
        XCTAssertFalse(watching.exists)
        app.buttons["You Have Control"].tap()
        XCTAssertTrue(watching.waitForExistence(timeout: 5))
    }

    func testExposeAPort() {
        openMachine()
        showPanel("Ports")
        let field = element("ports.field")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("3000")
        let expose = element("ports.expose")
        XCTAssertTrue(waitFor { expose.isEnabled })
        expose.tap()
        // On the iPad simulator (hardware keyboard) the first synthesized tap after typing doesn't reach the button
        // while the field keeps focus; a second one does.
        if !element("ports.url").waitForExistence(timeout: 3) { expose.tap() }
        let url = element("ports.url")
        XCTAssertTrue(url.waitForExistence(timeout: 10))
        XCTAssertTrue(url.label.contains("3000-box-1234.boat.dev"))
        XCTAssertFalse(url.label.contains("_token"))
        element("ports.copy").tap()
        XCTAssertTrue(app.buttons["Copied"].waitForExistence(timeout: 3))
        snapshot("machine-port")
    }

    func testPeeks() {
        openMachine()
        showPanel("Inspect")
        let folder = element("inspect.file.dex")
        XCTAssertTrue(folder.waitForExistence(timeout: 10))
        snapshot("machine-inspect-files")
        folder.tap()
        XCTAssertTrue(element("inspect.file.package.json").waitForExistence(timeout: 5))
        XCTAssertEqual(element("inspect.path").label, "~/work/dex")
        element("inspect.up").tap()
        let notes = element("inspect.file.notes.md")
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        notes.tap()
        XCTAssertTrue(element("filePeek.content").waitForExistence(timeout: 5))
        element("filePeek.done").tap()

        let picker = app.segmentedControls["inspect.picker"]
        picker.buttons["Git"].tap()
        XCTAssertTrue(element("inspect.git.branch").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Pin the date tests to UTC"].exists)
        picker.buttons["Processes"].tap()
        XCTAssertTrue(app.staticTexts["selkies"].waitForExistence(timeout: 5))
        picker.buttons["Ports"].tap()
        let getURL = element("inspect.port.3000")
        XCTAssertTrue(getURL.waitForExistence(timeout: 5))
        getURL.tap()
        XCTAssertTrue(element("ports.url").waitForExistence(timeout: 10))
    }

    func testNotRunningPeekAndSetupError() {
        openMachine("s-settled")
        XCTAssertTrue(element("machine.setupError").exists)
        XCTAssertTrue(element("machine.error").exists)
        showPanel("Inspect")
        XCTAssertTrue(element("inspect.notRunning").waitForExistence(timeout: 10))
        element("machine.rerunSetup").tap()
        XCTAssertTrue(element("machine.setupError").waitForNonExistence(timeout: 15))
        snapshot("machine-setup-rerun")
    }

    func testWideLayoutShowsTheLogBesideTheDesktop() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("The wide layout needs an iPad-sized window") }
        openMachine()
        XCTAssertTrue(app.segmentedControls["machine.panel"].exists)
        // Landscape, with the app's sidebar hidden, leaves the Machine page room for the log beside the desktop.
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let hide = app.buttons.matching(NSPredicate(format: "label == 'Hide Sidebar'")).firstMatch
        if hide.waitForExistence(timeout: 3) { hide.tap() }
        XCTAssertTrue(app.segmentedControls["machine.panel"].waitForNonExistence(timeout: 5))
        // Everything at once: no panel picker.
        XCTAssertTrue(element("machine.command").waitForExistence(timeout: 5))
        XCTAssertTrue(element("inspect.picker").exists)
        XCTAssertTrue(element("ports.field").exists)
        XCTAssertFalse(app.segmentedControls["machine.panel"].exists)
        snapshot("machine-wide")
    }

    // MARK: Picture in picture

    func testPreviewOverAChat() {
        launch(["-DexOpenChat", "s-vm"])
        let window = element("vmPreview.window")
        let button = element("vmPreview.button")
        XCTAssertTrue(button.waitForExistence(timeout: 10) || window.waitForExistence(timeout: 2))
        // Opened in an earlier run (it's remembered): close it first.
        if window.exists { element("vmPreview.close").tap() }
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let screen = app.windows.firstMatch.frame

        // Drag the button across: it snaps to the other side of the chat.
        let start = button.frame
        let towardLeft = start.midX > screen.midX
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.2, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: towardLeft ? 0.05 : 0.95, dy: 0.45)))
        XCTAssertTrue(waitFor { abs(button.frame.midX - start.midX) > 100 })

        button.tap()
        XCTAssertTrue(window.waitForExistence(timeout: 5))
        XCTAssertTrue(element("vmPreview.desktop").waitForExistence(timeout: 10))
        snapshot("chat-preview-open")

        // Move the window by its title bar.
        // Shrink it first so it has room to cross the chat, then move it by its title bar.
        if window.frame.width > screen.width / 3 { element("vmPreview.size").tap() }
        _ = waitFor { window.frame.width <= screen.width / 3 }
        let before = window.frame
        let left = before.minX - screen.minX < screen.maxX - before.maxX
        let grab = element("vmPreview.titleBar").coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
        grab.press(forDuration: 0.2, thenDragTo: grab.withOffset(CGVector(dx: (left ? 1 : -1) * screen.width * 0.7, dy: -60)))
        XCTAssertTrue(waitFor { abs(window.frame.midX - before.midX) > 100 })

        // Resize it larger with the button, then close it back to a button.
        let width = window.frame.width
        element("vmPreview.size").tap()
        XCTAssertTrue(waitFor { abs(window.frame.width - width) > 20 })
        element("vmPreview.close").tap()
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertFalse(window.exists)

        // Open it again and go to the Machine page.
        button.tap()
        XCTAssertTrue(window.waitForExistence(timeout: 5))
        element("vmPreview.openMachine").tap()
        XCTAssertTrue(element("machine.desktop").waitForExistence(timeout: 10))
        // Leave it closed for the next run.
        openTab("Chats")
        if element("vmPreview.close").waitForExistence(timeout: 3) { element("vmPreview.close").tap() }
    }

    func testSetupProgressOverAProjectChat() {
        launch(["-DexOpenChat", "s-snoozed"])
        let button = element("vmPreview.button")
        if element("vmPreview.close").waitForExistence(timeout: 5) { element("vmPreview.close").tap() }
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertTrue((button.value as? String)?.contains("Setting up") == true)
        snapshot("chat-setup-progress")
    }

    // MARK: Helpers

    private func labelled(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func waitForLabel(_ element: XCUIElement, containing text: String, timeout: TimeInterval = 10) -> Bool {
        waitFor(timeout) { element.label.contains(text) }
    }

    private func waitFor(_ timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return condition()
    }
}
