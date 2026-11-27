import SwiftUI
import WebKit

/// An SVG picture (UIImage can't read SVG, and projects' favicons often are), drawn by WebKit as a plain image:
/// scripts are disabled and only `data:image/svg+xml` URLs are rendered.
struct SVGPicture: UIViewRepresentable {
    let dataUrl: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedUrl != dataUrl else { return }
        context.coordinator.loadedUrl = dataUrl
        guard dataUrl.lowercased().hasPrefix("data:image/svg+xml") else {
            view.loadHTMLString("", baseURL: nil)
            return
        }
        let escaped = dataUrl
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <html><head><meta name="viewport" content="width=device-width"></head>\
        <body style="margin:0;background:transparent"><img src="\(escaped)" style="width:100vw;height:100vh;object-fit:contain"></body></html>
        """
        view.loadHTMLString(html, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedUrl: String?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .allow }
            return url.absoluteString == "about:blank" ? .allow : .cancel
        }
    }
}
