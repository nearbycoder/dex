import XCTest

/// A screenshot tour of every screen on the mock agent, for reviewing layout on each device class
/// (`scripts/tour.sh` runs it across simulators and appearances). It checks nothing: a step that can't find its way
/// saves what's on screen as `MISSING-<step>` and the tour goes on.
final class ScreenTourUITests: DexUITestCase {
    private var count = 0

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
        // `THEME=ocean scripts/tour.sh`: every launch starts in that theme.
        if let theme = ProcessInfo.processInfo.environment["DEX_THEME"], !theme.isEmpty { app.launchEnvironment["DEX_THEME"] = theme }
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    // MARK: Helpers

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    private func labelled(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }

    /// Saves a numbered screenshot after the screen settles.
    private func shot(_ name: String, settle: UInt32 = 1) {
        sleep(settle)
        count += 1
        snapshot(String(format: "%02d-%@", count, name))
    }

    private func missing(_ name: String) {
        count += 1
        snapshot(String(format: "%02d-MISSING-%@", count, name))
    }

    /// Taps `element` if it shows up, by coordinate when it isn't hittable; false if it never showed.
    @discardableResult
    private func tap(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        guard element.waitForExistence(timeout: timeout) else { return false }
        if element.isHittable { element.tap() } else { element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
        return true
    }

    /// The sidebar layout (iPad, a Pro Max or unfolded foldable in landscape): the Library pages are tabs of their own.
    private var regular: Bool {
        // The compact tab bar (its buttons lose their identifiers in landscape); regular width has none.
        if app.tabBars.firstMatch.exists { return false }
        if element("tab.agents").exists || element("tab.search").exists { return true }
        return isRegularWidth
    }

    /// Back in the app if a step sent it away (a picker, a crash restarts it).
    private func ensureForeground() {
        if app.state != .runningForeground { app.activate(); sleep(2) }
    }

    /// The navigation back button (in the bar, or the foldable's side toolbar).
    private func goBack() {
        let back = app.buttons["BackButton"].firstMatch
        if back.exists, back.isHittable { back.tap() }
    }

    /// Opens a tab (compact: the tab bar; regular: the sidebar or top tab bar).
    @discardableResult
    private func go(_ id: String, _ title: String) -> Bool {
        if regular {
            endSearch()
            let item = element("tab.\(id)")
            if item.exists, item.isHittable { item.tap(); return true }
            let byTitle = app.tabBars.buttons[title].firstMatch
            if byTitle.exists, byTitle.isHittable { byTitle.tap(); return true }
            let toggle = app.buttons.matching(NSPredicate(format: "identifier ==[c] 'ToggleSidebar' OR label CONTAINS[c] 'Show Sidebar'")).firstMatch
            if toggle.exists { toggle.tap(); sleep(1) }
            if item.waitForExistence(timeout: 3), item.isHittable { item.tap(); closeOverlaySidebar(item); return true }
            let any = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).allElementsBoundByIndex.first { $0.isHittable }
            if let any { any.tap(); closeOverlaySidebar(item); return true }
            return false
        }
        endSearch()
        // A minimized tab bar (scrolled, or a phone in landscape) is one button: tapping it brings the tabs back.
        if !app.tabBars.buttons[title].exists, app.tabBars.buttons.firstMatch.exists { app.tabBars.buttons.firstMatch.tap(); sleep(1) }
        let tab = app.tabBars.buttons[title].firstMatch
        if tab.exists { tab.tap(); tab.tap(); return true } // A second tap pops the tab to its root.
        // The foldable's cover screen shows the tabs as a side rail.
        let rail = element("tab.\(id)")
        if rail.exists { rail.tap(); return true }
        return tap(app.buttons[title].firstMatch, timeout: 2)
    }

