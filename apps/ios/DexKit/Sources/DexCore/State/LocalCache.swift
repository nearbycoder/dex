import Foundation

/// What the device keeps for a quick launch, like the web's localStorage and IndexedDB copies: the last synced state,
/// the model list, and the last few chats opened, so a launch shows them at once while the agent wakes. Nothing secret
/// is in it, and signing out deletes it.
public final class LocalCache: @unchecked Sendable {
    public static let maxChats = 8
    private static let maxChatBytes = 1_500_000

    private let root: URL
    private let queue = DispatchQueue(label: "dex.cache", qos: .utility)

    public init(root: URL? = nil) {
        let base = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "DexCache")
        self.root = base
        try? FileManager.default.createDirectory(at: base.appending(path: "chats"), withIntermediateDirectories: true)
    }

    private func stateURL(_ userId: String) -> URL { root.appending(path: "state-\(Self.safe(userId)).json") }
    private var modelsURL: URL { root.appending(path: "models.json") }
    private func chatURL(_ userId: String, _ sessionId: String) -> URL { root.appending(path: "chats/\(Self.safe(userId))-\(Self.safe(sessionId)).json") }

    private static func safe(_ text: String) -> String {
        String(text.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }

    // MARK: State

    public func loadState(userId: String) -> DexState? {
        guard let data = try? Data(contentsOf: stateURL(userId)) else { return nil }
        return try? JSONDecoder.dex.decode(DexState.self, from: data)
    }

    public func saveState(_ state: DexState, userId: String) {
        let url = stateURL(userId)
        queue.async { try? JSONEncoder.dex.encode(state).write(to: url, options: .atomic) }
    }

    // MARK: Models

    public func loadModels() -> ModelCatalog? {
        guard let data = try? Data(contentsOf: modelsURL) else { return nil }
        return try? JSONDecoder.dex.decode(ModelCatalog.self, from: data)
    }

    public func saveModels(_ catalog: ModelCatalog) {
        let url = modelsURL
        queue.async { try? JSONEncoder.dex.encode(catalog).write(to: url, options: .atomic) }
    }

    // MARK: Chats

    private struct SavedChat: Codable {
        let entries: [EntryRecord]
        let artifacts: [ChatArtifact]
    }

    /// The kept copy of a chat, shown until its live snapshot arrives.
    public func loadTranscript(userId: String, sessionId: String) -> TranscriptState? {
        guard let data = try? Data(contentsOf: chatURL(userId, sessionId)), let saved = try? JSONDecoder.dex.decode(SavedChat.self, from: data) else { return nil }
        var state = TranscriptState()
        state.entries = saved.entries
        state.artifacts = saved.artifacts
        state.loaded = true
        return state
    }

    /// Keeps a chat (only what a finished chat shows), then the newest `maxChats` only.
    public func saveTranscript(_ transcript: TranscriptState, userId: String, sessionId: String) {
        guard transcript.loaded else { return }
        let url = chatURL(userId, sessionId)
        let folder = root.appending(path: "chats")
        let saved = SavedChat(entries: transcript.entries, artifacts: transcript.artifacts)
        queue.async {
            guard let data = try? JSONEncoder.dex.encode(saved), data.count <= Self.maxChatBytes else { return }
            try? data.write(to: url, options: .atomic)
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            let sorted = files.sorted {
                let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return a > b
            }
            for old in sorted.dropFirst(Self.maxChats) { try? FileManager.default.removeItem(at: old) }
        }
    }

    public func removeTranscript(userId: String, sessionId: String) {
        let url = chatURL(userId, sessionId)
        queue.async { try? FileManager.default.removeItem(at: url) }
    }

    /// Forgets everything kept for a quick start (signing out). The model list stays: it's the same for everyone.
    public func clear() {
        queue.sync {
            let files = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
            for file in files where file.lastPathComponent != "models.json" { try? FileManager.default.removeItem(at: file) }
            try? FileManager.default.createDirectory(at: root.appending(path: "chats"), withIntermediateDirectories: true)
        }
    }

    /// Waits for pending writes (tests).
    public func flush() { queue.sync {} }
}
