import AVKit
import DexCore
import SafariServices
import SwiftUI
import WebKit

// Inline media in chats (the web's media.tsx). Media Dex stores plays straight away; anything from another site
// loads only when you tap play, so a link the model wrote never fetches anything on its own. Links to a chat VM's
// port aren't played from the VM: Dex saves the file into the chat and plays that copy.

extension EnvironmentValues {
    /// The open chat, for media that needs it (saving a VM file into the chat, screenshots).
    @Entry var chatFeed: ChatFeed? = nil
}

/// A video, audio file, or image Dex stores (or a chat VM link to one), or a player card for a video elsewhere.
struct ChatMediaView: View {
    let source: ChatMedia.Source
    var title: String?

    var body: some View {
        switch source {
        case .own(let url, let kind):
            StoredMediaView(url: url, kind: kind, title: title)
        case .vm(let url, let kind):
            VmMediaView(url: url, kind: kind, title: title)
        case .file, .youtube, .vimeo:
            ExternalVideoView(source: source, title: title)
        }
    }

    /// The resolver MarkdownView uses to show media links in replies.
    static func resolver(server: URL?) -> MarkdownMedia {
        MarkdownMedia(accepts: { ChatMedia.source($0, server: server) != nil }) { url, title in
            guard let source = ChatMedia.source(url, server: server) else { return AnyView(EmptyView()) }
            return AnyView(ChatMediaView(source: source, title: title))
        }
    }
}

/// Media in Dex's storage: an image (tap to zoom), a video, or an audio player.
struct StoredMediaView: View {
    @Environment(DexClient.self) private var client
    let url: String
    let kind: ChatMedia.Kind
    var title: String?

    var body: some View {
        if let absolute = ChatMedia.absolute(url, server: client.server) {
            switch kind {
            case .image: StoredImageView(url: absolute, title: title)
            case .video: VideoPlayerCard(url: absolute, title: title, autoplay: false)
            case .audio: AudioPlayerRow(url: absolute, title: title ?? ChatMedia.fileName(url))
            }
        }
    }
}

struct StoredImageView: View {
    @Environment(DexClient.self) private var client
    let url: URL
    var title: String?
    @State private var image: UIImage?
    @State private var failed = false
    @State private var zoomed = false

    var body: some View {
        Group {
            if let image {
                Button { zoomed = true } label: {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 560, maxHeight: 420, alignment: .leading)
                        .clipShape(.rect(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.quaternary))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title ?? "Image")
                .accessibilityHint("Opens it full screen")
                .contextMenu {
                    Button { UIPasteboard.general.image = image } label: { Label("Copy", systemImage: "doc.on.doc") }
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(title ?? "Image", image: Image(uiImage: image)))
                }
                .fullScreenCover(isPresented: $zoomed) { ImageViewer(image: image, title: title) }
            } else if failed {
                Label("Couldn't load \(title ?? ChatMedia.fileName(url.absoluteString))", systemImage: "photo.badge.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.quaternary.opacity(0.5))
                    .frame(maxWidth: 560)
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .overlay { ProgressView() }
            }
        }
        .accessibilityIdentifier("media.image")
        .task(id: url) {
            if let cached = MediaLoader.shared.cached(url.absoluteString) { image = cached; return }
            do { image = try await MediaLoader.shared.image(url, client: client) } catch { failed = true }
        }
    }
}

/// A picture full screen: pinch or double-tap to zoom, share, done.
struct ImageViewer: View {
    @Environment(\.dismiss) private var dismiss
    let image: UIImage
    var title: String?

    var body: some View {
        NavigationStack {
            ZoomableImage(image: image)
                .ignoresSafeArea()
                .background(.black)
                .navigationTitle(title ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }.accessibilityIdentifier("media.viewer.done")
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        ShareLink(item: Image(uiImage: image), preview: SharePreview(title ?? "Image", image: Image(uiImage: image)))
                    }
                }
        }
        .preferredColorScheme(.dark)
    }
}

/// An image in a scroll view that zooms (UIKit's, for natural pinch and double-tap).
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.translatesAutoresizingMaskIntoConstraints = false
        view.isUserInteractionEnabled = true
        view.accessibilityIdentifier = "media.viewer.image"
        scroll.addSubview(view)
        NSLayoutConstraint.activate([
            view.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            view.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            view.centerXAnchor.constraint(equalTo: scroll.contentLayoutGuide.centerXAnchor),
            view.centerYAnchor.constraint(equalTo: scroll.contentLayoutGuide.centerYAnchor)
        ])
        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        context.coordinator.imageView = view
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 { scroll.setZoomScale(1, animated: true); return }
            let point = gesture.location(in: imageView)
            let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
            scroll.zoom(to: CGRect(origin: CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2), size: size), animated: true)
        }
    }
}

