import DexCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A file being attached in the composer: its upload (to be prepared for the model), and a thumbnail while it runs.
struct DraftAttachment: Identifiable {
    enum Status { case uploading, ready, failed }
    let id = UUID()
    let name: String
    let mimeType: String
    let thumbnail: UIImage?
    var status: Status = .uploading
    var attachment: ChatAttachment?
    var error: String?
}

extension ComposerModel {
    var uploading: Bool { attachments.contains { $0.status == .uploading } }
    var failedAttachments: [DraftAttachment] { attachments.filter { $0.status == .failed } }
    var readyAttachments: [ChatAttachment] { attachments.compactMap { $0.status == .ready ? $0.attachment : nil } }
    var attachmentsFull: Bool { attachments.count >= AttachmentLimits.files }

    /// Adds a file and starts its upload (useDraftAttachments on the web).
    func attach(_ data: Data, name: String, mimeType: String, client: DexClient) {
        guard !attachmentsFull else { return }
        let thumbnail = mimeType.hasPrefix("image/") ? UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 160)) : nil
        let draft = DraftAttachment(name: name, mimeType: mimeType, thumbnail: thumbnail)
        attachments.append(draft)
        Task {
            do {
                let prepared = await Task.detached(priority: .userInitiated) { AttachmentPrep.prepare(data, name: name, mimeType: mimeType) }.value
                let attachment = try await client.uploadAttachment(prepared.data, name: prepared.name, mimeType: prepared.mimeType)
                update(draft.id) { $0.status = .ready; $0.attachment = attachment }
            } catch {
                update(draft.id) { $0.status = .failed; $0.error = error.localizedDescription }
            }
        }
    }

    func removeAttachment(_ id: UUID) { attachments.removeAll { $0.id == id } }

    private func update(_ id: UUID, _ change: (inout DraftAttachment) -> Void) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else { return }
        change(&attachments[index])
    }
}

/// HEIC photos (which the server can't read) and very large ones become JPEG, upright and at most 2560 pixels on their
/// longer side. The server scales images to fit the model anyway; this only saves uploading a camera's full-size photo.
nonisolated enum AttachmentPrep {
    static let largePhotoBytes = 4 * 1024 * 1024
    static let maxPixels: CGFloat = 2560

    static func prepare(_ data: Data, name: String, mimeType: String) -> (data: Data, name: String, mimeType: String) {
        let heic = ["image/heic", "image/heif"].contains(mimeType)
        let large = ["image/jpeg", "image/png", "image/webp"].contains(mimeType) && data.count > largePhotoBytes
        guard heic || large, let image = UIImage(data: data), let jpeg = jpeg(image) else { return (data, name, mimeType) }
        let base = (name as NSString).deletingPathExtension
        return (jpeg, "\(base.isEmpty ? "Photo" : base).jpg", "image/jpeg")
    }

    /// Drawn upright (UIImage carries the EXIF orientation), scaled down to fit, as JPEG.
    static func jpeg(_ image: UIImage) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxPixels ? maxPixels / longest : 1
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return drawn.jpegData(compressionQuality: 0.88)
    }

    /// The MIME type of a file, from its type or its name.
    static func mimeType(for url: URL) -> String {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType)?.preferredMIMEType
            ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
    }
}

/// The paperclip: photos, the camera, or files, each attached (and uploaded) as soon as it's picked.
struct AttachButton: View {
    @Environment(DexClient.self) private var client
    @Bindable var model: ComposerModel
    var disabled = false
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var showCamera = false
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        Menu {
            Button { showPhotos = true } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { showCamera = true } label: { Label("Take Photo", systemImage: "camera") }
            }
            Button { showFiles = true } label: { Label("Choose Files", systemImage: "folder") }
        } label: {
            Image(systemName: "paperclip").font(.body.weight(.semibold)).frame(width: 20, height: 20)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(disabled || model.attachmentsFull)
        .accessibilityLabel("Attach files")
        .accessibilityIdentifier("composer.attach")
        .photosPicker(isPresented: $showPhotos, selection: $photos, maxSelectionCount: max(1, AttachmentLimits.files - model.attachments.count), matching: .images)
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            for (index, item) in items.enumerated() {
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self) else {
                        client.notice = "Couldn't read that photo."
                        return
                    }
                    let type = item.supportedContentTypes.first
                    let ext = type?.preferredFilenameExtension ?? "jpg"
                    model.attach(data, name: "Photo\(items.count > 1 ? " \(index + 1)" : "").\(ext)", mimeType: type?.preferredMIMEType ?? "image/jpeg", client: client)
                }
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > AttachmentLimits.uploadBytes {
                    client.notice = "\(url.lastPathComponent) is too large (limit \(AttachmentLimits.uploadBytes / 1024 / 1024) MB)."
                    continue
                }
                guard let data = try? Data(contentsOf: url) else {
                    client.notice = "Couldn't read \(url.lastPathComponent)."
                    continue
                }
                model.attach(data, name: url.lastPathComponent, mimeType: AttachmentPrep.mimeType(for: url), client: client)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let data = AttachmentPrep.jpeg(image) { model.attach(data, name: "Photo.jpg", mimeType: "image/jpeg", client: client) }
            }
            .ignoresSafeArea()
        }
    }
}

