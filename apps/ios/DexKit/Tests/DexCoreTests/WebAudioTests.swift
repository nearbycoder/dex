import Foundation
import Testing
@testable import DexCore

@Suite struct WebAudioTests {
    @Test func unlockGoesFirst() {
        let script = WebAudio.unlockScript
        #expect(script.hasPrefix("<script>") && script.hasSuffix("</script>") && script.contains("__dexUnlock"))
        #expect(WebAudio.withAudioUnlock("<!doctype html><html lang=en><HEAD><title>x</title></head>") == "<!doctype html><html lang=en><HEAD>\(script)<title>x</title></head>")
        #expect(WebAudio.withAudioUnlock("<html><body>hi</body></html>") == "<html>\(script)<body>hi</body></html>")
        #expect(WebAudio.withAudioUnlock("<!DOCTYPE html><p>hi") == "<!DOCTYPE html>\(script)<p>hi")
        #expect(WebAudio.withAudioUnlock("<p>hi</p>") == "\(script)<p>hi</p>")
        let once = WebAudio.withAudioUnlock("<p>hi</p>")
        #expect(WebAudio.withAudioUnlock(once) == once)
    }

    /// The same script as the web's (apps/web/src/shared/web-audio.ts), when the repo is around.
    @Test func matchesTheWeb() throws {
        let web = URL(fileURLWithPath: #filePath).appending(path: "../../../../../web/src/shared/web-audio.ts").standardized
        guard let source = try? String(contentsOf: web, encoding: .utf8) else { return }
        let start = try #require(source.range(of: "export const AUDIO_UNLOCK_SCRIPT = `"))
        let end = try #require(source[start.upperBound...].firstIndex(of: "`"))
        #expect(String(source[start.upperBound..<end]) == WebAudio.unlockScript)
    }
}
