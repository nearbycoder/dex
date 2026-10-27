import DexCore
import SwiftUI
import WebKit

/// An HTML file, rendered live. The agent writes these files, so they're untrusted: the page runs in a web view with
/// its own throwaway data store and no base URL (an opaque origin), so its scripts run and it can load libraries and
/// fonts from anywhere, like the web's sandboxed preview, but it never sees Dex's session or this app's storage.
/// Links it opens go to the browser. Its sound plays on a tap, even with the Ring/Silent switch on silent (WebAudio,
/// as the web's preview does). A page that picks no colors of its own follows the app's light or dark appearance; one
/// that does keeps the look it was written for.
struct HTMLPreview: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // The audio unlock's silent <audio> plays in the page, not full screen.
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isInspectable = true
        show(in: view)
        context.coordinator.loaded = html
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        show(in: view)
    }

    private func show(in view: WKWebView) {
        let adaptive = Self.followsAppearance(html)
        // An adaptive page's overscroll matches the app's background; others stay white, as written.
        view.underPageBackgroundColor = adaptive ? .systemBackground : .white
        view.loadHTMLString(WebAudio.withAudioUnlock(adaptive ? Self.withColorScheme(html) : html), baseURL: nil)
    }

    /// Whether the page leaves its colors to the browser: no color scheme, no background, and no text color for the
    /// whole page (a colored heading is fine; dark body text on a dark background isn't).
    static func followsAppearance(_ html: String) -> Bool {
        let page = html.lowercased()
        let patterns = [
            #"color-scheme"#,
            #"background(-color|-image)?\s*:"#,
            #"\bbgcolor\s*="#,
            #"(^|[\s,}>])(html|body|:root|\*)[^{}]*\{([^}]*[;\s])?\s*color\s*:"#,
            #"<body[^>]*\b(text\s*=|style\s*=\s*["'][^"']*\bcolor\s*:)"#,
        ]
        return !patterns.contains { page.range(of: $0, options: .regularExpression) != nil }
    }

    /// `html` with a `color-scheme` meta, so the browser's own colors follow light and dark: right after `<head>`, else
    /// `<html>`, else the doctype (never before it, which would put the page in quirks mode), else at the very start.
    static func withColorScheme(_ html: String) -> String {
        let meta = #"<meta name="color-scheme" content="light dark">"#
        for pattern in ["<head[^>]*>", "<html[^>]*>", "<!doctype[^>]*>"] {
            if let range = html.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
                return String(html[..<range.upperBound]) + meta + String(html[range.upperBound...])
            }
        }
        return meta + html
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var loaded: String?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            // The page's own loads (and its frames) are fine; a link you tap leaves for the browser.
            guard action.navigationType == .linkActivated, action.targetFrame?.isMainFrame != false, let url = action.request.url else { return .allow }
            if url.scheme == "http" || url.scheme == "https" { await UIApplication.shared.open(url) }
            return .cancel
        }

        /// `target="_blank"` and `window.open`: open in the browser instead of a new web view.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
            return nil
        }
    }
}
