import Foundation

// A call without a microphone, a server, or a speaker: for unit tests (driven by hand) and the demo and UI tests (a
// scripted line heard a moment after the call starts).

/// Speech recognition that hears what it's told: `hear(_:)` by hand, or `script`'s lines, said word by word.
@MainActor
public final class MockListener: SpeechListening {
    /// What it hears by itself in the sessions to come, one line per session (taken from the front).
    public var script: [String]
    /// How long before a scripted line starts, and between its words.
    public var pause: Duration
    public private(set) var sessions = 0
    public private(set) var isListening = false
    private var events: (@MainActor (ListeningEvent) -> Void)?
    private var speaking: Task<Void, Never>?

    public init(script: [String] = [], pause: Duration = .milliseconds(150)) {
        self.script = script
        self.pause = pause
    }

    public func start(_ events: @escaping @MainActor (ListeningEvent) -> Void) {
        sessions += 1
        isListening = true
        self.events = events
        guard !script.isEmpty else { return }
        let line = script.removeFirst()
        let pause = pause
        speaking = Task { [weak self] in
            try? await Task.sleep(for: pause * 4)
            var said: [Substring] = []
            for word in line.split(separator: " ") {
                guard !Task.isCancelled else { return }
                said.append(word)
                self?.hear(said.joined(separator: " "))
                try? await Task.sleep(for: pause)
            }
        }
    }

    public func stop() {
        isListening = false
        events = nil
        speaking?.cancel()
    }

    /// Recognition's transcript for this session so far.
    public func hear(_ text: String, final: Bool = false) { events?(.heard(text, isFinal: final)) }
    /// The session ends by itself.
    public func end() {
        let events = events
        isListening = false
        self.events = nil
        events?(.ended)
    }
    public func failure(_ message: String) { events?(.failed(message)) }
}

/// A voice that needs no server or model: each sentence one utterance, its audio a quiet hum as long as reading it
/// would take. Records what it was asked.
public actor MockSynthesizer: VoiceSynthesizing {
    public private(set) var requests: [String] = []
    public private(set) var spoken: [String] = []
    private let delay: Duration
    private let download: Bool
    private let requestDelay: (@Sendable (String) -> Duration)?
    private var prepared = false

    /// `delay`: how long each request and each utterance takes (`requestDelay`, when given, says it per request).
    /// `download`: the first `prepare` reports progress.
    public init(delay: Duration = .milliseconds(20), download: Bool = false, requestDelay: (@Sendable (String) -> Duration)? = nil) {
        self.delay = delay
        self.download = download
        self.requestDelay = requestDelay
    }

    public func prepare(progress: @escaping @Sendable (Double) -> Void) async throws {
        guard !prepared else { return }
        if download {
            for step in 1...4 {
                try await Task.sleep(for: delay * 5)
                progress(Double(step) / 4)
            }
        }
        prepared = true
    }

    public func phonemes(_ text: String) async throws -> PhonemesResponse {
        requests.append(text)
        try await Task.sleep(for: requestDelay?(text) ?? delay)
        return PhonemesResponse(sentences: VoiceText.sentences(text).map { sentence in
            PhonemesResponse.Sentence(text: sentence, utterances: [Utterance(ids: Array(sentence.utf8.prefix(500)).map(Int.init), stress: [], phonemes: sentence)])
        })
    }

    public func audio(for utterance: Utterance, voice: Voice) async throws -> [Float] {
        try await Task.sleep(for: delay)
        spoken.append(utterance.phonemes)
        // About 14 characters a second.
        let count = max(1, utterance.ids.count) * VoiceText.sampleRate / 14
        return (0..<count).map { Float(sin(Double($0) * 0.05) * 0.1) }
    }
}

/// A speaker that plays nothing: each piece "plays" for its length scaled by `speed` (0 waits for `finishNext()`).
@MainActor
public final class MockPlayer: VoicePlaying {
    public private(set) var played: [[Float]] = []
    public private(set) var stops = 0
    public private(set) var closed = false
    private var queue: [(@MainActor () -> Void)] = []
    private var clock: Task<Void, Never>?
    /// Bumped by `stop()`: earlier pieces' clocks run out without finishing anything.
    private var epoch = 0
    private let speed: Double

    public init(speed: Double = 1) { self.speed = speed }

    public var level: Double { queue.isEmpty ? 0 : 0.5 + 0.4 * sin(Date.now.timeIntervalSinceReferenceDate * 9) }
    public var waiting: Int { queue.count }

    public func play(_ samples: [Float], finished: @escaping @MainActor () -> Void) {
        played.append(samples)
        queue.append(finished)
        guard speed > 0 else { return }
        let previous = clock, epoch = epoch
        let seconds = Double(samples.count) / Double(VoiceText.sampleRate) / speed
        clock = Task { [weak self] in
            await previous?.value
            try? await Task.sleep(for: .seconds(seconds))
            guard let self, !Task.isCancelled, self.epoch == epoch else { return }
            self.finishNext()
        }
    }

    /// The piece playing now has been heard.
    public func finishNext() {
        guard !queue.isEmpty else { return }
        queue.removeFirst()()
    }

    public func stop() {
        stops += 1
        epoch += 1
        queue = []
        clock?.cancel()
        clock = nil
    }

    public func close() {
        stop()
        closed = true
    }
}
