import XCTest

/// Chat and inbox tests: on a failure, the app's accessibility tree goes with the report.
class ChatTestCase: DexUITestCase {
    override func record(_ issue: XCTIssue) {
        var issue = issue
        if let app, app.state == .runningForeground {
            issue.add(XCTAttachment(string: app.debugDescription))
            if let folder = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"] {
                try? app.debugDescription.write(toFile: "\(folder)/failure-\(name.replacingOccurrences(of: " ", with: "_")).txt", atomically: true, encoding: .utf8)
            }
        }
        super.record(issue)
    }

    /// The chat's title in the navigation bar (a menu: Rename, Regenerate Title).
    func titleButton(_ title: String) -> XCUIElement {
        app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }
}

/// The chat: starting one, streaming replies and their activity, the queue, pickers, slash skills, confirmations,
/// media, the header, and scrolling. Runs on the mock agent (see MockChatHandlers for the scripted replies).
final class ChatUITests: ChatTestCase {
    // MARK: Helpers

    func openChat(_ id: String) {
        launch(["-DexOpenChat", id])
        XCTAssertTrue(app.descendants(matching: .any)["chat.transcript"].waitForExistence(timeout: 15), "the chat opens")
    }

    var field: XCUIElement { app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"] }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The model list: a sheet on iPhone, a popover on iPad.
    var modelSheet: XCUIElement { app.popovers.firstMatch.exists ? app.popovers.firstMatch : element("model.sheet") }

    func type(_ text: String) {
        let box = field
        XCTAssertTrue(box.waitForExistence(timeout: 10))
        box.tap()
        box.typeText(text)
    }

    func send(_ text: String) {
        type(text)
        app.buttons["composer.send"].tap()
    }

    func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    /// Waits for a condition on an element (exists, gone, a label).
    @discardableResult
    func wait(_ element: Any, _ format: String, timeout: TimeInterval = 15) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    // MARK: Starting a chat

    func testStartANewChatWithAnAgentAndProjectAndGetAStreamedReply() {
        launch()
        if !isRegularWidth { app.buttons["chats.new"].tap() }
        XCTAssertTrue(element("newchat.heading").waitForExistence(timeout: 10))
        snapshot("newchat")
        element("newchat.project.p-dex").tap()
        element("newchat.agent.researcher").tap()
        XCTAssertTrue(wait(element("newchat.heading"), "label CONTAINS 'Researcher' AND label CONTAINS 'Dex'"))
        XCTAssertTrue(element("newchat.chip.agent").exists)
        XCTAssertTrue(element("newchat.chip.project").exists)
        // The agent's starter prompt is in the box, ready to finish.
        XCTAssertTrue(wait(field, "value BEGINSWITH 'Research'"))
        snapshot("newchat-picked")
        field.tap()
        field.typeText("the best espresso in Lisbon")
        app.buttons["composer.send"].tap()

        XCTAssertTrue(element("chat.transcript").waitForExistence(timeout: 15))
        // "Research…" asks for a search: the scripted reply runs web_search, then answers.
        XCTAssertTrue(text(containing: "Two good sources").waitForExistence(timeout: 20), "the reply streams in")
        XCTAssertTrue(element("chat.activity").exists, "the reply's work is folded into the activity row")
        XCTAssertTrue(wait(element("chat.activity"), "label BEGINSWITH 'Worked for'"))
        if isRegularWidth {
            XCTAssertTrue(element("chat.agent").exists && element("chat.project").exists, "the header shows the agent and project")
        } else {
            XCTAssertTrue(text(containing: "Dex · Researcher").exists, "the subtitle names the project and agent")
        }
        snapshot("newchat-reply")
    }

    // MARK: Replies

    func testActivityRowOpensAndShowsEveryStep() {
        openChat("s-tools")
        let activity = element("chat.activity")
        XCTAssertTrue(activity.waitForExistence(timeout: 10))
        XCTAssertTrue(activity.label.contains("6 tools") && activity.label.contains("1 failed"), activity.label)
        XCTAssertTrue(element("chat.memory").exists, "a MEMORY.md edit is always shown")
        activity.tap()
        XCTAssertTrue(element("chat.thought").waitForExistence(timeout: 5))
        XCTAssertTrue(element("chat.tool.bash").exists)
        XCTAssertTrue(element("chat.tool.web_search").exists)
        XCTAssertTrue(element("chat.tool.read_file").exists)
        XCTAssertTrue(text(containing: "failed").exists, "the failed tool says so")
        // The screenshot was left out of the transcript and loads by its ref.
        XCTAssertTrue(element("chat.screenshot").waitForExistence(timeout: 10))
        snapshot("activity-open")
        element("chat.tool.web_search").tap()
        XCTAssertTrue(element("tool.search.results").waitForExistence(timeout: 5), "search results are listed")
        element("chat.tool.web_search").tap()
        XCTAssertTrue(wait(element("tool.search.results"), "exists == false", timeout: 5))
        app.buttons.matching(identifier: "chat.tool.bash").firstMatch.tap()
        XCTAssertTrue(text(containing: "/dev/sda1").waitForExistence(timeout: 5), "bash output shows")
        snapshot("activity-steps")
    }

    func testLiveStepsScreenshotFailureAndErrors() {
        openChat("s-welcome")
        send("Take a screenshot")
        XCTAssertTrue(text(containing: "the desktop right now").waitForExistence(timeout: 20))
        app.descendants(matching: .any).matching(identifier: "chat.activity").allElementsBoundByIndex.last?.tap()
        XCTAssertTrue(element("chat.screenshot").waitForExistence(timeout: 10))

        send("Make the deploy fail")
        XCTAssertTrue(text(containing: "The deploy target").waitForExistence(timeout: 20))
        XCTAssertTrue(wait(app.descendants(matching: .any).matching(identifier: "chat.activity").allElementsBoundByIndex.last!, "label CONTAINS '1 failed'"))

        send("This ends in an error")
        let error = element("chat.error")
        XCTAssertTrue(error.waitForExistence(timeout: 20))
        XCTAssertTrue(element("chat.retry").exists, "a failed reply offers Retry")
        snapshot("reply-error")
        element("chat.retry").tap()
        let sent = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'This ends in an error'"))
        XCTAssertTrue(wait(sent, "count >= 2", timeout: 20), "Retry sent the message again")
        XCTAssertTrue(element("chat.error").waitForExistence(timeout: 20))

        send("Please retry once")
        XCTAssertTrue(element("chat.retrying").waitForExistence(timeout: 15), "an automatic retry shows")
        XCTAssertTrue(text(containing: "Please retry once").waitForExistence(timeout: 5))
    }

    // MARK: Queue

    func testSendWhileBusyQueuesAndTheQueueCanBeEditedReorderedDeletedAndSteered() {
        openChat("s-welcome")
        send("Hold on while I think")
        XCTAssertTrue(app.buttons["composer.stop"].waitForExistence(timeout: 10), "a running chat offers Stop")
        send("First follow-up")
        send("Second follow-up")
        let toggle = app.buttons["queue.toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertTrue(wait(toggle, "label BEGINSWITH '2 queued'"))
        toggle.tap()
        XCTAssertTrue(element("queue.item.1").waitForExistence(timeout: 5))
        snapshot("queue-open")

        // Edit the second.
        app.buttons["queue.edit.1"].tap()
        let editor = app.textViews["queue.editor"].exists ? app.textViews["queue.editor"] : app.textFields["queue.editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" (edited)")
        app.buttons["queue.save"].tap()
        XCTAssertTrue(text(containing: "Second follow-up (edited)").waitForExistence(timeout: 5))

        // Move it up, then delete what's now second.
        app.buttons["queue.up.1"].tap()
        XCTAssertTrue(wait(element("queue.item.0"), "label CONTAINS 'edited'", timeout: 5) || text(containing: "Second follow-up (edited)").exists)
        app.buttons["queue.delete.1"].tap()
        XCTAssertTrue(wait(toggle, "label BEGINSWITH '1 queued'"))

        // Steer the last one in.
        app.buttons["queue.steer.0"].tap()
        XCTAssertTrue(wait(toggle, "exists == false"), "the queue empties")
        XCTAssertTrue(text(containing: "short answer to “Second follow-up (edited)”").waitForExistence(timeout: 20), "the steered message runs")
    }

    func testStopHoldsTheQueue() {
        openChat("s-welcome")
        send("Hold this for a moment")
        XCTAssertTrue(app.buttons["composer.stop"].waitForExistence(timeout: 10))
        send("Then do this")
        let toggle = app.buttons["queue.toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        app.buttons["composer.stop"].tap()
        XCTAssertTrue(wait(toggle, "label CONTAINS 'held'"), "stopping holds the queue")
        XCTAssertTrue(text(containing: "Held since you stopped").exists)
        XCTAssertFalse(app.buttons["composer.stop"].exists)
        snapshot("queue-held")
        toggle.tap()
        app.buttons["queue.steer.0"].tap()
        XCTAssertTrue(text(containing: "short answer to “Then do this”").waitForExistence(timeout: 20), "sending one continues")
    }

    // MARK: Composer

    func testModelAndThinkingChange() {
        openChat("s-welcome")
        let thinking = app.buttons["composer.thinking"]
        XCTAssertTrue(thinking.waitForExistence(timeout: 10))
        XCTAssertTrue(thinking.label.contains("Low"), thinking.label)
        thinking.tap()
        app.buttons["High"].firstMatch.tap()
        XCTAssertTrue(wait(thinking, "label CONTAINS 'High'"))

        app.buttons["composer.model"].tap()
        XCTAssertTrue(element("model.sheet").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["model.cline-pass/deepseek-v4-pro"].waitForExistence(timeout: 5))
        snapshot("model-sheet")
        let search = modelSheet.searchFields.firstMatch
        search.tap()
        search.typeText("longcat")
        XCTAssertTrue(text(containing: "Free").waitForExistence(timeout: 5), "free models are marked")
        XCTAssertTrue(app.buttons["Connect in Settings"].exists, "a subscription that isn't connected says so")
        XCTAssertFalse(app.buttons["model.opencode-go/longcat-2.5-preview-free"].isEnabled, "models on a subscription that isn't connected can't be picked")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + "argon")
        XCTAssertTrue(text(containing: "Trains on prompts").waitForExistence(timeout: 5), "models that train on prompts are marked")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "kimi")
        XCTAssertFalse(app.buttons["model.cline-pass/deepseek-v4-pro"].exists)
        app.buttons["model.cline-pass/kimi-k3"].tap()
        XCTAssertTrue(wait(app.buttons["composer.model"], "label CONTAINS 'Kimi K3'"))
        // Kimi K3 only thinks at High.
        XCTAssertTrue(wait(thinking, "label CONTAINS 'High'"))
    }

    func testRefreshTheModelList() {
        openChat("s-welcome")
        app.buttons["composer.model"].tap()
        let refresh = app.buttons["model.refresh"]
        XCTAssertTrue(element("model.sheet").waitForExistence(timeout: 5))
        // With nothing matching, the footer (and its refresh button) is in view.
        let search = modelSheet.searchFields.firstMatch
        search.tap()
        search.typeText("zzz")
        XCTAssertTrue(text(containing: "No model matches").waitForExistence(timeout: 5))
        XCTAssertTrue(refresh.waitForExistence(timeout: 3))
        refresh.tap()
        // A sheet has Done; a popover (iPad) closes when you tap outside it.
        if app.buttons["model.done"].exists { app.buttons["model.done"].tap() } else { app.otherElements["PopoverDismissRegion"].tap() }
        XCTAssertFalse(element("notice").waitForExistence(timeout: 2), "no error")
    }

    func testMcpToggle() {
        openChat("s-welcome")
        let mcp = app.buttons["composer.mcp"]
        XCTAssertTrue(mcp.waitForExistence(timeout: 10))
        mcp.tap()
        let linear = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Linear'")).firstMatch
        XCTAssertTrue(linear.waitForExistence(timeout: 5))
        XCTAssertTrue(linear.label.contains("2 tools"), linear.label)
        XCTAssertTrue(app.buttons["Manage MCP Servers"].exists)
        snapshot("mcp-menu")
        linear.tap()
        // The menu stays open for more toggles; close it.
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(wait(mcp, "label CONTAINS 'Linear'"))
    }

    func testSlashSkillsPickAndInstallFromSkillsSh() {
        openChat("s-welcome")
        type("/fr")
        let mine = element("skill.suggestion.frontend-design")
        XCTAssertTrue(mine.waitForExistence(timeout: 5), "your skills are listed")
        snapshot("skills-menu")
        mine.tap()
        XCTAssertTrue(wait(field, "value == '/frontend-design '"))

        // Clear the box and look up one on skills.sh.
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        field.typeText("/react")
        let remote = element("skill.directory.react-best-practices")
        XCTAssertTrue(remote.waitForExistence(timeout: 10), "skills.sh matches are listed")
        snapshot("skills-directory")
        remote.tap()
        XCTAssertTrue(wait(field, "value == '/react-best-practices '", timeout: 15), "it installs in place")
    }

    // MARK: Confirmations

    func testConfirmCardApproveAndDecline() {
        openChat("s-confirm")
        let approve = app.buttons["confirm.approve"]
        XCTAssertTrue(approve.waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Renew the domain").exists, "the card shows Dex's summary")
        snapshot("confirm-card")
        approve.tap()
        XCTAssertTrue(element("confirm.status").waitForExistence(timeout: 10))
        XCTAssertTrue(wait(element("confirm.status"), "label == 'Confirmed'"))

        send("Delete the settled chat")
        let decline = app.buttons["confirm.decline"]
        XCTAssertTrue(decline.waitForExistence(timeout: 20))
        decline.tap()
        XCTAssertTrue(wait(app.staticTexts.matching(NSPredicate(format: "label == 'Declined'")), "count == 1"))
    }

    // MARK: Media

    func testInlineMedia() {
        openChat("s-media")
        XCTAssertTrue(element("media.video").waitForExistence(timeout: 10), "shared video plays inline")
        XCTAssertTrue(element("media.image").waitForExistence(timeout: 10), "a stored image shows inline")
        XCTAssertTrue(element("media.play").exists, "a YouTube link is a tap-to-play card")
        snapshot("media")
        // A VM link saves into the chat, then plays from Dex.
        let save = app.buttons["media.vm.save"]
        if !save.exists { app.swipeUp() }
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        XCTAssertTrue(wait(app.descendants(matching: .any).matching(identifier: "media.video"), "count >= 2", timeout: 15), "the saved copy replaces the link")
        // The image opens full screen.
        let image = app.buttons.matching(identifier: "media.image").firstMatch
        for _ in 0..<6 where !(image.exists && image.frame.minY > 130) { element("chat.transcript").swipeDown() }
        image.tap()
        XCTAssertTrue(app.buttons["media.viewer.done"].waitForExistence(timeout: 5))
        snapshot("media-viewer")
        app.buttons["media.viewer.done"].tap()
    }

    // MARK: Header

    func testRenameAndRegenerateTitle() {
        openChat("s-welcome")
        var title = titleButton("Plan a weekend")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        app.buttons["Rename"].tap()
        let box = app.alerts.textFields.firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 5))
        box.tap()
        box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + "Lisbon in two days")
        app.alerts.buttons["Save"].tap()
        title = titleButton("Lisbon in two days")
        XCTAssertTrue(title.waitForExistence(timeout: 10), "the new title shows")

        title.tap()
        app.buttons["Regenerate Title"].tap()
        XCTAssertTrue(titleButton("Regenerated").waitForExistence(timeout: 10))
        snapshot("header")
    }

