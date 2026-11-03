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

    /// The screenshot as it looks: a capture in landscape comes in the screen's native (portrait) pixels with an
    /// orientation tag, which not every viewer follows; drawn upright, it's a plain landscape PNG. A screen that stays
    /// portrait when the device turns (the foldable's cover screen) has no tag and stays as it is.
    static func upright(_ shot: XCUIScreenshot) -> Data {
        let image = shot.image
        guard image.imageOrientation != .up else { return shot.pngRepresentation }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).pngData { _ in image.draw(at: .zero) }
    }

    /// Saves a screenshot to the test results (and, with DEX_SCREENSHOTS set, to that folder).
    func snapshot(_ name: String) {
        // A foldable has two screens and `main` isn't always the lit one: the app's own then. (Open, the inner screen
        // still comes out black from XCTest on the simulator; look at it with the device tools instead.)
        let shot = XCUIScreen.screens.count > 1 && app.state == .runningForeground ? app.screenshot() : XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["DEX_SCREENSHOTS"] {
            let device = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "device"
            let url = URL(fileURLWithPath: folder).appendingPathComponent("\(device)-\(name).png")
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Self.upright(shot).write(to: url)
        }
    }
}
