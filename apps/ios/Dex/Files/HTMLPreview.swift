import SwiftUI
import WebKit

/// An HTML file, rendered live. The agent writes these files, so they're untrusted: the page runs in a web view with
/// its own throwaway data store and no base URL (an opaque origin), so its scripts run and it can load libraries and
/// fonts from anywhere, like the web's sandboxed preview, but it never sees Dex's session or this app's storage.
/// Links it opens go to the browser.
struct HTMLPreview: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isInspectable = true
        view.loadHTMLString(html, baseURL: nil)
        context.coordinator.loaded = html
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        view.loadHTMLString(html, baseURL: nil)
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
