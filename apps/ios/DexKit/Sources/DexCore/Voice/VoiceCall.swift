import Foundation
import Observation

// One voice call with a sidekick (the web's client/voice/call.ts): speech recognition hears you, what you say goes to
// their conversation (`send`), and their reply, fed in with `reply(_:)` as it streams, is spoken a sentence at a time.
// Talking over them stops them. The ear, the voice, and the speaker are injected (the app's are AVFoundation and
// tiny-voca; tests and the demo use MockVoice's).

/// What a call hears through: speech recognition on the microphone.
@MainActor
public protocol SpeechListening: AnyObject {
    /// Starts one recognition session; its events arrive until it ends on its own (`.ended`) or `stop()` is called.
    /// Each session's transcript starts empty.
    func start(_ events: @escaping @MainActor (ListeningEvent) -> Void)
    func stop()
}

public enum ListeningEvent: Sendable, Equatable {
    /// The session's transcript so far; final once recognition has settled on it.
    case heard(String, isFinal: Bool)
    /// The session stopped by itself (a silence, recognition's one-minute limit): the call starts another.
    case ended
    /// The call can't hear you (no permission, no microphone): it ends with this.
    case failed(String)
}

/// What a call speaks through: pieces of audio played back to back.
@MainActor
public protocol VoicePlaying: AnyObject {
    /// Plays a piece of `VoiceText.sampleRate` mono audio right after what's already playing; `finished` is called once
    /// it's been heard (not after `stop()`).
    func play(_ samples: [Float], finished: @escaping @MainActor () -> Void)
    /// Stops what's playing and drops what's waiting.
    func stop()
    /// How loud it is right now, 0 to 1.
    var level: Double { get }
    /// The call is over.
    func close()
}

/// The reply after your latest words, as the chat has it now. `key` changes when a new reply starts.
public struct CallReply: Sendable, Hashable {
    public var key: String
    public var text: String
    public var done: Bool

    public init(key: String, text: String, done: Bool) { self.key = key; self.text = text; self.done = done }

    /// The reply after your latest message (`latestReply` in the web's voice-call.tsx): its text blocks so far, and
    /// whether it's over (the chat isn't running and it isn't streaming).
    public static func latest(_ items: [DisplayItem], running: Bool) -> CallReply? {
        let lastUser = items.lastIndex { if case .user = $0 { true } else { false } }
        let after = lastUser.map { items[($0 + 1)...] } ?? items[...]
        for item in after {
            guard case .assistant(let id, let messages, let streaming, _) = item else { continue }
            let text = messages.map { message in
                message.content.compactMap { block -> String? in if case .text(let text) = block { text } else { nil } }.joined()
            }.filter { !$0.isEmpty }.joined(separator: "\n\n")
            let key = messages.first.map { Self.key($0.timestamp) } ?? id
            return CallReply(key: key, text: text, done: !running && !streaming)
        }
        return nil
    }

    /// A timestamp as JavaScript's String(number) writes it (whole milliseconds without a fraction).
    static func key(_ timestamp: Double) -> String {
        timestamp.rounded() == timestamp && abs(timestamp) < 1e15 ? String(Int64(timestamp)) : String(timestamp)
    }
}

@MainActor
@Observable
public final class VoiceCall {
    public enum Phase: String, Sendable {
        case starting, listening, thinking, speaking, ended, failed
    }

    public private(set) var phase: Phase = .starting
    /// What you're saying now (recognition's running guess), or just said.
    public private(set) var heard = ""
    /// The sentence they're saying.
    public private(set) var saying = ""
    public private(set) var muted = false
    /// The voice's first download, 0 to 1, while it's under way.
    public private(set) var downloading: Double?
    public private(set) var error: String?

    public var isOver: Bool { phase == .ended || phase == .failed }

    /// What the call screen says: the download, Muted, or the phase.
    public var status: String {
        if let downloading { return "Getting their voice ready… \(Int((downloading * 100).rounded()))%" }
        if muted, !isOver { return "Muted" }
        return switch phase {
        case .starting: "Connecting…"
        case .listening: "Listening"
        case .thinking: "Thinking…"
        case .speaking: "Speaking"
        case .ended, .failed: "Call ended"
        }
    }

    public let voice: Voice
    @ObservationIgnored private let send: (String) async throws -> Void
    @ObservationIgnored private let listener: SpeechListening
    @ObservationIgnored private let synthesizer: VoiceSynthesizing
    @ObservationIgnored private let player: VoicePlaying
    @ObservationIgnored private let endOfTurn: Duration
    @ObservationIgnored private let relisten: Duration
    @ObservationIgnored private let now: () -> Date

