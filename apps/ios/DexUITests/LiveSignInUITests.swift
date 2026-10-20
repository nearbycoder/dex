import XCTest

/// The real sign-in, against a running Dex with dev login (e.g. `npm run dev`): set DEX_LIVE_SERVER in the test
/// runner's environment (TEST_RUNNER_DEX_LIVE_SERVER=http://localhost:5173 on the xcodebuild command line). It goes
/// through ASWebAuthenticationSession, the server's login page, the native confirmation page, and the dex:// callback.
final class LiveSignInUITests: XCTestCase {
    func testSignInWithDevLogin() throws {
        guard let server = ProcessInfo.processInfo.environment["DEX_LIVE_SERVER"], !server.isEmpty else { throw XCTSkip("Set DEX_LIVE_SERVER to run") }
        let app = XCUIApplication()
        app.launchArguments = ["-DexReset"]
        app.launch()

        let field = app.textFields["signin.server"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(server)
        app.buttons["signin.continue"].tap()

        // "Dex wants to use … to sign in."
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Continue"]
        if allow.waitForExistence(timeout: 10) { allow.tap() }

        let devLogin = app.webViews.buttons["Continue as local dev"]
        XCTAssertTrue(devLogin.waitForExistence(timeout: 20), "the server's login page")
        devLogin.tap()

        let confirm = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Continue as @'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 20), "the native sign-in confirmation page")
        attach("confirm-page", app)
        confirm.tap()

        // Signed in: the app connects and shows the inbox.
        XCTAssertTrue(app.navigationBars["Chats"].waitForExistence(timeout: 20) || app.buttons["chats.new"].waitForExistence(timeout: 5))
        attach("signed-in", app)
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("live-\(name).png"))
        }
    }
}
