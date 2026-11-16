@preconcurrency import AVFoundation
import DexCore
import os
@preconcurrency import Speech

/// One call's audio: an AVAudioEngine that hears the microphone (for speech recognition) and plays the sidekick's voice
/// on the same engine, so voice processing cancels their voice out of the microphone (talking over them works on the
/// speaker). A voice preview uses it without the microphone. Not on the main actor: the engine's taps and callbacks
/// run on its own threads.
nonisolated final class CallAudio: @unchecked Sendable {
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    /// The model's audio: 24 kHz mono.
    let format = AVAudioFormat(standardFormatWithSampleRate: Double(VoiceText.sampleRate), channels: 1)!
    /// Whether it hears the microphone (a call) or only plays (a preview).
    let listens: Bool
    private var running = false

    /// Where the microphone's audio goes (the current recognition request), from the audio thread.
    let microphone = OSAllocatedUnfairLock<SFSpeechAudioBufferRecognitionRequest?>(initialState: nil)
    /// How loud the voice is right now, 0 to 1, measured as it plays.
    let loudness = OSAllocatedUnfairLock<Double>(initialState: 0)

    init(listens: Bool) {
        self.listens = listens
    }

    /// Sets up the audio session and starts the engine (once).
    func start() throws {
        guard !running else { return }
        let session = AVAudioSession.sharedInstance()
        if listens {
            // Voice chat: echo cancellation and gain control; the loudspeaker rather than the earpiece.
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        } else {
            try session.setCategory(.playback, mode: .spokenAudio)
        }
        try session.setActive(true)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        let loudness = loudness
        player.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in
            guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            var sum: Float = 0
            for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
            let level = min(1, Double((sum / Float(buffer.frameLength)).squareRoot()) * 4)
            loudness.withLock { $0 = level }
        }
        if listens {
            let input = engine.inputNode
            // Takes the speaker's sound out of the microphone's (the simulator may not have it).
            try? input.setVoiceProcessingEnabled(true)
            let microphone = microphone
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw VoiceError("No microphone was found.") }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                microphone.withLock { $0?.append(buffer) }
            }
        }
        engine.prepare()
        try engine.start()
        running = true
    }

    /// Plays a piece after what's queued; `heard` runs (on the engine's thread) once it has played.
    func schedule(_ samples: [Float], heard: @escaping @Sendable () -> Void) throws {
        try start()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return heard() }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            buffer.floatChannelData?[0].update(from: source.baseAddress!, count: samples.count)
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in heard() }
        if !player.isPlaying { player.play() }
    }

    func silence() {
        player.stop()
        loudness.withLock { $0 = 0 }
    }

    func stop() {
        guard running else { return }
        running = false
        player.stop()
        player.removeTap(onBus: 0)
        if listens { engine.inputNode.removeTap(onBus: 0) }
        engine.stop()
        microphone.withLock { $0 = nil }
        loudness.withLock { $0 = 0 }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// The voice played on a call's engine, piece after piece with no gap between them.
final class EnginePlayer: VoicePlaying {
    private let audio: CallAudio
    /// Bumped by `stop()`: pieces from before don't report being heard.
    private var epoch = 0

    init(audio: CallAudio) {
        self.audio = audio
    }

    func play(_ samples: [Float], finished: @escaping @MainActor () -> Void) {
        let epoch = epoch
        let heard: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in
                guard let self, self.epoch == epoch else { return }
                finished()
            }
        }
        do { try audio.schedule(samples, heard: heard) } catch { finished() }
    }

    func stop() {
        epoch += 1
        audio.silence()
    }

    var level: Double { audio.loudness.withLock { $0 } }

    func close() {
        stop()
        audio.stop()
    }
}

/// The device's speech recognition (en-US, on the device when it can be), on the call's microphone. Each session is
/// one recognition task with partial results; it ends on its own after a long silence or recognition's time limit.
final class SpeechRecognizer: SpeechListening {
    private let audio: CallAudio
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var task: SFSpeechRecognitionTask?
    /// Bumped by every start and stop: a session that's been replaced is ignored.
    private var session = 0

    init(audio: CallAudio) {
        self.audio = audio
    }

    func start(_ events: @escaping @MainActor (ListeningEvent) -> Void) {
        session += 1
        let current = session
        Task {
            if let problem = await Self.permission() { return events(.failed(problem)) }
            guard session == current else { return }
            guard let recognizer, recognizer.isAvailable else { return events(.failed("Speech recognition isn't available right now.")) }
            do { try audio.start() } catch { return events(.failed("No microphone was found.")) }
            begin(recognizer, session: current, events: events)
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer, session current: Int, events: @escaping @MainActor (ListeningEvent) -> Void) {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = true
        request.taskHint = .dictation
        audio.microphone.withLock { $0 = request }
        task = Self.recognize(request, with: recognizer) { [weak self] text, isFinal, over in
            guard let self, self.session == current else { return }
            if let text, !text.isEmpty { events(.heard(text, isFinal: isFinal)) }
            guard over, self.session == current else { return }
            self.finish()
            events(.ended)
        }
    }

    /// Starts a task whose results come to `update` on the main actor (the recognizer calls back on its own queue).
    nonisolated private static func recognize(_ request: SFSpeechAudioBufferRecognitionRequest, with recognizer: SFSpeechRecognizer,
                                              update: @escaping @MainActor (String?, Bool, Bool) -> Void) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let over = error != nil || isFinal
            Task { @MainActor in update(text, isFinal, over) }
        }
    }

    func stop() {
        session += 1
        finish()
    }

    private func finish() {
        audio.microphone.withLock { request in
            request?.endAudio()
            request = nil
        }
        task?.cancel()
        task = nil
    }

    /// Asks for the microphone and speech recognition (once); what's missing, if anything.
    static func permission() async -> String? {
        let speech = await speechAuthorization()
        guard speech == .authorized else { return "Dex needs speech recognition for calls. Allow it in Settings → Dex." }
        guard await AVAudioApplication.requestRecordPermission() else { return "Dex needs the microphone for calls. Allow it in Settings → Dex." }
        return nil
    }

    nonisolated private static func speechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }
}