    func testHeaderSettleSnoozeAndMute() {
        openChat("s-welcome")
        let menu = app.buttons["chat.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        if isRegularWidth {
            let settle = app.buttons["chat.settle"]
            settle.tap()
            XCTAssertTrue(wait(settle, "label CONTAINS 'Settled'"))
            settle.tap()
            XCTAssertTrue(wait(settle, "label CONTAINS 'Settle: done'"))
        } else {
            // On iPhone, Settle is in the menu, and the menu shows a check while the chat is settled.
            menu.tap()
            app.buttons["Settle"].tap()
            XCTAssertTrue(wait(menu, "label CONTAINS 'settled'"))
            menu.tap()
            app.buttons["Move to Inbox"].tap()
            XCTAssertTrue(wait(menu, "label == 'More'"))
        }

        app.buttons["chat.menu"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Tomorrow'")).firstMatch.tap()
        app.buttons["chat.menu"].tap()
        XCTAssertTrue(app.buttons["chat.unsnooze"].waitForExistence(timeout: 5), "a snoozed chat offers Unsnooze")
        app.buttons["chat.unsnooze"].tap()

        // Mute is in the menu on iPhone, a bell on iPad.
        if app.buttons["chat.mute"].exists {
            app.buttons["chat.mute"].tap()
            XCTAssertTrue(wait(app.buttons["chat.mute"], "label CONTAINS 'muted'"))
        } else {
            app.buttons["chat.menu"].tap()
            app.buttons["chat.menu.mute"].tap()
            app.buttons["chat.menu"].tap()
            XCTAssertTrue(app.buttons["Unmute Notifications"].waitForExistence(timeout: 5))
            app.buttons["Unmute Notifications"].tap()
        }
    }

    func testMachineButtonOpensMachines() {
        openChat("s-vm")
        let machine = app.buttons["chat.machine"]
        if isRegularWidth {
            XCTAssertTrue(machine.waitForExistence(timeout: 10))
            machine.tap()
        } else {
            // On iPhone it's in the chat's menu.
            XCTAssertTrue(app.buttons["chat.menu"].waitForExistence(timeout: 10))
            app.buttons["chat.menu"].tap()
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Machine'")).firstMatch.tap()
        }
        XCTAssertTrue(wait(app.buttons["Machines"].firstMatch, "isSelected == true", timeout: 5), "the Machines tab opens")
    }

    // MARK: Scrolling

    func testScrollToBottomButton() {
        openChat("s-welcome")
        // Fill the chat so there's somewhere to scroll.
        for (index, word) in ["One", "Two", "Three", "Four"].enumerated() {
            send("\(word): search for things")
            let replies = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Two good sources'"))
            XCTAssertTrue(wait(replies, "count >= \(index + 1)", timeout: 20), "the reply finishes")
        }
        let transcript = element("chat.transcript")
        XCTAssertFalse(app.buttons["chat.scrollToBottom"].exists, "pinned to the latest message")
        // The latest reply sits above the composer, not under it.
        sleep(1)
        let lastCopy = app.buttons.matching(identifier: "chat.reply.copy").allElementsBoundByIndex.last
        XCTAssertNotNil(lastCopy)
        XCTAssertLessThanOrEqual(lastCopy?.frame.maxY ?? .infinity, field.frame.minY, "the latest reply is above the message box")
        transcript.swipeDown(velocity: .fast)
        transcript.swipeDown(velocity: .fast)
        let down = app.buttons["chat.scrollToBottom"]
        XCTAssertTrue(down.waitForExistence(timeout: 5))
        snapshot("scrolled-up")
        down.tap()
        XCTAssertTrue(wait(down, "exists == false", timeout: 5))
    }

    func testUserMessageMenuCopiesAndEdits() {
        openChat("s-welcome")
        let bubble = app.descendants(matching: .any).matching(identifier: "chat.user").firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))
        bubble.press(forDuration: 1.0)
        let edit = app.buttons["Edit as New Message"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Copy"].exists)
        edit.tap()
        XCTAssertTrue(wait(field, "value BEGINSWITH 'Plan a relaxed weekend'"))
    }
}
