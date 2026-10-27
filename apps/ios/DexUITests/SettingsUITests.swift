import XCTest

/// Settings, Secrets, Access & API, Notifications, Usage, and signing out, on the mock agent.
final class SettingsUITests: DexUITestCase {
    /// Opens a Settings page by its `SettingsPage` raw value.
    func openSettings(_ page: String) {
        openTab("Settings")
        let row = app.descendants(matching: .any)["settings.page.\(page)"].firstMatch
        XCTAssertTrue(app.descendants(matching: .any)["settings.page.account"].firstMatch.waitForExistence(timeout: 10))
        // Lower rows appear once scrolled to.
        var swipes = 0
        while !(row.exists && row.isHittable), swipes < 5 {
            app.descendants(matching: .any)["settings.list"].firstMatch.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(row.waitForExistence(timeout: 5), "No Settings row for \(page)")
        row.tap()
    }

    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The navigation back button (in the bar, or the foldable's side toolbar).
    func goBack() {
        let back = app.buttons["BackButton"].firstMatch
        if back.exists { back.tap() } else { app.navigationBars.buttons.element(boundBy: 0).tap() }
    }

    /// Any element whose label contains `fragment` (rows combine their texts into one label).
    func text(_ fragment: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    /// Scrolls until `element` is on screen.
    func reveal(_ element: XCUIElement, maxSwipes: Int = 8) {
        var swipes = 0
        // Clear of the tab bar and keyboard, not just on screen.
        let bottom = app.windows.firstMatch.frame.maxY - 160
        while !(element.exists && element.isHittable && element.frame.maxY < bottom), swipes < maxSwipes {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
    }

    func flip(_ id: String) {
        let toggle = app.switches[id].firstMatch
        reveal(toggle)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "No switch \(id)")
        // The switch itself, not its label (iOS 26 rows).
        let knob = toggle.switches.firstMatch
        let before = isOn(id)
        (knob.exists ? knob : toggle).tap()
        // The foldable's side toolbar can swallow a tap on the knob: try the switch's own end of the row.
        let permissionAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if isOn(id) == before, !waitForChange(id, from: before), !permissionAlert.exists {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
    }

    private func waitForChange(_ id: String, from value: Bool) -> Bool {
        let deadline = Date.now.addingTimeInterval(2)
        while Date.now < deadline {
            if isOn(id) != value { return true }
            usleep(200_000)
        }
        return false
    }

    func isOn(_ id: String) -> Bool {
        let toggle = app.switches[id].firstMatch
        let inner = toggle.switches.firstMatch
        return (toggle.value as? String) == "1" || (inner.exists && (inner.value as? String) == "1")
    }

    // MARK: Pages

    func testSettingsPagesOpen() {
        launch()
        for page in ["account", "models", "machines", "github", "defaults", "secrets", "access", "notifications", "usage", "about"] {
            openSettings(page)
            XCTAssertTrue(app.navigationBars.element(boundBy: app.navigationBars.count - 1).waitForExistence(timeout: 5))
            snapshot("settings-\(page)")
            if !isRegularWidth { goBack() }
        }
    }

    func testConnectAndDisconnectAKey() {
        launch()
        openSettings("models")
        let key = app.secureTextFields["opencode.key"]
        reveal(key)
        XCTAssertTrue(key.waitForExistence(timeout: 5))
        key.tap()
        key.typeText("bad-key")
        element("opencode.connect").tap()

        XCTAssertTrue(element("message.error").waitForExistence(timeout: 5), "A rejected key says why")

        key.tap()
        key.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + "sk-good1234")
        element("opencode.connect").tap()
        let status = element("opencode.status")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "…1234")
        snapshot("models-connected")

        let disconnect = element("opencode.disconnect")
        reveal(disconnect)
        disconnect.tap()
        app.buttons["Disconnect"].firstMatch.tap()
        XCTAssertTrue(app.secureTextFields["opencode.key"].waitForExistence(timeout: 5))
        XCTAssertFalse(element("opencode.status").exists)
    }

    /// The mock agent opens no page: the address is pasted, as when the app can't listen for the callback.
    func testChatGPTSignInByPaste() {
        launch()
        openSettings("models")
        let start = element("chatgpt.start")
        reveal(start)
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()

        let field = element("chatgpt.callback")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        reveal(field)
        field.tap()
        field.typeText("http://127.0.0.1:1455/auth/callback?state=mock")
        element("chatgpt.connect").tap()
        XCTAssertTrue(element("message.error").waitForExistence(timeout: 5), "An address without a code says why")

        field.tap()
        field.typeText("&code=abc")
        element("chatgpt.connect").tap()
        let status = element("chatgpt.status")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "you@example.com")
        snapshot("models-chatgpt-connected")

        let disconnect = element("chatgpt.disconnect")
        reveal(disconnect)
        disconnect.tap()
        app.buttons["Disconnect"].firstMatch.tap()
        XCTAssertTrue(element("chatgpt.start").waitForExistence(timeout: 5))
        XCTAssertFalse(element("chatgpt.status").exists)
    }

    func testBoatKeyIsKeptWhileVMsRun() {
        launch()
        openSettings("machines")
        let disconnect = element("boat.disconnect")
        reveal(disconnect)
        disconnect.tap()
        app.buttons["Disconnect"].firstMatch.tap()
        let error = element("message.error")
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("Delete your"))
        XCTAssertTrue(element("boat.status").exists)
    }

