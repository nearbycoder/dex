import SwiftUI
import WebKit

/// An SVG picture (UIImage can't read SVG, and projects' favicons often are), drawn by WebKit as a plain image: no
/// scripts run in an <img>.
struct SVGPicture: UIViewRepresentable {
    let dataUrl: String

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let html = """
        <html><head><meta name="viewport" content="width=device-width"></head>\
        <body style="margin:0;background:transparent"><img src="\(dataUrl)" style="width:100vw;height:100vh;object-fit:contain"></body></html>
        """
        view.loadHTMLString(html, baseURL: nil)
    }
}
