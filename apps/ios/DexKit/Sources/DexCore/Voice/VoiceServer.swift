import Foundation

/// What a call needs to speak: get the voice ready, turn text into utterances, and utterances into audio.
public protocol VoiceSynthesizing: Sendable {
    /// Gets the voice ready (the model's first download, `progress` 0 to 1 while it's under way, then loading it).
    func prepare(progress: @escaping @Sendable (Double) -> Void) async throws
    func phonemes(_ text: String) async throws -> PhonemesResponse
    /// One utterance's audio at `VoiceText.sampleRate`.
    func audio(for utterance: Utterance, voice: Voice) async throws -> [Float]
}

/// One piece the model reads in a call: up to 512 phonemes (config.json `max_tokens`) with their stress.
public struct Utterance: Codable, Sendable, Hashable {
    public var ids: [Int]
    public var stress: [Int]
    /// The phonemes as text, for debugging.
    public var phonemes: String

    public init(ids: [Int], stress: [Int], phonemes: String = "") {
        self.ids = ids; self.stress = stress; self.phonemes = phonemes
    }

    enum CodingKeys: String, CodingKey { case ids, stress, phonemes }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ids = try c.decode([Int].self, forKey: .ids)
        stress = c.value(.stress, default: [])
        phonemes = c.value(.phonemes, default: "")
    }
}

/// `/api/voice/phonemes`: `{ text }` in, each sentence's utterances out (none for a sentence with nothing to say).
public struct PhonemesResponse: Codable, Sendable, Hashable {
    public struct Sentence: Codable, Sendable, Hashable {
        public var text: String
        public var utterances: [Utterance]

        public init(text: String, utterances: [Utterance]) { self.text = text; self.utterances = utterances }

        enum CodingKeys: String, CodingKey { case text, utterances }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            text = c.value(.text, default: "")
            utterances = c.value(.utterances, default: [])
        }
    }

    public var sentences: [Sentence]

    public init(sentences: [Sentence]) { self.sentences = sentences }
}

/// Why a voice couldn't speak, as the call screen says it.
public struct VoiceError: LocalizedError, Sendable, Equatable {
    public let message: String
    public let status: Int?
    public init(_ message: String, status: Int? = nil) { self.message = message; self.status = status }
    public var errorDescription: String? { message }

    public static let signedOut = VoiceError("Sign in again to use calls.", status: 401)
    public static let unavailable = VoiceError("Their voice isn't available right now.")
}

/// Dex's voice endpoints, signed in with the session (no Origin, like every request from the app).
public struct VoiceServer: Sendable {
    public let server: URL
    public let token: String?
    let session: URLSession
    /// How long to wait before asking again after a 503 (Dex restarting); one entry per retry.
    let retryDelays: [Duration]

    public init(server: URL, token: String?, session: URLSession = DexHTTP.session, retryDelays: [Duration] = [.seconds(1), .seconds(2)]) {
        self.server = server; self.token = token; self.session = session; self.retryDelays = retryDelays
    }

    /// The model's revision as its address has it (`modelUrl`'s `v`).
    public static var modelVersion: String { String(VoiceText.revision.prefix(12)) }

    /// Where one of tiny-voca's files downloads from.
    public func modelURL(_ file: String) -> URL {
        let base = server.appending(path: "api/voice/model/\(file)")
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "v", value: Self.modelVersion)]
        return components?.url ?? base
    }

    /// The phoneme ids for some text (whole sentences; at most `VoiceText.maxSpokenCharacters`). 401 means signed out;
    /// a 503 is asked again shortly.
    public func phonemes(_ text: String) async throws -> PhonemesResponse {
        var request = DexHTTP.request(server.appending(path: "api/voice/phonemes"), token: token)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let clipped: String = {
            let utf16 = text.utf16
            guard utf16.count > VoiceText.maxSpokenCharacters else { return text }
            var end = utf16.index(utf16.startIndex, offsetBy: VoiceText.maxSpokenCharacters)
            if end > utf16.startIndex, end.samePosition(in: text) == nil { end = utf16.index(before: end) }
            return end.samePosition(in: text).map { String(text[..<$0]) } ?? String(text.prefix(VoiceText.maxSpokenCharacters))
        }()
        request.httpBody = try JSONEncoder().encode(["text": clipped])
        var attempt = 0
        while true {
            let (body, response): (Data, URLResponse)
            do {
                (body, response) = try await session.data(for: request)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                throw VoiceError.unavailable
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 503, attempt < retryDelays.count {
                try await Task.sleep(for: retryDelays[attempt])
                attempt += 1
                continue
            }
            if status == 401 { throw VoiceError.signedOut }
            guard (200..<300).contains(status), let decoded = try? JSONDecoder().decode(PhonemesResponse.self, from: body) else {
                throw VoiceError(VoiceError.unavailable.message, status: status)
            }
            return decoded
        }
    }
}