/// A video in AVKit's player (picture in picture, AirPlay, full screen). Nothing loads until it's on screen, and it
/// plays only when you tap play (unless `autoplay`, after a play card).
struct VideoPlayerCard: View {
    @Environment(DexClient.self) private var client
    let url: URL
    var title: String?
    var autoplay = false
    var onFailure: (() -> Void)? = nil
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView().tint(.white)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .frame(maxWidth: 560)
        .clipShape(.rect(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title ?? "Video")
        .accessibilityIdentifier("media.video")
        .task(id: url) {
            let item = AVPlayerItem(asset: MediaLoader.shared.asset(url, client: client))
            let player = AVPlayer(playerItem: item)
            self.player = player
            if autoplay { player.play() }
            guard let onFailure else { return }
            for await status in item.publisher(for: \.status).values where status == .failed {
                onFailure()
                return
            }
        }
        .onDisappear { player?.pause() }
    }
}

/// An audio file: play/pause, where it is, and how long it is.
struct AudioPlayerRow: View {
    @Environment(DexClient.self) private var client
    let url: URL
    let title: String
    @State private var player: AVPlayer?
    @State private var playing = false

    var body: some View {
        HStack(spacing: 12) {
            Button {
                guard let player else { return }
                if playing { player.pause() } else {
                    if let item = player.currentItem, item.currentTime() >= item.duration { player.seek(to: .zero) }
                    player.play()
                }
                playing.toggle()
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .frame(width: 44, height: 44)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel(playing ? "Pause" : "Play")
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
                TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                    let item = player?.currentItem
                    let elapsed = item?.currentTime().seconds ?? 0
                    let total = item?.duration.seconds ?? .nan
                    VStack(alignment: .leading, spacing: 3) {
                        ProgressView(value: total.isFinite && total > 0 ? min(elapsed / total, 1) : 0)
                        Text("\(Self.clock(elapsed)) / \(total.isFinite ? Self.clock(total) : "–:––")")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 560)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
        .accessibilityIdentifier("media.audio")
        .task(id: url) { player = AVPlayer(playerItem: AVPlayerItem(asset: MediaLoader.shared.asset(url, client: client))) }
        .onReceive(NotificationCenter.default.publisher(for: AVPlayerItem.didPlayToEndTimeNotification)) { note in
            if (note.object as? AVPlayerItem) === player?.currentItem { playing = false }
        }
        .onDisappear { player?.pause(); playing = false }
    }

    static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.isFinite ? seconds : 0))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// A file linked from the chat's VM. Once saved into the chat (automatically when the reply ends, or with "Save to
/// chat") it plays from Dex; until then, this card.
struct VmMediaView: View {
    @Environment(\.chatFeed) private var feed
    let url: String
    let kind: ChatMedia.Kind
    var title: String?
    @State private var requested = false
    @State private var error: String?

    var body: some View {
        let source = ChatMedia.vmSource(url)?.source
        let artifacts = feed?.transcript.artifacts ?? []
        if let source, let saved = ChatMedia.bySource(artifacts)[source] {
            StoredMediaView(url: saved.url, kind: ChatMedia.Kind(rawValue: saved.kind) ?? kind, title: title ?? saved.name)
        } else {
            let saving = requested || (source.map { feed?.transcript.savingArtifacts.contains($0) ?? false } ?? false)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    Group {
                        if saving { ProgressView().controlSize(.small) }
                        else if error != nil { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                        else { Image(systemName: kind == .image ? "photo" : kind == .audio ? "waveform" : "film").foregroundStyle(.secondary) }
                    }
                    .frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title ?? ChatMedia.fileName(url)).font(.subheadline.weight(.medium)).lineLimit(1)
                        Text(saving ? "Saving to the chat…" : error ?? "On the chat's VM. Save it to the chat to \(kind == .image ? "see" : "play") it here.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if !saving {
                    HStack(spacing: 8) {
                        if let feed {
                            Button {
                                requested = true
                                error = nil
                                Task {
                                    do { try await feed.saveArtifact(url: url) } catch { self.error = error.localizedDescription }
                                    requested = false
                                }
                            } label: {
                                Label(error == nil ? "Save to Chat" : "Try Again", systemImage: "square.and.arrow.down")
                            }
                            .buttonStyle(.glassProminent)
                            .accessibilityIdentifier("media.vm.save")
                        }
                        if let link = URL(string: url) {
                            Link(destination: link) { Label("Open", systemImage: "arrow.up.right.square") }
                                .buttonStyle(.glass)
                        }
                    }
                    .controlSize(.small)
                    .padding(.leading, 30)
                }
            }
            .padding(12)
            .frame(maxWidth: 560, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("media.vm")
        }
    }
}

/// A video on another site: a card that loads it only when you tap play.
struct ExternalVideoView: View {
    let source: ChatMedia.Source
    var title: String?
    @State private var playing = false
    @State private var failed = false