    /// Closes an open search (and its keyboard), which hides the tab bar.
    private func endSearch() {
        for label in ["Cancel", "Close"] {
            let button = app.buttons[label].firstMatch
            if button.exists, button.isHittable { button.tap(); sleep(1); return }
        }
        // iPad has no Cancel: hide the keyboard instead.
        let hide = app.keyboards.buttons["Hide keyboard"].firstMatch
        if hide.exists, hide.isHittable { hide.tap(); sleep(1) }
    }

    /// Shows a split view's list column where it starts hidden (iPad portrait): its toggle sits below the tab bar.
    private func showListColumn() {
        let toggles = app.buttons.matching(NSPredicate(format: "identifier ==[c] 'ToggleSidebar' OR label CONTAINS[c] 'sidebar'")).allElementsBoundByIndex
        if let toggle = toggles.filter({ $0.isHittable && $0.frame.minY > 100 }).max(by: { $0.frame.minY < $1.frame.minY }) {
            toggle.tap()
            sleep(1)
        }
    }

    /// A sidebar laid over the page (iPad portrait) closes again after picking.
    private func closeOverlaySidebar(_ item: XCUIElement) {
        sleep(1)
        let hide = app.buttons["Hide Sidebar"].firstMatch
        if app.windows.firstMatch.frame.width < 1100, item.exists, item.isHittable, hide.exists, hide.isHittable { hide.tap() }
    }

    private func dismissPopup() {
        // The model picker's own Done first: the dismiss region's middle can land on one of its rows.
        let done = element("model.done")
        if done.exists, done.isHittable { done.tap(); return }
        // A sheet can have more than one dismiss region (the foldable's runtime).
        let region = app.otherElements.matching(identifier: "PopoverDismissRegion").firstMatch
        if region.exists { region.tap(); return }
        // A menu: tap outside it, below the navigation bar (the status bar takes no taps). The tap only closes it.
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        sleep(1)
        ensureForeground()
    }

    private var composerField: XCUIElement {
        app.textViews["composer.field"].exists ? app.textViews["composer.field"] : app.textFields["composer.field"]
    }

    private func openChatAtLaunch(_ id: String) -> Bool {
        app.terminate()
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast", "-DexOpenChat", id]
        app.launch()
        return element("chat.transcript").waitForExistence(timeout: 15)
    }

    private func scrollTranscript(up: Bool, times: Int = 2) {
        let transcript = element("chat.transcript")
        guard transcript.exists else { return }
        for _ in 0..<times { if up { transcript.swipeDown(velocity: .fast) } else { transcript.swipeUp(velocity: .fast) } }
    }

    // MARK: Tour

    /// The screens where the theme shows most: the inbox, a chat and its composer, the model list, a new chat, and
    /// Settings → Appearance (`TEST=testThemeGlance THEME=ocean scripts/tour.sh`).
    func testThemeGlance() {
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast"]
        app.launch()
        if labelled("Plan a weekend in Lisbon").waitForExistence(timeout: 10) { shot("chats-list") } else { missing("chats-list") }
        if tap(element("chats.new")), element("newchat.heading").waitForExistence(timeout: 10) { shot("newchat") } else { missing("newchat") }
        if openChatAtLaunch("s-welcome") { shot("chat-welcome-bottom", settle: 2) } else { missing("chat-welcome") }
        if tap(element("composer.model")) { shot("chat-model-picker", settle: 2); dismissPopup(); sleep(1) } else { missing("chat-model-picker") }
        if openChatAtLaunch("s-chart") { shot("chat-openui", settle: 3) } else { missing("chat-openui") }
        if go("settings", "Settings") {
            let row = element("settings.page.appearance")
            if tap(row) { shot("settings-appearance", settle: 2) } else { missing("settings-appearance") }
        } else { missing("settings") }
    }

    func testTour() {
        signIn()
        chats()
        characters()
        machines()
        files()
        library()
        search()
        settings()
        landscape()
    }

    private func signIn() {
        launch(["-DexSignedOut"])
        sleep(2)
        shot("signin")
        app.terminate()
    }