    func testGitHubDisconnectAndConnect() {
        launch()
        openSettings("github")
        XCTAssertTrue(element("github.status").waitForExistence(timeout: 5))
        element("github.disconnect").tap()
        app.buttons["Disconnect"].firstMatch.tap()
        let connect = element("github.connectOAuth")
        XCTAssertTrue(connect.waitForExistence(timeout: 5))
        snapshot("github-disconnected")
        // The token path.
        element("github.useToken").tap()
        let token = app.secureTextFields["github.key"]
        XCTAssertTrue(token.waitForExistence(timeout: 5))
        token.tap()
        token.typeText("github_pat_123")
        element("github.connect").tap()
        XCTAssertTrue(element("github.status").waitForExistence(timeout: 5))
        XCTAssertTrue(element("github.status").label.contains("token"))
    }

    func testChangeDefaults() {
        launch()
        openSettings("defaults")
        let model = element("defaults.model")
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        model.tap()
        let search = app.searchFields.firstMatch
        if search.waitForExistence(timeout: 5) { search.tap(); search.typeText("Kimi") }
        let kimi = element("model.cline-pass/kimi-k3")
        XCTAssertTrue(kimi.waitForExistence(timeout: 5))
        kimi.tap()
        XCTAssertTrue(app.staticTexts["Kimi K3"].waitForExistence(timeout: 5))

        let editor = element("defaults.instructions")
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" Use metric units.")
        let save = element("defaults.save")
        reveal(save)
        save.tap()
        XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 5))
    }

    func testScheduledPromptCancel() {
        launch()
        openSettings("defaults")
        let schedule = element("schedule.sch-1")
        reveal(schedule)
        XCTAssertTrue(schedule.waitForExistence(timeout: 5))
        schedule.swipeLeft()
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(element("schedule.sch-1").waitForNonExistence(timeout: 5))
        XCTAssertTrue(element("schedule.sch-2").exists)
    }

    func testSecretsAddEditDelete() {
        launch()
        openSettings("secrets")
        XCTAssertTrue(element("secret.OPENAI_API_KEY").waitForExistence(timeout: 5))
        element("secrets.add").tap()
        let name = app.textFields["secret.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.typeText("my-token")
        XCTAssertEqual(name.value as? String, "MY_TOKEN")
        let value = app.secureTextFields["secret.value"]
        value.tap()
        value.typeText("s3cret")
        app.textFields["secret.note"].tap()
        app.textFields["secret.note"].typeText("For the CLI")
        element("secret.save").tap()
        let row = element("secret.MY_TOKEN")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(text("Saved MY_TOKEN").exists)

        // Edit the note only: the value stays.
        row.tap()
        let note = app.textFields["secret.note"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText(" on VMs")
        element("secret.save").tap()
        XCTAssertTrue(text("on VMs").waitForExistence(timeout: 5))

        element("secret.MY_TOKEN").swipeLeft()
        app.buttons["Delete"].firstMatch.tap()
        element("secrets.confirmDelete").tap()
        XCTAssertTrue(element("secret.MY_TOKEN").waitForNonExistence(timeout: 5))
    }

    func testCreateTokenShowsSecretOnceThenRevoke() {
        launch()
        openSettings("access")
        XCTAssertTrue(element("access.endpoint").waitForExistence(timeout: 5))
        // Pending actions sit above it: on a short screen it's further down.
        reveal(element("access.newToken"))
        element("access.newToken").tap()
        let label = app.textFields["token.label"]
        XCTAssertTrue(label.waitForExistence(timeout: 5))
        label.tap()
        label.typeText("Laptop")
        app.segmentedControls["token.scope"].buttons["Full"].tap()
        element("token.create").tap()
        XCTAssertTrue(element("token.warning").waitForExistence(timeout: 5))
        let secret = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'dexk.'")).firstMatch
        XCTAssertTrue(secret.exists)
        snapshot("token-created")
        element("token.done").tap()

        // Shown once: the page only lists the token.
        let row = element("token.Laptop")
        XCTAssertTrue(element("token.warning").waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'dexk.'")).firstMatch.exists)
        reveal(row)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeLeft()
        let revoke = app.buttons["Revoke"].firstMatch
        if !revoke.waitForExistence(timeout: 3) { row.press(forDuration: 1.2) }
        revoke.tap()
        element("access.confirmRevoke").tap()
        XCTAssertTrue(element("token.Laptop").waitForNonExistence(timeout: 5))
    }

    func testApprovePendingAction() {
        launch()
        openSettings("access")
        let confirm = element("pending.confirm.pa-1")
        reveal(confirm)
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        snapshot("access-pending")
        confirm.tap()
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 5))
        let activity = element("access.activity")
        reveal(activity)
        activity.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'You confirmed'")).firstMatch.waitForExistence(timeout: 5))
    }

    func testNotificationPreferences() {
        launch()
        openSettings("notifications")
        let enabled = app.switches["notify.enabled"].firstMatch
        XCTAssertTrue(enabled.waitForExistence(timeout: 5))
        let turnOn = {
            self.flip("notify.enabled")
            let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
            if allow.waitForExistence(timeout: 5) { allow.tap() }
        }
        if !isOn("notify.enabled") { turnOn() }
        // iOS answers the permission request asynchronously.
        let deadline = Date.now.addingTimeInterval(10)
        while !isOn("notify.enabled"), Date.now < deadline { usleep(250_000) }
        XCTAssertTrue(isOn("notify.enabled"))
        // The kinds show while notifications are on (lower rows appear once scrolled to).
        let kind = app.switches["notify.kind.scheduled"].firstMatch
        reveal(kind)
        XCTAssertTrue(kind.waitForExistence(timeout: 10))
        let wasOn = isOn("notify.kind.scheduled")
        flip("notify.kind.scheduled")
        XCTAssertNotEqual(isOn("notify.kind.scheduled"), wasOn)
        snapshot("notifications")

        // Another device, registered for Web Push.
        let device = element("push.d-2")
        reveal(device)
        device.tap()
        XCTAssertTrue(app.switches["push.kind.mcp"].waitForExistence(timeout: 5))
        XCTAssertFalse(isOn("push.kind.mcp"))
        flip("push.kind.mcp")
        XCTAssertTrue(NSPredicate(format: "value == '1'").evaluate(with: app.switches["push.kind.mcp"].firstMatch) || isOn("push.kind.mcp"))
        reveal(element("push.test"))
        element("push.test").tap()
        XCTAssertTrue(element("message.error").waitForExistence(timeout: 5), "The device's delivery error comes back from the test")
        let remove = element("push.remove")
        reveal(remove)
        remove.tap()
        app.buttons["Remove"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Device Removed"].waitForExistence(timeout: 5) || element("push.d-1").waitForExistence(timeout: 5))
    }

    func testUsageRanges() {
        launch()
        openSettings("usage")
        let headline = element("usage.headline")
        XCTAssertTrue(headline.waitForExistence(timeout: 10))
        app.segmentedControls["usage.range"].buttons["This month"].tap()
        XCTAssertTrue(text("Estimated bill this month").waitForExistence(timeout: 10))
        XCTAssertTrue(element("usage.chart").exists)
        snapshot("usage-month")
        app.segmentedControls["usage.range"].buttons["Last 30 days"].tap()

        XCTAssertTrue(text("Variable spend").waitForExistence(timeout: 10))
        app.segmentedControls["usage.view"].buttons["Table"].tap()
        XCTAssertTrue(element("usage.table").waitForExistence(timeout: 5))
        app.segmentedControls["usage.range"].buttons["All time"].tap()
        XCTAssertTrue(text("Variable spend").waitForExistence(timeout: 10))
        // A top chat opens it.
        let chat = element("usage.chat.s-vm")
        reveal(chat, maxSwipes: 14)
        chat.tap()
        XCTAssertTrue(chat.waitForNonExistence(timeout: 10), "The chat opens in Chats")
    }

    func testAboutShowsBuilds() {
        launch()
        openSettings("about")
        XCTAssertTrue(element("about.version").waitForExistence(timeout: 5))
        XCTAssertTrue(element("about.connection").label.contains("Connected"))
    }

    func testSignOutEverywhere() {
        launch()
        openSettings("account")
        let button = element("account.signOutEverywhere")
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        element("account.confirmEverywhere").tap()
        XCTAssertTrue(app.textFields["signin.server"].waitForExistence(timeout: 10))
        XCTAssertTrue(element("signin.error").exists)
        snapshot("signed-out-everywhere")
    }
}
