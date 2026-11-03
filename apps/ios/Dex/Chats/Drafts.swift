import DexCore
import Observation
import SwiftUI

/// What you've written in each chat's message box, and in the new chat's: one composer per chat, kept while you switch
/// between chats (files being attached keep uploading), and its text saved on the device for the next launch. The chat
/// list marks the chats with a draft.
@MainActor
@Observable
final class Drafts {
    static let shared = Drafts()
    /// The new chat's box.
    static let newChat = "new"

    /// Chats whose box holds text or files, for the chat list (changes only when one starts or stops having a draft).
    private(set) var drafted: Set<String> = []
    @ObservationIgnored private var composers: [String: ComposerModel] = [:]
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    private static let key = "dex.drafts"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if LaunchOptions.current.resetState { defaults.removeObject(forKey: Self.key) }
        let saved = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        for (id, text) in saved where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            composers[id] = ComposerModel(draftKey: id, text: text)
            drafted.insert(id)
        }
    }

    /// The chat's composer, made the first time it's asked for.
    func composer(for id: String) -> ComposerModel {
        if let composer = composers[id] { return composer }
        let composer = ComposerModel(draftKey: id)
        composers[id] = composer
        return composer
    }

    /// The start of the chat's unsent text, or nil.
    func preview(_ id: String) -> String? {
        guard drafted.contains(id), let composer = composers[id] else { return nil }
        let text = composer.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return composer.attachments.isEmpty ? nil : attachmentSummary(composer.attachments.map(\.name)) }
        return String(text.prefix(120)).replacingOccurrences(of: "\n", with: " ")
    }

    /// The chat is gone (deleted): its draft goes too.
    func discard(_ id: String) {
        composers[id] = nil
        drafted.remove(id)
        scheduleSave()
    }

    /// Signing out forgets every draft.
    func clear() {
        composers = [:]
        drafted = []
        saveTask?.cancel()
        defaults.removeObject(forKey: Self.key)
    }

    /// A composer's text or files changed.
    func changed(_ composer: ComposerModel) {
        guard let id = composer.draftKey else { return }
        let has = !composer.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !composer.attachments.isEmpty
        if has != drafted.contains(id) {
            if has { drafted.insert(id) } else { drafted.remove(id) }
        }
        scheduleSave()
    }

    /// Saved a moment after typing stops, and when the app goes to the background.
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(0.8))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    func save() {
        saveTask?.cancel()
        var texts: [String: String] = [:]
        for (id, composer) in composers where !composer.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            texts[id] = composer.text
        }
        if texts.isEmpty { defaults.removeObject(forKey: Self.key) } else { defaults.set(texts, forKey: Self.key) }
    }
}