    private func chats() {
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast"]
        app.launch()
        if labelled("Plan a weekend in Lisbon").waitForExistence(timeout: 10) { shot("chats-list") } else { missing("chats-list") }

        // New chat.
        if tap(element("chats.new")), element("newchat.heading").waitForExistence(timeout: 10) {
            shot("newchat")
            let field = composerField
            if field.waitForExistence(timeout: 3) {
                field.tap()
                _ = app.keyboards.firstMatch.waitForExistence(timeout: 3)
                shot("newchat-keyboard")
            }
        } else { missing("newchat") }

        // The welcome chat: markdown, code, tables, and a tool step.
        guard openChatAtLaunch("s-welcome") else { return missing("chat-welcome") }
        shot("chat-welcome-bottom", settle: 2)
        scrollTranscript(up: true, times: 3)
        shot("chat-welcome-top")
        scrollTranscript(up: false, times: 1)
        shot("chat-welcome-middle")

        // The composer with the keyboard up.
        let field = composerField
        if field.waitForExistence(timeout: 5) {
            field.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 3)
            shot("chat-keyboard")
            field.typeText("A draft message that runs long enough to wrap onto a second line in the composer")
            shot("chat-keyboard-draft")
        } else { missing("chat-keyboard") }

        // The attach menu.
        if tap(element("composer.attach")) {
            shot("chat-attach-menu")
            dismissPopup()
            sleep(1)
        } else { missing("chat-attach-menu") }

        // The model picker.
        if tap(element("composer.model")) {
            shot("chat-model-picker", settle: 2)
            dismissPopup()
            sleep(1)
        } else { missing("chat-model-picker") }

        // A link in a reply opens the in-app browser, full screen.
        if openChatAtLaunch("s-welcome") {
            let box = composerField
            if box.waitForExistence(timeout: 5) {
                box.tap()
                box.typeText("Open [example.com](https://example.com)")
                tap(app.buttons["composer.send"])
            }
            let link = app.links["example.com"].firstMatch
            if link.waitForExistence(timeout: 15) {
                shot("chat-link-reply")
                link.tap()
                shot("browser", settle: 3)
                let done = app.buttons["Done"].firstMatch
                if done.waitForExistence(timeout: 5) { done.tap() }
                sleep(1)
            } else { missing("browser") }
        } else { missing("browser") }

        // An OpenUI card (a chart).
        if openChatAtLaunch("s-chart") { shot("chat-openui", settle: 3); scrollTranscript(up: true); shot("chat-openui-top") } else { missing("chat-openui") }

        // A chat with a running VM: tool activity and the floating preview.
        if openChatAtLaunch("s-vm") {
            shot("chat-vm", settle: 3)
            let preview = element("vmPreview.button")
            if tap(preview, timeout: 2) { shot("chat-vm-preview", settle: 2) }
        } else { missing("chat-vm") }

