import XCTest

/// Timings for the paths that matter when running many chats: launch to the chat list, opening a long chat, a reply
/// streaming into it (with scrolling), and switching between chats. On the mock agent with a long chat
/// (`-DexLongChat`: 120 exchanges, each with thinking, a tool step, and Markdown with a table and code).
/// Opt-in, since they take minutes: `TEST_RUNNER_DEX_PERF=1` on the xcodebuild command line.
final class PerformanceUITests: DexUITestCase {
    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["DEX_PERF"] == "1", "Set TEST_RUNNER_DEX_PERF=1 to run the performance tests")
    }

    /// (After the base class's, which sets the usual arguments.)
    override func setUp() {
        super.setUp()
        // Not -DexFast: replies stream at about 28 chunks a second, like a model.
        app.launchArguments = ["-DexMock", "-DexReset", "-DexLongChat"]
        XCUIDevice.shared.orientation = .portrait
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        return options
    }

    private func backToList() {
        guard !isRegularWidth else { return }
        let back = app.buttons["BackButton"].firstMatch
        if back.exists { back.tap() } else { app.navigationBars.buttons.element(boundBy: 0).tap() }
        _ = element("chat.row.s-long").waitForExistence(timeout: 5)
    }

    /// From launch to the chat list showing its chats.
    func testLaunchToChatList() {
        measure(metrics: [XCTClockMetric()], options: options) {
            app.terminate()
            startMeasuring()
            app.launch()
            XCTAssertTrue(element("chat.row.s-long").waitForExistence(timeout: 30))
            stopMeasuring()
        }
    }

    /// Opening the long chat until its latest reply shows (a fresh launch each time: nothing in memory yet).
    func testOpenLongChat() {
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            app.terminate()
            app.launch()
            let row = element("chat.row.s-long")
            XCTAssertTrue(row.waitForExistence(timeout: 30))
            startMeasuring()
            row.tap()
            XCTAssertTrue(text(containing: "Module 119 is tidy").waitForExistence(timeout: 30))
            stopMeasuring()
        }
    }

    /// A long reply streaming into the long chat while you scroll up and back down: CPU time and scroll hitches.
    func testStreamAndScrollLongChat() {
        app.launch()
        let row = element("chat.row.s-long")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        XCTAssertTrue(text(containing: "Module 119 is tidy").waitForExistence(timeout: 30))
        let field = element("composer.field")
        let transcript = element("chat.transcript")
        var run = 0
        measure(metrics: [XCTCPUMetric(application: app), XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTClockMetric()], options: options) {
            run += 1
            field.tap()
            field.typeText("Write an essay \(run)")
            startMeasuring()
            element("composer.send").tap()
            XCTAssertTrue(element("composer.stop").waitForExistence(timeout: 10))
            for _ in 0..<3 {
                transcript.swipeDown(velocity: .fast)
                transcript.swipeUp(velocity: .fast)
            }
            XCTAssertTrue(element("composer.stop").waitForNonExistence(timeout: 120), "The reply finishes")
            stopMeasuring()
        }
    }

    /// Going back and forth between the long chat and a short one.
    func testSwitchChats() {
        app.launch()
        let long = element("chat.row.s-long")
        let short = element("chat.row.s-welcome")
        XCTAssertTrue(long.waitForExistence(timeout: 30))
        // Both opened once already: switching, not a first load.
        long.tap()
        XCTAssertTrue(text(containing: "Module 119 is tidy").waitForExistence(timeout: 30))
        backToList()
        short.tap()
        XCTAssertTrue(text(containing: "Here's an easy weekend").waitForExistence(timeout: 30))
        backToList()
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            startMeasuring()
            long.tap()
            XCTAssertTrue(text(containing: "Module 119 is tidy").waitForExistence(timeout: 30))
            backToList()
            short.tap()
            XCTAssertTrue(text(containing: "Here's an easy weekend").waitForExistence(timeout: 30))
            stopMeasuring()
            backToList()
        }
    }
}
