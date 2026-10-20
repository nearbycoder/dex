import XCTest

/// Generated UI (render_ui cards) rendered natively: charts and tables, buttons that message the chat, forms with
/// validation and secrets, Mutations that need confirming, and state kept across leaving the chat.
final class OpenUIUITests: DexUITestCase {
    /// Opens a chat. (Screenshots follow the simulator's appearance: run with `xcrun simctl ui <id> appearance dark`
    /// and another DEX_SCREENSHOTS folder for dark ones.)
    private func open(_ chat: String) {
        launch(["-DexOpenChat", chat])
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func text(containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Scrolls the transcript until the element is on screen.
    private func reveal(_ element: XCUIElement, up: Bool = false) {
        for _ in 0..<12 where !(element.exists && element.isHittable) {
            if up { app.swipeDown() } else { app.swipeUp() }
        }
    }

    func testChartCardRendersNatively() {
        open("s-chart")
        XCTAssertTrue(element("openui.chart.BarChart").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Total"].exists, "the table")
        XCTAssertTrue(app.staticTexts["Weekly visits"].exists)
        XCTAssertTrue(app.staticTexts["Friday"].exists)
        XCTAssertTrue(app.buttons["openui.button.Explain the peak"].exists)
        snapshot("openui-chart")
    }

    func testToAssistantButtonSendsAMessage() {
        open("s-chart")
        let button = app.buttons["openui.button.Explain the peak"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
        XCTAssertTrue(text(containing: "[UI action] Why was Friday the busiest day?").waitForExistence(timeout: 10))
    }

    func testFormValidatesAndSendsThePasswordAsASecret() {
        open("s-ui-form")
        let connect = app.buttons["openui.button.Connect"]
        XCTAssertTrue(connect.waitForExistence(timeout: 10))
        reveal(connect)
        connect.tap()
        XCTAssertTrue(text(containing: "This field is required").waitForExistence(timeout: 5), "an empty required field shows its error")
        XCTAssertFalse(text(containing: "[UI action]").exists, "an invalid form isn't sent")
        snapshot("openui-form-errors")

        let host = app.textFields["openui.field.host"]
        host.tap()
        host.typeText("db.example.com")
        let user = app.textFields["openui.field.user"]
        user.tap()
        user.typeText("analytics")
        let password = app.secureTextFields["openui.field.password"]
        password.tap()
        password.typeText("hunter2hunter2")
        app.buttons["openui.field.ssl"].tap()
        app.buttons["Require"].firstMatch.tap()
        reveal(connect)
        connect.tap()

        let sent = text(containing: "[UI action] Connect the database")
        XCTAssertTrue(sent.waitForExistence(timeout: 10))
        XCTAssertTrue(sent.label.contains("{{secret:password}}"), sent.label)
        XCTAssertFalse(sent.label.contains("hunter2"), "the password itself is never sent")
        XCTAssertTrue(sent.label.contains("db.example.com"))
        snapshot("openui-form-sent")
    }

    func testMutationAsksForConfirmationThenRuns() {
        open("s-ui-live")
        XCTAssertTrue(app.staticTexts["Summarize my inbox"].waitForExistence(timeout: 10), "the Query's rows load")
        XCTAssertTrue(text(containing: "app_usage_report: Usage isn't tracked here.").exists, "a failed Query is listed under the card")
        snapshot("openui-live")

        let cancel = app.buttons["openui.button.Cancel the first"]
        reveal(cancel)
        cancel.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts["Cancel the scheduled prompt “Summarize my inbox”"].exists, "Dex's own summary, not the button's label")
        snapshot("openui-confirm")
        alert.buttons["Confirm"].firstMatch.tap()

        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.staticTexts["Summarize my inbox"])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.staticTexts["Check the deploy"].exists)
    }

    func testTabsAndSwitchesKeepTheirStateWhenYouComeBack() {
        open("s-ui-tabs")
        let push = app.switches["openui.switch.push"]
        XCTAssertTrue(push.waitForExistence(timeout: 10))
        XCTAssertEqual(push.value as? String, "0")
        push.switches.firstMatch.tap()
        XCTAssertEqual(push.value as? String, "1")
        app.buttons["Quiet hours"].tap()
        let quiet = app.buttons["openui.field.quiet"]
        XCTAssertTrue(quiet.waitForExistence(timeout: 5))
        quiet.tap()
        app.buttons["From midnight"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Quiet from 0:00."].waitForExistence(timeout: 5))
        sleep(2) // the state is saved shortly after a change

        // Leave the chat, then come back to it.
        if isRegularWidth {
            app.staticTexts["Plan a weekend in Lisbon"].firstMatch.tap()
            XCTAssertTrue(app.staticTexts["Saturday"].waitForExistence(timeout: 10))
        } else {
            app.navigationBars.buttons.firstMatch.tap()
            XCTAssertTrue(app.staticTexts["Plan a weekend in Lisbon"].waitForExistence(timeout: 10))
        }
        let row = app.staticTexts["Notification preferences"].firstMatch
        reveal(row)
        row.tap()

        XCTAssertTrue(app.staticTexts["Quiet from 0:00."].waitForExistence(timeout: 10), "the open tab and the $variable are kept")
        XCTAssertTrue(app.buttons["Quiet hours"].isSelected)
        app.buttons["Channels"].tap()
        XCTAssertEqual(app.switches["openui.switch.push"].value as? String, "1", "the switch is kept")
        snapshot("openui-tabs")
    }

    func testGalleryShowsEveryComponent() {
        open("s-ui-gallery")
        XCTAssertTrue(app.staticTexts["Component gallery"].waitForExistence(timeout: 10))
        XCTAssertFalse(text(containing: "Unsupported component").exists)
        reveal(app.staticTexts["Component gallery"], up: true)
        let charts = ["BarChart", "LineChart", "AreaChart", "RadarChart", "HorizontalBarChart", "PieChart", "RadialChart", "SingleStackedBarChart", "ScatterChart"]
        var seen = Set<String>()
        for shot in 1...14 {
            snapshot("openui-gallery-\(shot)")
            seen.formUnion(charts.filter { element("openui.chart.\($0)").exists })
            if text(containing: "all of them").isHittable { break }
            app.swipeUp()
        }
        XCTAssertEqual(seen, Set(charts))
        XCTAssertFalse(text(containing: "Unsupported component").exists)
    }
}
