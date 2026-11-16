import DexCore
import Foundation
import OnnxRuntimeBindings

// DexVoice: tiny-voca on ONNX Runtime, apart from DexCore so only the app links the runtime (a static library), not
// the widgets or the notification extension.

/// tiny-voca through ONNX Runtime (the web's tts.worker.ts): utterances in, 24 kHz mono audio out. An actor, so the
/// model runs off the main actor and one utterance at a time; CPU is plenty (a sentence takes tens of milliseconds).
public actor TinyVoca {
    private let env: ORTEnv
    private let session: ORTSession

    public init(model: URL) throws {
        env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setGraphOptimizationLevel(.all)
        session = try ORTSession(env: env, modelPath: model.path, sessionOptions: options)
    }

    /// The model can peak a little above 1.0; scaled down then, so it never clips.
    static let peak: Float = 0.99

    /// One utterance in a voice. `speed` 1 is the model's own pace.
    public func synthesize(_ utterance: Utterance, voice: Voice, speed: Float = 1) throws -> [Float] {
        let count = NSNumber(value: utterance.ids.count)
        // Stress pads or trims to the ids, as the model needs one per token.
        let stress = (0..<utterance.ids.count).map { utterance.stress.indices.contains($0) ? utterance.stress[$0] : 0 }
        let outputs = try session.run(
            withInputs: [
                "tokens": try Self.tensor(utterance.ids.map(Int64.init), shape: [1, count]),
                "stress": try Self.tensor(stress.map(Int64.init), shape: [1, count]),
                "voice": try Self.tensor([Int64(voice.index)], shape: [1]),
                "speed": try Self.tensor([speed], shape: [1]),
                "pitch_shift": try Self.tensor([Float(0)], shape: [1]),
                "pitch_range": try Self.tensor([Float(1)], shape: [1])
            ],
            outputNames: ["audio"],
            runOptions: nil
        )
        guard let audio = outputs["audio"] else { throw VoiceError("The voice model gave no audio.") }
        let data = try audio.tensorData() as Data
        var samples = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        Self.limitPeak(&samples)
        return samples
    }

    static func limitPeak(_ samples: inout [Float]) {
        let loudest = samples.reduce(Float(0)) { max($0, abs($1)) }
        guard loudest > peak else { return }
        let scale = peak / loudest
        for index in samples.indices { samples[index] *= scale }
    }

    private static func tensor(_ values: [Int64], shape: [NSNumber]) throws -> ORTValue {
        let data = values.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Int64>.stride) }
        return try ORTValue(tensorData: data, elementType: .int64, shape: shape)
    }

    private static func tensor(_ values: [Float], shape: [NSNumber]) throws -> ORTValue {
        let data = values.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.stride) }
        return try ORTValue(tensorData: data, elementType: .float, shape: shape)
    }
}

/// The real voice: phonemes from Dex, the model downloaded from it once and run on the device. Kept between calls,
/// so the model stays loaded.
public actor TinyVocaSynthesizer: VoiceSynthesizing {
    public let server: VoiceServer
    private let store: VoiceModelStore
    private var loading: Task<TinyVoca, Error>?

    public init(server: VoiceServer, store: VoiceModelStore = VoiceModelStore()) {
        self.server = server
        self.store = store
    }

    public func prepare(progress: @escaping @Sendable (Double) -> Void) async throws {
        _ = try await model(progress: progress)
    }

    private func model(progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws -> TinyVoca {
        if let loading { return try await loading.value }
        let server = server, store = store
        let task = Task { try TinyVoca(model: try await store.model(from: server, progress: progress)) }
        loading = task
        do {
            return try await task.value
        } catch {
            // Tried again next time.
            loading = nil
            throw error
        }
    }

    public nonisolated func phonemes(_ text: String) async throws -> PhonemesResponse {
        try await server.phonemes(text)
    }

    public func audio(for utterance: Utterance, voice: Voice) async throws -> [Float] {
        try await model().synthesize(utterance, voice: voice)
    }
}