    @ObservationIgnored private var prepared = false
    @ObservationIgnored private var listening = false
    @ObservationIgnored private var session = 0
    @ObservationIgnored private var finalText = ""
    @ObservationIgnored private var interim = ""
    @ObservationIgnored private var turnTimer: Task<Void, Never>?
    @ObservationIgnored private var relistenTask: Task<Void, Never>?
    /// Bumped when they're cut off: work for an older reply is dropped.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var speech: Task<Void, Never>?
    /// Batches of this reply waiting to be spoken (older generations' aren't counted).
    @ObservationIgnored private var pending = 0
    @ObservationIgnored private var playing: Set<Int> = []
    @ObservationIgnored private var nextPiece = 0
    @ObservationIgnored private var stream = SentenceStream()
    @ObservationIgnored private var replyKey: String?
    @ObservationIgnored private var unsaid: String?
    @ObservationIgnored private var replyDone = true
    @ObservationIgnored private var waitingForReply = false
    /// What they said in the last while, so the microphone hearing the speaker isn't taken for you.
    @ObservationIgnored private var recentlySaid: [(words: [String], at: Date)] = []

    /// `endOfTurn`: how long after your last words a pause counts as the end of what you're saying.
    public init(voice: Voice, listener: SpeechListening, synthesizer: VoiceSynthesizing, player: VoicePlaying,
                endOfTurn: Duration = .milliseconds(900), relisten: Duration = .milliseconds(250), now: @escaping () -> Date = Date.init,
                send: @escaping (String) async throws -> Void) {
        self.voice = voice; self.listener = listener; self.synthesizer = synthesizer; self.player = player
        self.endOfTurn = endOfTurn; self.relisten = relisten; self.now = now; self.send = send
    }

    /// Starts the call: listening at once, and the voice gets ready meanwhile.
    public func start() async {
        listen()
        do {
            try await synthesizer.prepare { [weak self] fraction in
                Task { @MainActor [weak self] in
                    guard let self, !self.isOver, !self.prepared else { return }
                    self.downloading = fraction
                }
            }
            prepared = true
            guard !isOver else { return }
            downloading = nil
            // A reply already queued keeps speaking.
            if !speaking { setPhase(waitingForReply || !replyDone ? .thinking : .listening) }
        } catch {
            fail(Self.message(error))
        }
    }

    /// The reply after your latest words; call it whenever the chat changes.
    public func reply(_ reply: CallReply?) {
        guard let reply, !isOver else { return }
        // One you cut off (or one from before the call) stays unsaid, however much more of it streams in.
        if reply.key == unsaid { return }
        if reply.key != replyKey {
            let before = replyKey == nil && !waitingForReply
            replyKey = reply.key
            stream = SentenceStream()
            if before {
                unsaid = reply.key
                return
            }
        }
        replyDone = reply.done
        let sentences = reply.done ? stream.take(reply.text) + stream.rest(reply.text) : stream.take(reply.text)
        if !sentences.isEmpty || reply.done { waitingForReply = false }
        if !sentences.isEmpty { say(sentences) }
        settle()
    }

    public func setMuted(_ muted: Bool) {
        guard !isOver else { return }
        self.muted = muted
        if muted { stopListening() } else { listen() }
    }

    /// Stops everything.
    public func end() {
        guard !isOver else { return }
        phase = .ended
        finish()
    }

    /// How loud they are right now, 0 to 1, for the face.
    public var level: Double { playing.isEmpty ? 0 : player.level }

    private func setPhase(_ next: Phase) {
        guard !isOver else { return }
        phase = next
    }

    private func fail(_ message: String) {
        guard !isOver else { return }
        phase = .failed
        error = message
        finish()
    }

    private func finish() {
        downloading = nil
        generation += 1
        turnTimer?.cancel()
        relistenTask?.cancel()
        relistenTask = nil
        speech?.cancel()
        speech = nil
        silence()
        stopListening()
        player.close()
    }

    static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    // MARK: Hearing you

    private func listen() {
        guard !listening, !muted, !isOver else { return }
        listening = true
        session += 1
        let current = session
        listener.start { [weak self] event in
            guard let self, self.listening, self.session == current else { return }
            self.hear(event)
        }
    }

    private func stopListening() {
        guard listening else { return }
        listening = false
        session += 1
        listener.stop()
    }

