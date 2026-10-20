import XCTest

/// Library: agents, projects (with the repo picker), skills (with skills.sh), and MCP servers (with search, checks,
/// and OAuth), on iPhone (the Library tab) and iPad (each page in the sidebar, list beside detail).
final class LibraryUITests: DexUITestCase {
    override func setUp() {
        super.setUp()
        // Upright, so swipes and taps by coordinate land where they're aimed (the foldable can start sideways).
        XCUIDevice.shared.orientation = .portrait
    }

    // MARK: Helpers

    /// Opens a Library page: the Library tab's row on compact width, the sidebar item on regular.
    func openPage(_ id: String, title: String) {
        if isRegularWidth {
            // The top tab bar shows Library as one item; its pages are in the sidebar.
            let item = element("tab.\(id)")
            let show = app.buttons.matching(NSPredicate(format: "identifier ==[c] 'ToggleSidebar'")).firstMatch
            if !(item.exists && item.isHittable), show.exists { show.tap() }
            XCTAssertTrue(item.waitForExistence(timeout: 5))
            item.tap()
            // A sidebar laid over the page (portrait) closes again.
            let hide = app.buttons["Hide Sidebar"].firstMatch
            if app.windows.firstMatch.frame.width < 1100, item.isHittable, hide.exists, hide.isHittable { hide.tap() }
        } else {
            // The tab bar minimizes on scroll; tapping it brings the tabs back.
            let collapsed = app.tabBars.buttons.matching(NSPredicate(format: "value == 'Collapsed'")).firstMatch
            if !app.tabBars.buttons["Library"].exists, collapsed.exists { collapsed.tap() }
            openTab("Library")
            let row = app.buttons["library.\(id)"].firstMatch
            // Back to the Library tab's root if something is still open in it.
            var pops = 0
            while !row.waitForExistence(timeout: 2), pops < 4, app.buttons["BackButton"].exists {
                app.buttons["BackButton"].firstMatch.tap()
                pops += 1
            }
            XCTAssertTrue(row.waitForExistence(timeout: 10))
            row.tap()
        }
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10) || app.staticTexts[title].waitForExistence(timeout: 2), "\(title) didn't open")
    }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func row(prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

    /// Scrolls the page until the element can be tapped.
    @discardableResult
    func reveal(_ element: XCUIElement, up: Bool = true, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        // Forms are lazy: rows below the fold don't exist until scrolled to.
        _ = element.waitForExistence(timeout: 4)
        var tries = 0
        // Down the page first, then back up.
        while !(element.exists && element.isHittable) && tries < 18 {
            // The frontmost scrolling page: a sheet's, when one is up (it comes later in the hierarchy).
            let scroller = app.collectionViews.allElementsBoundByIndex.last { $0.isHittable } ?? app.windows.firstMatch
            let down = (tries < 8) == up
            if app.keyboards.firstMatch.exists {
                // The keyboard covers the page's middle: drag above it.
                let high = scroller.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
                let low = scroller.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
                if down { low.press(forDuration: 0.01, thenDragTo: high, withVelocity: .slow, thenHoldForDuration: 0.1) } else {
                    high.press(forDuration: 0.01, thenDragTo: low, withVelocity: .slow, thenHoldForDuration: 0.1)
                }
            } else if down { scroller.swipeUp(velocity: .slow) } else { scroller.swipeDown(velocity: .slow) }
            tries += 1
        }
        XCTAssertTrue(element.exists, "missing \(element)", file: file, line: line)
        // A tap while the list still glides only stops it.
        if tries > 0 { usleep(700_000) }
        return element
    }

    func tap(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        reveal(element(id), file: file, line: line).tap()
    }

    func type(_ text: String, into id: String) {
        let field = reveal(element(id))
        field.tap()
        app.typeText(text)
    }

    /// Flips a switch row (tapping a row's label doesn't flip it; its switch sits at the trailing edge).
    func toggle(_ id: String) {
        // A switch row can report not hittable while on screen; it's tapped by coordinate anyway.
        let row = element(id)
        let window = app.windows.firstMatch.frame
        if !(row.waitForExistence(timeout: 4) && row.frame.minY > window.minY + 80 && row.frame.maxY < window.maxY - 90) { reveal(row) }
        let before = row.value as? String
        // The switch itself when it's exposed (aiming by position misses on the foldable's cover screen).
        let knob = row.switches.firstMatch
        if knob.exists, knob.isHittable { knob.tap() } else { row.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap() }
        // A tap that lands mid-animation can miss: try once more if nothing changed.
        if let before, !row.waitForValue(before == "1" ? "0" : "1", timeout: 3) {
            row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
    }

    func waitGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    func dismissKeyboard() {
        if app.keyboards.firstMatch.exists, app.toolbars.buttons["Done"].exists { app.toolbars.buttons["Done"].tap() }
    }

    // MARK: Agents

    func testAgentLifecycle() {
        launch()
        openPage("agents", title: "Agents")
        XCTAssertTrue(element("agent.row.pr-author").waitForExistence(timeout: 10))
        snapshot("library-agents")

        tap("agents.new")
        type("Travel Planner", into: "agent.name")
        type("Plans trips", into: "agent.description")
        tap("icon.globe")
        tap("color.rose")
        toggle("agent.mcp.m-linear")
        snapshot("library-agent-new")
        tap("agent.save")
        // Created: the editor now edits the saved agent.
        XCTAssertTrue(app.buttons["agent.save"].waitForLabel(containing: "Save"))

        // Edit: the editor stays open on the saved agent.
        type(" with a budget", into: "agent.description")
        tap("agent.save")
        XCTAssertTrue(app.textFields["agent.description"].waitForValue("Plans trips with a budget"))
        snapshot("library-agent-saved")

        // Model sheet.
        tap("agent.model")
        // Look it up, as on a short screen it can be below the sheet's fold (rows load as they scroll in).
        let modelSearch = app.searchFields["Search models"].firstMatch
        if modelSearch.waitForExistence(timeout: 5), !app.buttons["model.cline-pass/kimi-k3"].exists {
            modelSearch.tap()
            app.typeText("Kimi K3")
        }
        XCTAssertTrue(app.buttons["model.cline-pass/kimi-k3"].waitForExistence(timeout: 5))
        app.buttons["model.cline-pass/kimi-k3"].tap()
        tap("agent.save")

        // Start a chat with it.
        tap("agent.startChat")
        XCTAssertTrue(element("newchat").waitForExistence(timeout: 10))
        let chip = row(prefix: "newchat.agent.travel-planner")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        XCTAssertTrue(chip.isSelected)
        // iPhone: the new chat is pushed over the chat list, without the tab bar.
        if !isRegularWidth { app.buttons["BackButton"].firstMatch.tap() }
        snapshot("library-agent-chat")

        // Delete it from the list.
        openPage("agents", title: "Agents")
        let listRow = row(prefix: "agent.row.travel-planner")
        XCTAssertTrue(listRow.waitForExistence(timeout: 10))
        listRow.swipeLeft()
        app.buttons["Delete"].firstMatch.tap()
        app.buttons["Delete Agent"].firstMatch.tap()
        XCTAssertTrue(waitGone(listRow))
    }

    /// iPad keyboard: ⌘N makes a new item in the page on screen, ⌘S saves it.
    func testKeyboardShortcuts() throws {
        launch()
        try XCTSkipUnless(isRegularWidth, "Hardware keyboard shortcuts are for iPad.")
        openPage("agents", title: "Agents")
        XCTAssertTrue(element("agent.row.pr-author").waitForExistence(timeout: 10))
        app.typeKey("n", modifierFlags: .command)
        let name = app.textFields["agent.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5), "⌘N didn't open a new agent")
        name.tap()
        app.typeText("Shortcut Agent")
        app.typeKey("s", modifierFlags: .command)
        XCTAssertTrue(row(prefix: "agent.row.shortcut-agent").waitForExistence(timeout: 10), "⌘S didn't save")
        snapshot("library-ipad-agent-shortcut")
    }

    func testAgentValidationAndCancel() {
        launch()
        openPage("agents", title: "Agents")
        tap("agents.new")
        tap("agent.save")
        XCTAssertTrue(app.staticTexts["Give the agent a name."].waitForExistence(timeout: 5))
        tap("agent.cancel")
        XCTAssertTrue(element("agent.row.pr-author").waitForExistence(timeout: 5) || element("agents.list").exists)
    }

    // MARK: Projects

    func testProjectWithRepoPicker() {
        launch()
        openPage("projects", title: "Projects")
        XCTAssertTrue(element("project.row.p-dex").waitForExistence(timeout: 10))
        snapshot("library-projects")

        tap("projects.new")
        type("Mobile", into: "project.name")
        tap("project.addRepo")

        // Search every repo the connection reaches, then a branch from a filtered list, and a folder.
        XCTAssertTrue(element("repo.owner.dex-labs").waitForExistence(timeout: 10))
        XCTAssertTrue(element("repo.result.octocat/dex").waitForExistence(timeout: 10))
        snapshot("library-repo-picker")
        let search = app.searchFields["Search your repos and GitHub"].firstMatch
        search.tap()
        search.typeText("dex")
        XCTAssertTrue(element("repo.result.apple/swift").waitForNonExistence(timeout: 5))
        tap("repo.result.octocat/dex")
        XCTAssertTrue(element("repo.branch.filter").waitForExistence(timeout: 10))
        type("ios", into: "repo.branch.filter")
        tap("repo.branch.feat/ios-native")
        type("core", into: "repo.folder")
        snapshot("library-repo-configure")
        tap("repo.save")
        XCTAssertTrue(element("project.repo.0").waitForExistence(timeout: 5))

        // A second repo through the owner filter (private org repo).
        tap("project.addRepo")
        tap("repo.owner.dex-labs")
        XCTAssertTrue(element("repo.result.dex-labs/ios-app").waitForExistence(timeout: 10))
        XCTAssertFalse(element("repo.result.octocat/dex").exists)
        tap("repo.result.dex-labs/ios-app")
        tap("repo.branch.develop")
        tap("repo.save")
        XCTAssertTrue(element("project.repo.1").waitForExistence(timeout: 5))

        // A picture from the first repo.
        tap("picture.public/favicon.png")
        snapshot("library-project-picture")
        tap("project.save")
        XCTAssertTrue(app.buttons["project.save"].waitForLabel(containing: "Save"))

        // Edit and save again.
        type("App", into: "project.starter")
        tap("project.save")

        // Delete it.
        tap("project.delete")
        app.buttons["Delete Project"].firstMatch.tap()
        XCTAssertTrue(waitGone(row(prefix: "project.row.mobile")))
    }

    func testRepoPickerGitURL() {
        launch()
        openPage("projects", title: "Projects")
        tap("project.row.p-dex")
        tap("project.addRepo")
        tap("repo.useURL")
        type("https://gitlab.com/team/app.git", into: "repo.url")
        tap("repo.url.next")
        type("main", into: "repo.branch")
        tap("repo.save")
        XCTAssertTrue(element("project.repo.1").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["project.save"].isEnabled)
    }

    // MARK: Skills

    func testSkillsSearchInstallEditRemove() {
        launch()
        openPage("skills", title: "Skills")
        XCTAssertTrue(element("skill.row.frontend-design").waitForExistence(timeout: 10))
        snapshot("library-skills")

        tap("skills.search")
        let search = app.searchFields["Search skills.sh"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("pdf")
        let result = element("skill.result.pdf")
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        XCTAssertTrue(element("skill.install.confirm").waitForExistence(timeout: 10))
        toggle("skill.install.auto")
        snapshot("library-skill-preview")
        tap("skill.install.confirm")
        XCTAssertTrue(element("skill.installed.pdf").waitForExistence(timeout: 10))

        // The installed skill: Auto (off from install), edit, remove.
        if !isRegularWidth {
            // Leave the search field, then the search page.
            for name in ["Close", "Cancel"] where !app.buttons["BackButton"].exists && app.buttons[name].exists {
                app.buttons[name].firstMatch.tap()
            }
            app.buttons["BackButton"].firstMatch.tap()
        }
        tap("skill.row.pdf")
        let auto = element("skill.auto")
        XCTAssertTrue(auto.waitForExistence(timeout: 10))
        XCTAssertEqual(auto.value as? String, "0")
        toggle("skill.auto")
        XCTAssertTrue(auto.waitForValue("1"))
        snapshot("library-skill-detail")

        tap("skill.edit")
        type(" Fill forms too.", into: "skill.description")
        tap("skill.save")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Fill forms too.'")).firstMatch.waitForExistence(timeout: 10))

        tap("skill.remove")
        app.buttons["Remove Skill"].firstMatch.tap()
        XCTAssertTrue(waitGone(row(prefix: "skill.row.pdf")))
    }

    func testNewSkill() {
        launch()
        openPage("skills", title: "Skills")
        tap("skills.new")
        tap("skill.save")
        XCTAssertTrue(app.staticTexts["Write its instructions."].waitForExistence(timeout: 5))
        type("Weekly Report", into: "skill.name")
        type("Use for the weekly status report.", into: "skill.description")
        type("# Weekly report", into: "skill.body")
        tap("skill.save")
        XCTAssertTrue(app.navigationBars["/weekly-report"].waitForExistence(timeout: 10))
        XCTAssertTrue(element("skill.instructions").waitForExistence(timeout: 5))
    }

    // MARK: MCP servers

    func testMcpFromSearchWithChecks() {
        launch()
        openPage("mcp", title: "MCP Servers")
        XCTAssertTrue(element("mcp.row.m-linear").waitForExistence(timeout: 10))
        snapshot("library-mcp")

        tap("mcp.search")
        let search = app.searchFields["Search for an MCP server"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("exa")
        let result = element("mcp.result.@exa-labs/exa-mcp")
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        snapshot("library-mcp-search")
        result.tap()
        XCTAssertTrue(element("mcp.check.https").waitForExistence(timeout: 10))
        XCTAssertTrue(element("mcp.check.repo").exists)
        snapshot("library-mcp-checks")
        tap("mcp.check.add")

        // The editor, prefilled from the check: header auth with Authorization.
        let name = app.textFields["mcp.name"]
        XCTAssertTrue(name.waitForValue("Exa Search"))
        XCTAssertTrue(app.textFields["mcp.header.0.name"].waitForValue("Authorization"))
        type("Bearer exa-key", into: "mcp.header.0.value")
        tap("mcp.save")

        // Its page: ready, with tools.
        let status = element("mcp.status")
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        XCTAssertTrue(status.label.contains("Ready"))
        snapshot("library-mcp-added")
        toggle("mcp.defaultOn")
        XCTAssertTrue(element("mcp.defaultOn").waitForValue("1"))

        // Edit headers: the saved one stays (empty value), and another is added.
        tap("mcp.edit")
        XCTAssertTrue(app.navigationBars["Edit Exa Search"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.secureTextFields["mcp.header.0.value"].waitForExistence(timeout: 5))
        tap("mcp.addHeader")
        type("X-Team", into: "mcp.header.1.name")
        type("dex", into: "mcp.header.1.value")
        snapshot("library-mcp-edit")
        tap("mcp.save")
        // Saved (the sheet closes only when the server accepted both headers).
        XCTAssertTrue(app.navigationBars["Edit Exa Search"].waitForNonExistence(timeout: 10))
        // Remove sits at the bottom of the page: on a short screen it loads once scrolled to.
        XCTAssertTrue(reveal(element("mcp.remove")).exists)

        tap("mcp.remove")
        app.buttons["Remove Server"].firstMatch.tap()
        XCTAssertTrue(waitGone(row(prefix: "mcp.row.m-exa")))
    }

    func testMcpOAuthTemplateAndDefault() {
        launch()
        openPage("mcp", title: "MCP Servers")
        tap("mcp.template.notion")
        XCTAssertTrue(app.textFields["mcp.url"].waitForValue("https://mcp.notion.com/mcp"))
        tap("mcp.save")
        // The mock finishes the sign-in as if the user signed in in the browser; the server's page opens ready.
        let status = element("mcp.status")
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        XCTAssertTrue(NSPredicate(format: "label CONTAINS 'Ready'").evaluate(with: status) || status.waitForLabel(containing: "Ready"))
        snapshot("library-mcp-oauth")

        // Default-on from the list's swipe action.
        if !isRegularWidth { app.buttons["BackButton"].firstMatch.tap() }
        let linear = element("mcp.row.m-linear")
        XCTAssertTrue(linear.waitForExistence(timeout: 5))
        linear.swipeRight()
        app.buttons["Off for New Chats"].firstMatch.tap()
    }

    func testMcpValidation() {
        launch()
        openPage("mcp", title: "MCP Servers")
        tap("mcp.new")
        type("Local", into: "mcp.name")
        type("http://example.com/mcp", into: "mcp.url")
        XCTAssertTrue(app.staticTexts["MCP servers need an https:// URL."].waitForExistence(timeout: 5))
        tap("mcp.kind")
        app.buttons["Run on a VM"].firstMatch.tap()
        type("npx -y @modelcontextprotocol/server-everything", into: "mcp.command")
        tap("mcp.addEnv")
        type("API_KEY", into: "mcp.env.0.name")
        type("secret", into: "mcp.env.0.value")
        tap("mcp.save")
        XCTAssertTrue(element("mcp.status").waitForExistence(timeout: 10))
    }
}

extension XCUIElement {
    /// Waits until the element's value is `expected`.
    func waitForValue(_ expected: String, timeout: TimeInterval = 10) -> Bool {
        let predicate = NSPredicate(format: "value == %@", expected)
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }

    func waitForLabel(containing text: String, timeout: TimeInterval = 10) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }
}
