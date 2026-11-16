import DexCore
import DexVoice
import Foundation
import Observation

/// Where calls get their ear, voice, and speaker: the device's speech recognition, tiny-voca, and the call's audio
/// engine, or, in mock mode (the demo and UI tests), MockVoice's (a scripted line heard, a hum that plays silently).
enum Calls {
    /// The voice for a server, kept between calls (and previews) so the model stays loaded.
    private static var synthesizers: [String: VoiceSynthesizing] = [:]

    static func synthesizer(for client: DexClient) -> VoiceSynthesizing {
        if LaunchOptions.current.mock { return mockSynthesizer }
        let server = client.server ?? URL(string: "https://localhost")!
        let token = client.credentials?.token
        let key = "\(server.absoluteString) \(token ?? "")"
        if let synthesizer = synthesizers[key] { return synthesizer }
        let synthesizer = TinyVocaSynthesizer(server: VoiceServer(server: server, token: token))
        synthesizers = [key: synthesizer]
        return synthesizer
    }

    /// The demo's voice: its first call shows the download.
    private static let mockSynthesizer = MockSynthesizer(delay: .milliseconds(LaunchOptions.current.fastReplies ? 40 : 120), download: true)

    /// A call with a sidekick: what you say goes to their conversation, marked as spoken.
    static func start(with character: CharacterProfile, feed: ChatFeed, client: DexClient) -> VoiceCall {
        let listener: SpeechListening
        let player: VoicePlaying
        if LaunchOptions.current.mock {
            listener = MockListener(script: LaunchOptions.current.callScript)
            player = MockPlayer()
        } else {
            let audio = CallAudio(listens: true)
            listener = SpeechRecognizer(audio: audio)
            player = EnginePlayer(audio: audio)
        }
        let call = VoiceCall(voice: character.callVoice, listener: listener, synthesizer: synthesizer(for: client), player: player) { [weak feed] text in
            try await feed?.send(text, spoken: true)
        }
        Task { await call.start() }
        return call
    }
}

/// Says one line in a voice, for trying voices out (a sidekick's page): which voice is speaking, the first download's
/// progress, and what went wrong.
@MainActor
@Observable
final class VoicePreview {
    private(set) var speaking: Voice?
    private(set) var progress: Double?
    private(set) var error: String?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var player: VoicePlaying?
    /// Pieces of the line still to be heard.
    @ObservationIgnored private var unheard = 0

    func play(_ line: String, in voice: Voice, client: DexClient) {
        stop()
        error = nil
        speaking = voice
        let synthesizer = Calls.synthesizer(for: client)
        let player: VoicePlaying = LaunchOptions.current.mock ? MockPlayer() : EnginePlayer(audio: CallAudio(listens: false))
        self.player = player
        task = Task { [weak self] in
            do {
                async let phonemes = synthesizer.phonemes(line)
                try await synthesizer.prepare { fraction in
                    Task { @MainActor in if self?.speaking == voice, self?.task != nil { self?.progress = fraction < 1 ? fraction : nil } }
                }
                self?.progress = nil
                let utterances = try await phonemes.sentences.flatMap(\.utterances)
                for utterance in utterances {
                    let samples = try await synthesizer.audio(for: utterance, voice: voice)
                    guard !Task.isCancelled, let self else { return }
                    self.unheard += 1
                    player.play(samples) { [weak self] in
                        guard let self else { return }
                        self.unheard -= 1
                        if self.unheard == 0 { self.finished(voice) }
                    }
                }
                if utterances.isEmpty { self?.finished(voice) }
            } catch {
                guard !Task.isCancelled else { return }
                self?.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                self?.finished(voice)
            }
        }
    }

    private func finished(_ voice: Voice) {
        guard speaking == voice else { return }
        stop()
    }

    func stop() {
        task?.cancel()
        task = nil
        player?.close()
        player = nil
        unheard = 0
        speaking = nil
        progress = nil
    }
}
