import DexCore
import SwiftUI
import WebKit

/// A VM's live desktop: fetches the page to show (`vmDesktopUrl`), keeps trying while the VM or its desktop starts,
/// and shows it in a web view. Selkies by default (it plays in WebKit); noVNC and boat's Stream are the alternatives.
struct DesktopSurface: View {
    @Environment(DexClient.self) private var client
    @Environment(\.scenePhase) private var scenePhase
    let vm: VmInfo
    var mode: DesktopMode = .selkies
    /// The chat preview: Selkies without its touch controls, and nothing reaches the VM.
    var watchOnly = false
    /// Taps and keys go to the VM (else the picture is view-only).
    var interactive = false
    /// Lays the page out at this size and scales it to fit: the players fit their picture once, when they connect, so
    /// a window that resizes continuously (the preview) keeps a fixed page. Nil: the page takes the view's size and
    /// reconnects after a resize settles.
    var fixedLayout: CGSize? = nil
    /// Bumped by the owner to reconnect.
    var reconnect = 0
    var compactPlaceholder = false

    @State private var url: URL?
    @State private var loading = false
    @State private var message: String?
    @State private var generation = 0
    @State private var pageFailed: String?
    @State private var pageLoaded = false
    @State private var width: CGFloat = 0
    @State private var loadedWidth: CGFloat = 0

    private var running: Bool { vm.status == "running" }

    var body: some View {
        ZStack {
            Color.black
            if running, let url, pageFailed == nil {
                page(url)
                if !pageLoaded { ProgressView().tint(.white) }
            } else {
                placeholder
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .task(id: LoadKey(running: running, mode: mode, generation: generation &+ reconnect)) { await load() }
        // A page laid out at the view's size reconnects once a resize (rotation, a split view) settles.
        .task(id: fixedLayout == nil ? Int(width / 40) : 0) {
            guard fixedLayout == nil, width > 0 else { return }
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            if loadedWidth > 0, abs(width - loadedWidth) > 40, url != nil { generation += 1 }
            loadedWidth = width
        }
        .onChange(of: scenePhase) { old, phase in
            // The stream drops while the app is in the background: reconnect on return.
            if phase == .active, old == .background { generation += 1 }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(watchOnly ? "vmPreview.desktop" : "machine.desktop")
    }

    @ViewBuilder
    private func page(_ url: URL) -> some View {
        let credentials = client.credentials
        let web = DesktopWebView(
            url: url, cookie: credentials.flatMap { DesktopURL.isOnServer(url, server: $0.server) ? DexHTTP.cookie(server: $0.server, token: $0.token) : nil },
            interactive: interactive && !watchOnly, generation: generation
        ) { state in
            switch state {
            case .loaded: pageLoaded = true
            case .failed(let error):
                pageFailed = error
                // Usually the relay saying the stream isn't up yet: try again shortly.
                Task {
                    try? await Task.sleep(for: .seconds(4))
                    if pageFailed != nil { pageFailed = nil; generation += 1 }
                }
            }
        }
        if let fixedLayout {
            GeometryReader { geometry in
                web.frame(width: fixedLayout.width, height: fixedLayout.height)
                    .scaleEffect(geometry.size.width / fixedLayout.width, anchor: .topLeading)
            }
            .clipped()
        } else {
            web
        }
    }

    private var placeholder: some View {
        VStack(spacing: compactPlaceholder ? 4 : 10) {
            if loading || vm.status == "starting" || pageFailed != nil {
                ProgressView().tint(.white)
            } else {
                Image(systemName: "display").font(compactPlaceholder ? .body : .title2)
            }
            Text(placeholderText)
                .font(compactPlaceholder ? .caption2 : .footnote)
                .multilineTextAlignment(.center)
            if !compactPlaceholder, running, mode == .stream {
                Text("If the stream stays on “Connecting”, switch to Selkies or noVNC.").font(.caption2).opacity(0.7)
            }
        }
        .foregroundStyle(.white.opacity(0.75))
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("desktop.placeholder")
    }

    private var placeholderText: String {
        if running {
            if let pageFailed { return pageFailed }
            if let message { return message }
            return mode == .selkies ? "Starting the desktop stream… (the first time on a VM takes about 30 seconds)" : "Connecting to the desktop…"
        }
        if vm.status == "starting" { return "The VM is starting…" }
        return watchOnly ? "The VM isn't running." : "The desktop appears here while the VM is running."
    }

    private struct LoadKey: Hashable {
        var running: Bool
        var mode: DesktopMode
        var generation: Int
    }

    /// Fetches the page, trying again every few seconds while the desktop is still starting.
    private func load() async {
        pageLoaded = false
        pageFailed = nil
        guard running else {
            url = nil
            message = nil
            return
        }
        while !Task.isCancelled {
            loading = true
            do {
                if let raw = try await client.vmDesktopUrl(vm.key, mode: mode), let server = client.server ?? URL(string: "https://localhost"),
                   let resolved = DesktopURL.resolve(raw, server: server, watchOnly: watchOnly) {
                    url = resolved
                    message = nil
                    loading = false
                    return
                }
                message = "The desktop is still starting. Trying again…"
            } catch {
                if Task.isCancelled { break }
                message = error.localizedDescription
            }
            loading = false
            try? await Task.sleep(for: .seconds(5))
        }
        loading = false
    }
}

/// The web view that plays the desktop page. Each one has its own throwaway website data store, so the session cookie
/// it's given (for Dex's own `/vm-desktop/` relay) and whatever the page stores go nowhere else.
struct DesktopWebView: UIViewRepresentable {
    enum PageState { case loaded, failed(String) }

    let url: URL
    let cookie: HTTPCookie?
    let interactive: Bool
    let generation: Int
    let onState: (PageState) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        webView.navigationDelegate = context.coordinator
        #if DEBUG
        webView.isInspectable = true
        #endif
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onState = onState
        webView.isUserInteractionEnabled = interactive
        let key = "\(url.absoluteString)#\(generation)"
        guard context.coordinator.loadedKey != key else { return }
        context.coordinator.loadedKey = key
        let request = URLRequest(url: url)
        if let cookie {
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { webView.load(request) }
        } else {
            webView.load(request)
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // Leaving the page closes the stream's WebSocket.
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedKey: String?
        var onState: ((PageState) -> Void)?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onState?(.loaded)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }

        private func fail(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            onState?(.failed(error.localizedDescription))
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            // The relay answers 503 while the VM or its stream isn't up: show progress instead of its error page.
            if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
                onState?(.failed(response.statusCode == 503 ? "Waiting for the desktop stream…" : "The desktop answered \(response.statusCode). Retrying…"))
                return .cancel
            }
            return .allow
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            // Links the desktop opens (a new window) go to Safari, not into the stream's view.
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url, url.scheme == "https" {
                await UIApplication.shared.open(url)
                return .cancel
            }
            return .allow
        }
    }
}
