import XCTest

/// Voice calls with a sidekick on the mock agent: no microphone or speaker. The mock call hears a scripted line
/// (`-DexCallSays`) a moment after it starts, sends it to Muse, and "plays" her reply silently, sentence by sentence.
/// Also the Voice setting on her page.
final class CallUITests: ChatTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func text(_ words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    func openChat(_ id: String, _ extra: [String] = []) {
        launch(["-DexOpenChat", id] + extra)
        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 15), "the chat opens")
    }

    func waitFor(_ element: XCUIElement, label words: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let predicate = NSPredicate(format: "label CONTAINS %@", words)
        let result = XCTWaiter.wait(for: [expectation(for: predicate, evaluatedWith: element)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(element) says “\(words)”: \(element.exists ? element.label : "missing")", file: file, line: line)
    }

    func waitGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    func testCallHearsYouAndAnswers() {
        openChat("s-muse", ["-DexCallSays", "What should we make today"])
        let call = element("chat.call")
        XCTAssertTrue(call.waitForExistence(timeout: 10), "Call is in her chat")
        XCTAssertEqual(call.label, "Call Muse")
        call.tap()
        XCTAssertTrue(element("call.end").waitForExistence(timeout: 5), "the call fills the screen")
        let status = element("call.status")
        XCTAssertTrue(status.label.contains("Muse"))
        // What you said goes to her chat as a message, and her answer comes back (read aloud, then she listens).
        XCTAssertTrue(text("short answer to “What should we make today”").waitForExistence(timeout: 15), "she answers")
        waitFor(status, label: "Listening", timeout: 20)
        waitFor(element("call.heard"), label: "What should we make today", timeout: 5)
        snapshot("call-listening")
        // Mute, and back.
        element("call.mute").tap()
        waitFor(status, label: "Muted", timeout: 5)
        XCTAssertEqual(element("call.mute").label, "Unmute")
        element("call.mute").tap()
        waitFor(status, label: "Listening", timeout: 5)
        // End: back to the chat, which has what was said.
        element("call.end").tap()
        XCTAssertTrue(waitGone(element("call.end")), "the call closes")
        XCTAssertTrue(text("What should we make today").waitForExistence(timeout: 5), "what you said is in the chat")
        XCTAssertTrue(element("chat.call").isHittable, "another call can start")
    }

    func testEndWhileSheSpeaks() {
        // A long answer (the mock's essay): she's still reading it when the call ends.
        openChat("s-muse", ["-DexCallSays", "Read me the essay"])
        XCTAssertTrue(element("chat.call").waitForExistence(timeout: 10))
        element("chat.call").tap()
        let status = element("call.status")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        waitFor(status, label: "Speaking", timeout: 20)
        let saying = element("call.saying")
        XCTAssertTrue(saying.waitForExistence(timeout: 5), "the sentence she's saying shows")
        XCTAssertFalse(saying.label.isEmpty)
        snapshot("call-speaking")
        element("call.end").tap()
        XCTAssertTrue(waitGone(element("call.end")), "the call closes")
        XCTAssertTrue(element("chat.call").waitForExistence(timeout: 5))
    }

    func testCallOnlyInTheCurrentConversation() {
        openChat("s-muse-earlier")
        XCTAssertTrue(text("A lighthouse keeper").waitForExistence(timeout: 10))
        XCTAssertFalse(element("chat.call").exists, "an earlier conversation has no Call")
        element("chat.character.current").tap()
        XCTAssertTrue(element("chat.call").waitForExistence(timeout: 10), "the current one has")
    }

    func testNoCallInAnOrdinaryChat() {
        openChat("s-welcome")
        XCTAssertFalse(element("chat.call").waitForExistence(timeout: 3))
    }

    func testVoicePicker() {
        openChat("s-muse")
        let more = element("chat.menu")
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        element("chat.menu.about").tap()
        XCTAssertTrue(element("character.name").waitForExistence(timeout: 10), "her page opens")
        let warm = element("character.voice.M2")
        let bright = element("character.voice.F2")
        var tries = 0
        while !(warm.exists && warm.isHittable) && tries < 12 {
            app.collectionViews.allElementsBoundByIndex.last { $0.isHittable }?.swipeUp(velocity: .slow)
            tries += 1
        }
        XCTAssertTrue(warm.isHittable && bright.exists)
        // Muse's own (picked from her id) is selected to start with.
        XCTAssertTrue(bright.isSelected != warm.isSelected, "one voice is hers")
        let other = bright.isSelected ? warm : bright
        let otherId = other.identifier
        other.tap()
        // Picked and playing her greeting.
        XCTAssertTrue(element(otherId).isSelected)
        snapshot("character-voice")
        let save = element("character.save")
        XCTAssertTrue(save.isEnabled, "a new voice is an edit")
        save.tap()
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10), "saved")
        done.tap()
        XCTAssertTrue(waitGone(element("character.name")))
        // Still hers next time.
        more.tap()
        element("chat.menu.about").tap()
        XCTAssertTrue(element("character.name").waitForExistence(timeout: 10))
        let picked = element(otherId)
        tries = 0
        while !(picked.exists && picked.isHittable) && tries < 12 {
            app.collectionViews.allElementsBoundByIndex.last { $0.isHittable }?.swipeUp(velocity: .slow)
            tries += 1
        }
        XCTAssertTrue(picked.isSelected, "the voice was saved")
    }
}
