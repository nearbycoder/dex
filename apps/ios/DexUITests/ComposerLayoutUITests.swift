import XCTest

/// The composer's row fits its room on every screen: Attach, the model, thinking, and MCP chips, and Send never overlap
/// or reach past the composer, also with the longest chips (`-DexLongChips`) and large text. Matters most on the
/// narrowest screens (iPhone SE, the foldable's cover screen beside its side rail).
final class ComposerLayoutUITests: DexUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    private func checkComposer(_ chat: String, textSize: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        var extra = ["-DexLongChips", "-DexOpenChat", chat]
        if let textSize { extra += ["-UIPreferredContentSizeCategoryName", textSize] }
        launch(extra)
        let composer = element("composer")
        XCTAssertTrue(composer.waitForExistence(timeout: 15), "the composer shows", file: file, line: line)
        XCTAssertTrue(element("composer.mcp").waitForExistence(timeout: 10), "the chips show", file: file, line: line)
        sleep(1)
        snapshot("composer-layout-\(chat)\(textSize.map { "-\($0)" } ?? "")")
        let window = app.windows.firstMatch.frame
        let box = composer.frame
        XCTAssertTrue(window.insetBy(dx: -0.5, dy: -0.5).contains(box), "the composer \(box) is on screen \(window)", file: file, line: line)
        let ids = ["composer.attach", "composer.model", "composer.thinking", "composer.mcp", "composer.send"]
        var frames: [(String, CGRect)] = []
        for id in ids {
            let control = element(id)
            XCTAssertTrue(control.exists, "\(id) shows", file: file, line: line)
            let frame = control.frame
            XCTAssertGreaterThan(frame.width, 20, "\(id) isn't squashed: \(frame)", file: file, line: line)
            XCTAssertTrue(box.insetBy(dx: -0.5, dy: -0.5).contains(frame), "\(id) \(frame) stays inside the composer \(box)", file: file, line: line)
            XCTAssertTrue(control.isHittable, "\(id) can be tapped", file: file, line: line)
            frames.append((id, frame))
        }
        for (index, (a, first)) in frames.enumerated() {
            for (b, second) in frames[(index + 1)...] {
                let overlap = first.intersection(second)
                XCTAssertTrue(overlap.isNull || overlap.width < 0.5 || overlap.height < 0.5, "\(a) \(first) and \(b) \(second) overlap", file: file, line: line)
            }
        }
        // Left to right, as laid out.
        XCTAssertEqual(frames.sorted { $0.1.minX < $1.1.minX }.map(\.0), ids, file: file, line: line)
        // Whatever fits, the labels say everything.
        XCTAssertTrue(element("composer.model").label.contains("Gemini 4 Argon (Contributor)"), element("composer.model").label, file: file, line: line)
        XCTAssertTrue(element("composer.thinking").label.contains("Extra high"), element("composer.thinking").label, file: file, line: line)
        XCTAssertTrue(element("composer.mcp").label.contains("Linear"), element("composer.mcp").label, file: file, line: line)
    }

    func testComposerFitsInACharacterChat() { checkComposer("s-muse") }

    func testComposerFitsInAChat() { checkComposer("s-welcome") }

    func testComposerFitsAtLargeText() { checkComposer("s-muse", textSize: "UICTContentSizeCategoryAccessibilityXL") }

    /// The thinking chip still opens its menu where it shows only the brain and bars.
    func testNarrowThinkingChipStillWorks() {
        launch(["-DexLongChips", "-DexOpenChat", "s-welcome"])
        let thinking = app.buttons["composer.thinking"]
        XCTAssertTrue(thinking.waitForExistence(timeout: 15))
        thinking.tap()
        app.buttons["High"].firstMatch.tap()
        let picked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'High' AND NOT (label CONTAINS 'Extra')"), object: thinking)
        XCTAssertEqual(XCTWaiter().wait(for: [picked], timeout: 10), .completed, thinking.label)
    }
}