    private func hear(_ event: ListeningEvent) {
        switch event {
        case .heard(let text, let isFinal):
            if isFinal {
                if !isEcho(text) { finalText = "\(finalText) \(text)".trimmingCharacters(in: .whitespaces) }
                interim = ""
            } else {
                interim = isEcho(text) ? "" : text.trimmingCharacters(in: .whitespaces)
            }
            let heard = "\(finalText) \(interim)".trimmingCharacters(in: .whitespaces)
            guard !heard.isEmpty else { return }
            // You talking over them: they stop.
            if speaking, VoiceText.words(heard).count >= 2 { cutOff() }
            self.heard = heard
            turnTimer?.cancel()
            let delay = endOfTurn
            turnTimer = Task { [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                self?.endTurn()
            }
        case .ended:
            // Recognition stops on its own now and then (after a silence, or a minute); keep it going for the whole call.
            listening = false
            session += 1
            if !finalText.isEmpty || !interim.isEmpty { endTurn() }
            let delay = relisten
            relistenTask?.cancel()
            relistenTask = Task { [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                self?.listen()
            }
        case .failed(let message):
            fail(message)
        }
    }

    /// Whether recognized words are mostly what they've just been saying (the speaker heard through the microphone).
    private func isEcho(_ text: String) -> Bool {
        let heard = VoiceText.words(text)
        guard !heard.isEmpty else { return false }
        let now = now()
        recentlySaid = recentlySaid.filter { now.timeIntervalSince($0.at) < 15 }
        if !speaking, !recentlySaid.contains(where: { now.timeIntervalSince($0.at) < 2 }) { return false }
        let said = Set(recentlySaid.flatMap(\.words))
        return Double(heard.filter { said.contains($0) }.count) / Double(heard.count) >= 0.6
    }

    /// You've stopped talking: what you said goes to them.
    private func endTurn() {
        turnTimer?.cancel()
        let text = "\(finalText) \(interim)".trimmingCharacters(in: .whitespaces)
        finalText = ""
        interim = ""
        guard !text.isEmpty, !isOver else { return }
        // A new session, so recognition's transcript starts over (it would otherwise still hold these words).
        if listening {
            stopListening()
            listen()
        }
        cutOff()
        waitingForReply = true
        replyDone = false
        heard = text
        saying = ""
        setPhase(downloading != nil ? .starting : .thinking)
        Task { [weak self, send] in
            do {
                try await send(text)
            } catch {
                guard let self else { return }
                self.waitingForReply = false
                self.error = Self.message(error).isEmpty ? "That didn't send." : Self.message(error)
                self.setPhase(.listening)
            }
        }
    }

    // MARK: Their voice

    private var speaking: Bool { !playing.isEmpty || pending > 0 }

    /// Reads sentences out after whatever is already queued: their phonemes are asked for now, and each batch is
    /// spoken in order.
    private func say(_ sentences: [String]) {
        for batch in Self.batches(sentences) {
            let generation = generation
            pending += 1
            setPhase(.speaking)
            let synthesizer = synthesizer
            let phonemes = Task { try await synthesizer.phonemes(batch) }
            let previous = speech
            speech = Task { [weak self] in
                await previous?.value
                guard let self else { return }
                defer {
                    if generation == self.generation { self.pending -= 1 }
                    self.settle()
                }
                guard generation == self.generation, !Task.isCancelled else {
                    phonemes.cancel()
                    return
                }
                do {
                    let response = try await phonemes.value
                    for sentence in response.sentences {
                        guard generation == self.generation else { return }
                        guard !sentence.utterances.isEmpty else { continue }
                        await self.speak(sentence, generation: generation)
                    }
                } catch {
                    if generation == self.generation, !(error is CancellationError) { self.error = Self.message(error) }
                }
            }
        }
    }

    /// Sentences joined into requests no longer than the phonemes endpoint takes.
    static func batches(_ sentences: [String]) -> [String] {
        var batches: [String] = []
        var current = ""
        for sentence in sentences {
            let joined = current.isEmpty ? sentence : "\(current) \(sentence)"
            if joined.utf16.count > VoiceText.maxSpokenCharacters, !current.isEmpty {
                batches.append(current)
                current = sentence
            } else {
                current = joined
            }
        }
        if !current.isEmpty { batches.append(current) }
        return batches
    }

    /// One sentence through the model, each piece played as it's made.
    private func speak(_ sentence: PhonemesResponse.Sentence, generation: Int) async {
        for utterance in sentence.utterances {
            do {
                let samples = try await synthesizer.audio(for: utterance, voice: voice)
                guard generation == self.generation else { return }
                recentlySaid.append((VoiceText.words(sentence.text), now()))
                saying = sentence.text
                play(samples)
            } catch {
                if generation == self.generation { self.error = Self.message(error) }
                return
            }
        }
    }

    private func play(_ samples: [Float]) {
        guard !samples.isEmpty, !isOver else { return }
        nextPiece += 1
        let piece = nextPiece
        playing.insert(piece)
        player.play(samples) { [weak self] in
            guard let self, self.playing.remove(piece) != nil else { return }
            self.settle()
        }
    }

    private func silence() {
        playing.removeAll()
        player.stop()
    }

    /// You spoke over them: the rest of their reply goes unsaid.
    private func cutOff() {
        guard speaking else { return }
        generation += 1
        silence()
        // Cancel in-flight phoneme requests and synthesis so the old reply stops using network and CPU immediately.
        pending = 0
        speech?.cancel()
        speech = nil
        unsaid = replyKey
        replyDone = true
        saying = ""
        setPhase(.listening)
    }

    /// Back to listening once they've said everything and the reply is over.
    private func settle() {
        guard !isOver, !speaking else { return }
        if waitingForReply || !replyDone {
            if phase != .starting {
                setPhase(.thinking)
                saying = ""
            }
            return
        }
        if phase != .listening, phase != .starting {
            setPhase(.listening)
            saying = ""
        }
    }
}