    var body: some View {
        let label = title ?? (source.isFile ? ChatMedia.fileName(source.url) : "Video")
        if failed, let url = URL(string: source.url) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Couldn't play \(ChatMedia.fileName(source.url)).", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .symbolRenderingMode(.multicolor)
                Text("The site may not allow streaming it here.").font(.caption).foregroundStyle(.secondary)
                Link(destination: url) { Label("Open", systemImage: "arrow.up.right.square") }.font(.caption)
            }
            .padding(12)
            .frame(maxWidth: 560, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
        } else if playing {
            if let embed = ChatMedia.embedURL(source) {
                EmbeddedPlayer(url: embed)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .frame(maxWidth: 560)
                    .clipShape(.rect(cornerRadius: 14, style: .continuous))
                    .accessibilityIdentifier("media.embed")
            } else if let url = URL(string: source.url) {
                VideoPlayerCard(url: url, title: label, autoplay: true) { failed = true }
            }
        } else {
            Button { playing = true } label: {
                ZStack {
                    LinearGradient(colors: [Color(white: 0.15), Color(white: 0.05)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    if let thumbnail = ChatMedia.thumbnail(source) {
                        AsyncImage(url: thumbnail) { image in image.resizable().scaledToFill().opacity(0.85) } placeholder: { Color.clear }
                    } else {
                        Image(systemName: "film").font(.largeTitle).foregroundStyle(.white.opacity(0.25))
                    }
                    Image(systemName: "play.fill")
                        .font(.title)
                        .foregroundStyle(.white)
                        .frame(width: 60, height: 60)
                        .glassEffect(.regular.interactive(), in: .circle)
                    VStack(alignment: .leading, spacing: 2) {
                        Spacer()
                        Text(label).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text("\(ChatMedia.host(source)) · loads when you tap play").font(.caption).opacity(0.8).lineLimit(1)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(alignment: .bottom) {
                        LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom).frame(height: 80)
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(maxWidth: 560)
                .clipShape(.rect(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Play \(label)")
            .accessibilityIdentifier("media.play")
        }
    }
}

private extension ChatMedia.Source {
    var isFile: Bool { if case .file = self { true } else { false } }
}

/// A YouTube or Vimeo player page, inline.
struct EmbeddedPlayer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.isScrollEnabled = false
        view.isOpaque = false
        view.backgroundColor = .black
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

/// Safari, in the app, over the whole window (links in replies that aren't Dex's own, a VM's exposed port). Never a
/// sheet: a sheet is a card on iPad and a drawer on iPhone that a game's downward swipes pull closed. Presented from
/// the window that asked, so each iPad window opens its own.
enum InAppBrowser {
    static func open(_ url: URL) {
        guard url.scheme == "http" || url.scheme == "https", let top = topController() else {
            UIApplication.shared.open(url)
            return
        }
        let configuration = SFSafariViewController.Configuration()
        configuration.barCollapsingEnabled = true
        let safari = SFSafariViewController(url: url, configuration: configuration)
        safari.modalPresentationStyle = .fullScreen
        safari.dismissButtonStyle = .done
        top.present(safari, animated: true)
    }

    /// The front-most controller of the active window (the one the tap came from).
    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        var top = (scene?.keyWindow ?? scene?.windows.first)?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }
}

/// Opens links from a chat: Dex's own (`dex://`) in the app, web pages in the in-app browser over the chat.
@MainActor
@Observable
final class LinkOpener {
    func open(_ url: URL, router: Router) {
        if router.handle(url) { return }
        InAppBrowser.open(url)
    }
}