/// tiny-voca's files on the device: downloaded once from Dex (signed in), kept in Application Support (not Caches:
/// the system mustn't drop them before a call) under the model's revision, and older revisions deleted.
public actor VoiceModelStore {
    public static let modelFile = "model.onnx"

    private let directory: URL
    private var downloading: Task<URL, Error>?

    /// `directory`: where revisions are kept (Application Support/Voice by default).
    public init(directory: URL? = nil) {
        self.directory = directory ?? URL.applicationSupportDirectory.appending(path: "Voice", directoryHint: .isDirectory)
    }

    /// This revision's folder.
    private var folder: URL { directory.appending(path: "tiny-voca-\(VoiceServer.modelVersion)", directoryHint: .isDirectory) }

    /// The model, when it's on the device.
    public var model: URL? {
        let url = folder.appending(path: Self.modelFile)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// The model's file, downloading it first if needed (`progress` from 0 to 1 while it does).
    public func model(from voice: VoiceServer, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        if let model { return model }
        if let downloading { return try await downloading.value }
        let task = Task { try await download(from: voice, progress: progress) }
        downloading = task
        defer { downloading = nil }
        return try await task.value
    }

    private final class StreamDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private let handle: FileHandle
        private let progress: @Sendable (Double) -> Void
        private var continuation: CheckedContinuation<Void, Error>?
        private var expected: Int64 = -1
        private var loaded: Int64 = 0
        private var reported: Int64 = 0
        private var lastFraction: Double = -1

        init(handle: FileHandle, progress: @escaping @Sendable (Double) -> Void, continuation: CheckedContinuation<Void, Error>) {
            self.handle = handle
            self.progress = progress
            self.continuation = continuation
        }

        private func finish(_ result: Result<Void, Error>) {
            let cont: CheckedContinuation<Void, Error>? = lock.withLock {
                let current = continuation
                continuation = nil
                return current
            }
            guard let cont else { return }
            try? handle.close()
            cont.resume(with: result)
        }

        private func emit(_ fraction: Double) {
            let clamped = min(1, max(0, fraction))
            guard clamped > lastFraction else { return }
            lastFraction = clamped
            progress(clamped)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 {
                completionHandler(.cancel)
                finish(.failure(VoiceError.signedOut))
                return
            }
            guard status == 200 else {
                completionHandler(.cancel)
                finish(.failure(VoiceError("Couldn't download their voice (\(status)).", status: status)))
                return
            }
            lock.withLock {
                expected = response.expectedContentLength
                emit(0)
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            do {
                try handle.write(contentsOf: data)
            } catch {
                dataTask.cancel()
                finish(.failure(error))
                return
            }
            lock.withLock {
                loaded += Int64(data.count)
                if expected > 0, loaded - reported >= 65_536 {
                    reported = loaded
                    emit(Double(loaded) / Double(expected))
                }
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if let error {
                let mapped: Error = (error as? URLError)?.code == .cancelled ? CancellationError() : error
                finish(.failure(mapped))
                return
            }
            let mismatch: Bool = lock.withLock {
                if expected > 0, loaded != expected { return true }
                emit(1)
                return false
            }
            if mismatch {
                finish(.failure(VoiceError("Their voice didn't finish downloading. Try again.")))
            } else {
                finish(.success(()))
            }
        }
    }

    private func download(from voice: VoiceServer, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        let request = DexHTTP.request(voice.modelURL(Self.modelFile), token: voice.token)
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let tempURL = folder.appending(path: "\(Self.modelFile).\(UUID().uuidString).part")
        fileManager.createFile(atPath: tempURL.path, contents: nil)
        defer { try? fileManager.removeItem(at: tempURL) }
        let handle = try FileHandle(forWritingTo: tempURL)
        // Stream OS-sized chunks straight to disk instead of awaiting every byte in Swift.
        let task = voice.session.dataTask(with: request)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                task.delegate = StreamDownload(handle: handle, progress: progress, continuation: continuation)
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
        let destination = folder.appending(path: Self.modelFile)
        try? fileManager.removeItem(at: destination)
        try fileManager.moveItem(at: tempURL, to: destination)
        // Downloaded again rather than restored from a backup.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var excluded = directory
        try? excluded.setResourceValues(values)
        removeOlderRevisions()
        return destination
    }

    /// Only this revision is kept.
    private func removeOlderRevisions() {
        let fileManager = FileManager.default
        let current = folder.lastPathComponent
        for item in (try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where item.lastPathComponent != current {
            try? fileManager.removeItem(at: item)
        }
    }

    /// Forgets the downloaded voice (tests).
    public func clear() {
        try? FileManager.default.removeItem(at: directory)
    }
}