/// The system camera, returning the photo taken.
private struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

/// The files attached in the composer, as removable chips: images as thumbnails, others with their names.
struct AttachmentChips: View {
    @Bindable var model: ComposerModel

    var body: some View {
        if !model.attachments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(model.attachments) { draft in
                            chip(draft)
                        }
                    }
                    .padding(.top, 4)
                }
                .scrollIndicators(.hidden)
                if let failed = model.failedAttachments.first {
                    let more = model.failedAttachments.count - 1
                    Text((failed.error ?? "Couldn't attach \(failed.name).") + (more > 0 ? " (and \(more) more)" : ""))
                        .font(.caption)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("composer.attachmentError")
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
    }

    private func chip(_ draft: DraftAttachment) -> some View {
        let failed = draft.status == .failed
        return ZStack(alignment: .topTrailing) {
            Group {
                if let thumbnail = draft.thumbnail {
                    Image(uiImage: thumbnail).resizable().scaledToFill().frame(width: 56, height: 56)
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text").foregroundStyle(failed ? .red : .secondary)
                        Text(draft.name).font(.caption).lineLimit(2)
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 26)
                    .frame(width: 168, height: 56, alignment: .leading)
                }
            }
            .overlay {
                if draft.status == .uploading { ZStack { Color.black.opacity(0.35); ProgressView() } }
            }
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(failed ? Color.red : Color(.separator), lineWidth: 1))
            Button { model.removeAttachment(draft.id) } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 18, height: 18)
                    .background(.thinMaterial, in: .circle)
            }
            .buttonStyle(.plain)
            .padding(3)
            .accessibilityLabel("Remove \(draft.name)")
        }
        .accessibilityIdentifier("composer.attachment")
    }
}

/// What was attached to one of your messages: its images as thumbnails, its other files as chips.
struct UserAttachmentsView: View {
    let feed: ChatFeed?
    let images: [ImagePart]
    let files: [AttachedFile]

    var body: some View {
        // Each image has a tag naming it among the files; the thumbnails stand for those.
        let others = files.filter { !$0.mimeType.hasPrefix("image/") || $0.mimeType == "image/svg+xml" }
        VStack(alignment: .trailing, spacing: 6) {
            if let feed, !images.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(images.enumerated()), id: \.offset) { _, image in
                        AttachedImage(feed: feed, image: image)
                    }
                }
            }
            ForEach(Array(others.enumerated()), id: \.offset) { _, file in
                Label(file.name, systemImage: "doc.text")
                    .font(.caption)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.18), in: .rect(cornerRadius: 8, style: .continuous))
            }
        }
        .accessibilityIdentifier("chat.attachments")
    }
}

/// An attached image: inline, or loaded by its ref when the agent left a large one out of the transcript.
private struct AttachedImage: View {
    let feed: ChatFeed
    let image: ImagePart
    @State private var loaded: UIImage?
    @State private var failed = false
    @State private var zoomed = false

    var body: some View {
        Group {
            if let loaded {
                Button { zoomed = true } label: {
                    Image(uiImage: loaded).resizable().scaledToFill().frame(width: 96, height: 96)
                        .clipShape(.rect(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Attached image")
                .fullScreenCover(isPresented: $zoomed) { ImageViewer(image: loaded, title: "Image") }
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.white.opacity(0.15))
                    .frame(width: 96, height: 96)
                    .overlay { if failed { Image(systemName: "photo").foregroundStyle(.white.opacity(0.7)) } else { ProgressView() } }
            }
        }
        .task(id: image.ref ?? image.data.prefix(32).description) {
            if !image.data.isEmpty, let bytes = Data(base64Encoded: image.data), let decoded = UIImage(data: bytes) { loaded = decoded; return }
            guard let ref = image.ref else { failed = true; return }
            do { loaded = try await MediaLoader.shared.screenshot(ref: ref, feed: feed); failed = loaded == nil } catch { failed = true }
        }
    }
}