        // Back to the inbox with everything.
        app.terminate()
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast"]
        app.launch()
        _ = labelled("Plan a weekend in Lisbon").waitForExistence(timeout: 10)
    }

    private func machines() {
        ensureForeground()
        guard go("machines", "Machines") else { return missing("machines") }
        if regular, !element("machine.row.s-vm").waitForExistence(timeout: 3) { shot("machines-empty"); showListColumn() }
        guard element("machine.row.s-vm").waitForExistence(timeout: 10) else { return missing("machines") }
        shot("machines")
        element("machine.row.s-vm").tap()
        guard element("machine.desktop").waitForExistence(timeout: 10) else { return missing("machine-detail") }
        shot("machine-detail", settle: 2)
        let picker = app.segmentedControls["machine.panel"]
        if picker.exists {
            for title in picker.buttons.allElementsBoundByIndex.map(\.label) {
                picker.buttons[title].tap()
                shot("machine-panel-\(title.lowercased())")
            }
        } else {
            app.swipeUp()
            shot("machine-detail-scrolled")
        }
        if !regular { goBack() }
    }

    private func files() {
        ensureForeground()
        guard go("files", "Files") else { return missing("files") }
        if regular, !element("file.MEMORY.md").waitForExistence(timeout: 3) { shot("files-empty"); showListColumn() }
        guard element("file.MEMORY.md").waitForExistence(timeout: 10) else { return missing("files") }
        shot("files")
        element("file.MEMORY.md").tap()
        if element("file.markdown").waitForExistence(timeout: 5) { shot("file-markdown") } else { missing("file-markdown") }
        if !regular { goBack(); sleep(1) }
        let search = app.searchFields.firstMatch
        if !search.exists { element("file.MEMORY.md").swipeDown() }
        if search.waitForExistence(timeout: 3) {
            search.tap()
            search.typeText("traffic")
            if tap(element("file.reports/traffic.html")), element("file.html").waitForExistence(timeout: 5) { shot("file-html", settle: 2) } else { missing("file-html") }
            if !regular { goBack(); sleep(1) }
            endSearch()
        } else { missing("file-html") }
    }

    private func library() {
        ensureForeground()
        let pages = [("agents", "Agents", "agent.row.pr-reviewer"), ("characters", "Sidekicks", "character.item.muse"), ("projects", "Projects", "project.row.p-dex"), ("skills", "Skills", nil), ("mcp", "MCP Servers", "mcp.row.m-linear")]
        if !regular {
            guard go("library", "Library") else { return missing("library") }
            shot("library")
        }
        for (id, title, detail) in pages {
            if regular {
                guard go(id, title) else { missing("library-\(id)"); continue }
            } else {
                let row = app.buttons["library.\(id)"].firstMatch
                var pops = 0
                while !row.waitForExistence(timeout: 2), pops < 4 { goBack(); pops += 1 }
                guard tap(row) else { missing("library-\(id)"); continue }
            }
            shot("library-\(id)", settle: 2)
            if let detail, tap(element(detail), timeout: 3) {
                shot("library-\(id)-detail", settle: 2)
                if !regular { goBack(); sleep(1) }
            } else if detail == nil {
                let first = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'skill.row.'")).firstMatch
                if tap(first, timeout: 3) {
                    shot("library-\(id)-detail", settle: 2)
                    if !regular { goBack(); sleep(1) }
                }
            }
            if !regular { goBack(); sleep(1) }
        }
    }

    /// Characters only, in portrait and landscape (`TEST=testCharacters scripts/tour.sh`).
    func testCharacters() {
        characters()
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        if openChatAtLaunch("s-muse") { shot("landscape-character-chat", settle: 2) } else { missing("landscape-character-chat") }
        if openCharacterPage(), element("character.name").waitForExistence(timeout: 10) { shot("landscape-character-page", settle: 2) } else { missing("landscape-character-page") }
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
    }

    /// A character's page from their conversation: the header, or the ⋯ menu where the title bar hides (the foldable's
    /// cover screen).
    private func openCharacterPage() -> Bool {
        let header = element("chat.character")
        if header.waitForExistence(timeout: 3), header.isHittable { header.tap(); return true }
        guard tap(element("chat.menu")) else { return false }
        return tap(element("chat.menu.about"))
    }

    /// The pinned characters, a conversation (greeting, replies with their face), an earlier one, their page, and a new one.
    private func characters() {
        if openChatAtLaunch("s-muse") { shot("character-chat", settle: 2) } else { return missing("character-chat") }
        if openCharacterPage(), element("character.name").waitForExistence(timeout: 10) {
            shot("character-page", settle: 2)
            let memory = element("character.memory")
            for _ in 0..<6 where !(memory.exists && memory.isHittable) { app.collectionViews.allElementsBoundByIndex.last { $0.isHittable }?.swipeUp() }
            shot("character-page-memory", settle: 1)
            let notify = element("character.notify")
            for _ in 0..<4 where !(notify.exists && notify.isHittable) { app.collectionViews.allElementsBoundByIndex.last { $0.isHittable }?.swipeDown() }
            if notify.exists { shot("character-page-notify", settle: 1) } else { missing("character-page-notify") }
            tap(element("character.cancel"))
            sleep(1)
        } else { missing("character-page") }
        if openChatAtLaunch("s-atlas") { shot("character-greeting", settle: 2) } else { missing("character-greeting") }
        if openChatAtLaunch("s-muse-earlier") { shot("character-earlier", settle: 2) } else { missing("character-earlier") }
        app.terminate()
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast"]
        app.launch()
        if element("character.row.muse").waitForExistence(timeout: 10) { shot("characters-list") } else { missing("characters-list") }
        if tap(element("characters.new")), element("character.template.muse").waitForExistence(timeout: 10) {
            shot("character-new", settle: 2)
            tap(element("character.template.rex"))
            shot("character-new-rex", settle: 1)
            tap(element("character.cancel"))
            sleep(1)
        } else { missing("character-new") }
    }

    private func search() {
        ensureForeground()
        if regular {
            guard go("search", "Search") else { return missing("search") }
            shot("search")
            let field = app.searchFields.firstMatch
            if !field.waitForExistence(timeout: 2) {
                // The field sits behind a magnifier button at the top right (not the Search tab).
                let buttons = app.buttons.matching(NSPredicate(format: "label == 'Search' AND identifier != 'tab.search'")).allElementsBoundByIndex
                buttons.filter(\.isHittable).max { $0.frame.minX < $1.frame.minX }?.tap()
            }
            if tap(field, timeout: 3) {
                field.typeText("lisbon")
                shot("search-results")
                endSearch()
            } else { missing("search-results") }
        } else {
            guard go("chats", "Chats") else { return missing("search") }
            let field = app.searchFields.firstMatch
            if !field.exists { element("chats.list").swipeDown() }
            guard tap(field, timeout: 3) else { return missing("search") }
            field.typeText("lisbon")
            shot("search-results")
            endSearch()
        }
    }

    private func settings() {
        ensureForeground()
        guard go("settings", "Settings"), element("settings.page.account").waitForExistence(timeout: 10) else { return missing("settings") }
        shot("settings")
        for page in ["account", "models", "machines", "github", "defaults", "secrets", "access", "notifications", "usage", "about"] {
            let row = element("settings.page.\(page)")
            // The list may have been left scrolled past the row (a short screen): look down, then back up.
            var swipes = 0
            while !(row.exists && row.isHittable), swipes < 10 {
                if swipes < 5 { element("settings.list").swipeUp() } else { element("settings.list").swipeDown() }
                swipes += 1
            }
            guard tap(row, timeout: 3) else { missing("settings-\(page)"); continue }
            shot("settings-\(page)", settle: 2)
            if page == "notifications" {
                // Each sidekick's setting and the other devices, below this device's.
                app.collectionViews.allElementsBoundByIndex.last { $0.isHittable }?.swipeUp()
                shot("settings-notifications-sidekicks", settle: 1)
            }
            if !regular {
                goBack()
                sleep(1)
            }
        }
    }

    private func landscape() {
        ensureForeground()
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        if go("chats", "Chats") { shot("landscape-chats", settle: 2) } else { missing("landscape-chats") }
        let row = labelled("Plan a weekend in Lisbon")
        if tap(row, timeout: 3), element("chat.transcript").waitForExistence(timeout: 10) { shot("landscape-chat", settle: 2) } else { missing("landscape-chat") }
        if !regular { goBack(); sleep(1) }
        if go("settings", "Settings") { shot("landscape-settings", settle: 2) } else { missing("landscape-settings") }
        // Last: a phone's Machine page in landscape hides the tab bar.
        if go("machines", "Machines") { shot("landscape-machines", settle: 2) } else { missing("landscape-machines") }
        if tap(element("machine.row.s-vm"), timeout: 3) { shot("landscape-machine-detail", settle: 2); if !regular { goBack() } }
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        shot("portrait-again")
    }
}
