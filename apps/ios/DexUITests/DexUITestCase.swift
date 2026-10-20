import XCTest

/// Base for UI tests: launches the app on the in-process mock agent.
class DexUITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-DexMock", "-DexReset", "-DexFast"]
    }

    func launch(_ extra: [String] = []) {
        app.launchArguments += extra
        app.launch()
    }

    /// Hardware keyboard events from XCUITest (`typeKey`) reach the app. They don't on the foldable (iPhone Duo)
    /// simulator: even plain keys into a focused field are lost there, while software-keyboard typing works.
    var hardwareKeysReachApp: Bool {
        ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] != "iPhone19,4"
    }

    /// The device is iPad-sized (or a wide window): the sidebar shows.
    var isRegularWidth: Bool { app.windows.firstMatch.frame.width >= 700 }

    /// Taps a tab (tab bar) or sidebar item by title.
    func openTab(_ title: String) {
        let tab = app.tabBars.buttons[title]
        if tab.exists { tab.tap(); return }
        let item = app.buttons[title].firstMatch
        if item.waitForExistence(timeout: 3) { item.tap(); return }
        app.staticTexts[title].firstMatch.tap()
    }

    /// Saves a screenshot to the test results (and, with DEX_SCREENSHOTS set, to that folder).
    func snapshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"] {
            let device = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "device"
            let url = URL(fileURLWithPath: folder).appendingPathComponent("\(device)-\(name).png")
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: url)
        }
    }
}
