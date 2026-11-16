import CryptoKit
import Foundation
import Testing
@testable import DexCore
@testable import DexVoice

/// A fixture from Fixtures/Voice.
private func voiceFixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/Voice"))
    return try Data(contentsOf: url)
}

// MARK: - Text rules

/// The web's own answers (apps/web/src/shared/voice.ts run in Node; Fixtures/Voice/voice-parity.json): the text rules
/// must cut and clean replies exactly as the web does, so a sidekick reads the same on every device.
@Suite struct VoiceTextTests {
    struct Case<Output: Decodable & Sendable>: Decodable, Sendable {
        let input: String
        let output: Output
    }

    struct Parity: Decodable, Sendable {
        let sentences: [Case<[String]>]
        let finished: [Case<String>]
        let speakable: [Case<String>]
        let pipeline: [Case<[String]>]
        let streams: [Case<[[String]]>]
        let voices: [Case<String>]
    }

    let parity: Parity

    init() throws {
        parity = try JSONDecoder().decode(Parity.self, from: voiceFixture("voice-parity"))
    }

    @Test func sentencesMatchTheWeb() {
        for test in parity.sentences { #expect(VoiceText.sentences(test.input) == test.output, "\(test.input.debugDescription)") }
    }

    @Test func finishedMatchesTheWeb() {
        for test in parity.finished { #expect(VoiceText.finished(test.input) == test.output, "\(test.input.debugDescription)") }
    }

    @Test func speakableMatchesTheWeb() {
        for test in parity.speakable { #expect(VoiceText.speakable(test.input) == test.output, "\(test.input.debugDescription)") }
        for test in parity.pipeline { #expect(VoiceText.sentences(VoiceText.speakable(test.input)) == test.output, "\(test.input.debugDescription)") }
    }

    @Test func streamsMatchTheWeb() {
        // A reply growing word by word: what `take` gives after each word, then `rest`.
        for test in parity.streams {
            var stream = SentenceStream()
            let words = test.input.split(separator: " ", omittingEmptySubsequences: false)
            var taken = (1...words.count).map { stream.take(words.prefix($0).joined(separator: " ")) }
            taken.append(stream.rest())
            #expect(taken == test.output, "\(test.input.debugDescription)")
        }
    }

    @Test func voicesMatchTheWeb() {
        for test in parity.voices { #expect(Voice.of(id: test.input).rawValue == test.output, "\(test.input.debugDescription)") }
    }

    @Test func aSidekicksOwnVoiceWins() {
        #expect(Voice.of(id: "muse-abc123") == .m2)
        #expect(Voice.of(id: "muse-abc123", voice: "F2") == .f2)
        // One the app doesn't know is no voice.
        #expect(Voice.of(id: "muse-abc123", voice: "X9") == .m2)
        #expect(CharacterProfile(id: "sage", name: "Sage", sessionId: "s").callVoice == .f2)
        #expect(CharacterProfile(id: "sage", name: "Sage", voice: "M2", sessionId: "s").callVoice == .m2)
        #expect(Voice.f2.index == 0 && Voice.m2.index == 1)
        #expect(Voice.f2.label == "Bright (female)" && Voice.m2.label == "Warm (male)")
    }

    @Test func wordsForTheEchoCheck() {
        #expect(VoiceText.words("Hello, World! It's 3 o'clock.") == ["hello", "world", "it's", "3", "o'clock"])
        #expect(VoiceText.words("…?!").isEmpty)
    }
}

// MARK: - The sidekick's voice setting

@Suite struct CharacterVoiceTests {
    @Test func profilesDecodeTheirVoice() throws {
        let json = #"{"characters":[{"id":"a","name":"A","sessionId":"s1","voice":"M2"},{"id":"b","name":"B","sessionId":"s2","voice":null},{"id":"c","name":"C","sessionId":"s3"},{"id":"d","name":"D","sessionId":"s4","voice":"Z1"}]}"#
        let state = try JSONDecoder.dex.decode(DexState.self, from: Data(json.utf8))
        #expect(state.characters.map(\.voice) == ["M2", nil, nil, nil])
        // Kept on the device as it came.
        #expect(try JSONDecoder.dex.decode(DexState.self, from: JSONEncoder.dex.encode(state)) == state)
    }

    @Test func savingKeepsTheVoice() throws {
        // An edit sends the voice it has, so saving from the app never drops it.
        let character = CharacterProfile(id: "muse", name: "Muse", voice: "F2", sessionId: "s1")
        #expect(try JSONValue(encoding: CharacterDraft(character))["voice"] == "F2")
        // Automatic is null (the agent picks it from their id), not left out.
        var draft = CharacterDraft(character)
        draft.voice = nil
        #expect(try JSONValue(encoding: draft)["voice"] == .null)
        // The bell keeps it too.
        #expect(try JSONValue(encoding: CharacterDraft.withNotify(character, .off))["voice"] == "F2")
    }

    @Test @MainActor func theMockAgentSavesIt() async throws {
        let agent = MockAgent()
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        defer { client.stop() }
        try await until { client.state != nil && client.isConnected }
        let muse = try #require(client.state?.characters.first)
        var draft = CharacterDraft(muse)
        draft.voice = "M2"
        #expect(try await client.saveCharacter(draft).voice == "M2")
        // Left out (an older app): kept.
        var older = try JSONValue(encoding: CharacterDraft(muse))
        older = .object((older.object ?? [:]).filter { $0.key != "voice" })
        let kept: CharacterProfile = try await client.call("saveCharacter", older)
        #expect(kept.voice == "M2")
        draft.voice = nil
        #expect(try await client.saveCharacter(draft).voice == nil)
    }

    @Test @MainActor func spokenMessagesSayTheyWere() async throws {
        let agent = MockAgent()
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.start()
        defer { client.stop() }
        try await until { client.state != nil && client.isConnected }
        let muse = try #require(client.state?.characters.first)
        let feed = client.chat(muse.sessionId)
        try await feed.send(" what's up ", spoken: true)
        try await feed.send("typed")
        let sent = agent.calls.filter { $0.method == "sendMessage" }.map(\.args)
        // sendMessage(sessionId, text, attachments, { spoken: true }): no attachments is null.
        #expect(sent.first == [.string(muse.sessionId), "what's up", .null, ["spoken": true]])
        #expect(sent.last == [.string(muse.sessionId), "typed"])
    }
}

// MARK: - Dex's voice endpoints

/// Answers requests to hosts a test registers (tests run in parallel, each on its own host).
final class StubProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, Data?) -> (status: Int, headers: [String: String], body: Data)
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    private static let lock = NSLock()

    static func register(_ host: String, _ handler: @escaping Handler) {
        lock.withLock { handlers[host] = handler }
    }

    static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.lock.withLock { Self.handlers[request.url?.host() ?? ""] }
        guard let handler, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        let answer = handler(request, body)
        let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        // In pieces, as a download arrives.
        var offset = 0
        while offset < answer.body.count {
            let end = min(answer.body.count, offset + 100_000)
            client?.urlProtocol(self, didLoad: answer.body.subdata(in: offset..<end))
            offset = end
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Counts calls across a test's handlers.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.withLock { value += 1; return value } }
    var count: Int { lock.withLock { value } }
}

@Suite struct VoiceServerTests {
    @Test func asksForPhonemesSignedIn() async throws {
        let fixture = try voiceFixture("phonemes")
        StubProtocol.register("phonemes.test") { request, body in
            // The session as a cookie, JSON in, and no Origin (as every app request).
            guard request.httpMethod == "POST", request.url?.path() == "/api/voice/phonemes",
                  request.value(forHTTPHeaderField: "Cookie") == "dex_session=tok", request.value(forHTTPHeaderField: "Origin") == nil,
                  request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                  let body, let json = try? JSONDecoder().decode([String: String].self, from: body), json["text"] == "Hello there."
            else { return (400, [:], Data()) }
            return (200, ["Content-Type": "application/json"], fixture)
        }
        let server = VoiceServer(server: URL(string: "https://phonemes.test")!, token: "tok", session: StubProtocol.session)
        let response = try await server.phonemes("Hello there.")
        #expect(response.sentences.count == 4)
        #expect(response.sentences[0].text.hasPrefix("Hello! This is tiny voca"))
        #expect(response.sentences[0].utterances[0].ids.count == 82 && response.sentences[0].utterances[0].stress.count == 82)
        #expect(response.sentences[0].utterances[0].phonemes.hasPrefix("<bos>"))
    }

    @Test func emptySentencesAndOlderShapesDecode() throws {
        let json = #"{"sentences":[{"text":"…","utterances":[]},{"text":"Hi.","utterances":[{"ids":[1,2,3],"stress":[0,1,0]}]}]}"#
        let response = try JSONDecoder().decode(PhonemesResponse.self, from: Data(json.utf8))
        #expect(response.sentences[0].utterances.isEmpty)
        #expect(response.sentences[1].utterances[0] == Utterance(ids: [1, 2, 3], stress: [0, 1, 0], phonemes: ""))
    }

    @Test func signedOutAndUnavailable() async throws {
        StubProtocol.register("signedout.test") { _, _ in (401, [:], Data(#"{"error":"Sign in"}"#.utf8)) }
        StubProtocol.register("broken.test") { _, _ in (500, [:], Data()) }
        let signedOut = VoiceServer(server: URL(string: "https://signedout.test")!, token: "tok", session: StubProtocol.session)
        await #expect(throws: VoiceError.signedOut) { try await signedOut.phonemes("Hi.") }
        let broken = VoiceServer(server: URL(string: "https://broken.test")!, token: "tok", session: StubProtocol.session)
        let error = await #expect(throws: VoiceError.self) { try await broken.phonemes("Hi.") }
        #expect(error?.message == "Their voice isn't available right now." && error?.status == 500)
    }

    @Test func triesAgainAfterA503() async throws {
        let calls = Counter()
        StubProtocol.register("restarting.test") { _, _ in
            calls.next() < 3 ? (503, [:], Data()) : (200, [:], Data(#"{"sentences":[]}"#.utf8))
        }
        let server = VoiceServer(server: URL(string: "https://restarting.test")!, token: "tok", session: StubProtocol.session,
                                 retryDelays: [.milliseconds(10), .milliseconds(10)])
        #expect(try await server.phonemes("Hi.").sentences.isEmpty)
        #expect(calls.count == 3)
        // Not forever.
        StubProtocol.register("down.test") { _, _ in (503, [:], Data()) }
        let down = VoiceServer(server: URL(string: "https://down.test")!, token: "tok", session: StubProtocol.session, retryDelays: [.milliseconds(10)])
        await #expect(throws: VoiceError.self) { try await down.phonemes("Hi.") }
    }

    @Test func theModelsAddressNamesItsRevision() {
        let server = VoiceServer(server: URL(string: "https://dex.example.com")!, token: nil)
        #expect(server.modelURL("model.onnx").absoluteString == "https://dex.example.com/api/voice/model/model.onnx?v=e5f9b11651a4")
    }

    @Test func downloadsTheModelOnceAndKeepsOnlyItsRevision() async throws {
        let model = Data((0..<350_000).map { UInt8($0 % 251) })
        let downloads = Counter()
        StubProtocol.register("model.test") { request, _ in
            guard request.url?.path() == "/api/voice/model/model.onnx", request.url?.query() == "v=e5f9b11651a4",
                  request.value(forHTTPHeaderField: "Cookie") == "dex_session=tok" else { return (404, [:], Data()) }
            _ = downloads.next()
            return (200, ["Content-Length": "\(model.count)"], model)
        }
        let directory = FileManager.default.temporaryDirectory.appending(path: "dex-voice-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        // An older revision, from before.
        try FileManager.default.createDirectory(at: directory.appending(path: "tiny-voca-000000000000"), withIntermediateDirectories: true)
        let store = VoiceModelStore(directory: directory)
        let server = VoiceServer(server: URL(string: "https://model.test")!, token: "tok", session: StubProtocol.session)
        let fractions = Fractions()
        let url = try await store.model(from: server) { fractions.add($0) }
        #expect(try Data(contentsOf: url) == model)
        #expect(url.path().contains("Voice") == false && url.deletingLastPathComponent().lastPathComponent == "tiny-voca-e5f9b11651a4")
        #expect(fractions.values.last == 1 && fractions.values.count > 1 && fractions.values == fractions.values.sorted())
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path()) == ["tiny-voca-e5f9b11651a4"])
        // Kept: no second download.
        _ = try await store.model(from: server) { _ in }
        #expect(downloads.count == 1)
        #expect(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }

    @Test func aBrokenDownloadKeepsNothing() async throws {
        StubProtocol.register("shortmodel.test") { _, _ in (200, ["Content-Length": "1000"], Data(count: 10)) }
        StubProtocol.register("nomodel.test") { _, _ in (401, [:], Data()) }
        let directory = FileManager.default.temporaryDirectory.appending(path: "dex-voice-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VoiceModelStore(directory: directory)
        await #expect(throws: (any Error).self) {
            try await store.model(from: VoiceServer(server: URL(string: "https://shortmodel.test")!, token: "tok", session: StubProtocol.session)) { _ in }
        }
        await #expect(throws: VoiceError.signedOut) {
            try await store.model(from: VoiceServer(server: URL(string: "https://nomodel.test")!, token: "tok", session: StubProtocol.session)) { _ in }
        }
        #expect(await store.model == nil)
    }
}

final class Fractions: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [Double] = []
    func add(_ value: Double) { lock.withLock { list.append(value) } }
    var values: [Double] { lock.withLock { list } }
}

// MARK: - The model

/// tiny-voca on the four sentences of Fixtures/Voice/phonemes.json, against what onnxruntime-web made of them
/// (reference.json): the same number of samples exactly, and about as loud (the model adds noise of its own, so the
/// samples themselves differ a little from run to run). The model comes from DEX_VOICE_MODEL, a copy kept in the
/// user's caches, or Hugging Face (at Dex's revision, checked against its SHA-256).
@Suite(.serialized) struct TinyVocaTests {
    struct Reference: Decodable {
        let text: String
        let voice: Int
        let samples: Int
        let peak: Double
        let rms: Double
    }

    static let sha256 = "fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46"

    static func model() async throws -> URL {
        if let path = ProcessInfo.processInfo.environment["DEX_VOICE_MODEL"] { return URL(filePath: path) }
        let cached = URL.cachesDirectory.appending(path: "DexCoreTests/tiny-voca-\(VoiceServer.modelVersion).onnx")
        if FileManager.default.fileExists(atPath: cached.path()) { return cached }
        let source = URL(string: "https://huggingface.co/n4ze3m/tiny-voca/resolve/\(VoiceText.revision)/onnx/model.onnx")!
        let (data, response) = try await URLSession.shared.data(from: source)
        try #require((response as? HTTPURLResponse)?.statusCode == 200)
        try #require(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() == sha256)
        try FileManager.default.createDirectory(at: cached.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: cached)
        return cached
    }

    @Test func speaksTheFixtureLikeTheWeb() async throws {
        let model = try TinyVoca(model: try await Self.model())
        let phonemes = try JSONDecoder().decode(PhonemesResponse.self, from: voiceFixture("phonemes"))
        let references = try JSONDecoder().decode([Reference].self, from: voiceFixture("reference"))
        #expect(references.count == 8)
        for reference in references {
            let sentence = try #require(phonemes.sentences.first { $0.text == reference.text })
            let voice = try #require(Voice.allCases.first { $0.index == reference.voice })
            var samples: [Float] = []
            for utterance in sentence.utterances { samples += try await model.synthesize(utterance, voice: voice) }
            let peak = Double(samples.map(abs).max() ?? 0)
            let rms = (samples.reduce(0) { $0 + Double($1 * $1) } / Double(samples.count)).squareRoot()
            #expect(samples.count == reference.samples, "\(reference.text) in \(voice)")
            #expect(peak <= 0.99 + 1e-6)
            #expect(abs(peak - reference.peak) < 0.12, "\(reference.text) in \(voice): peak \(peak) vs \(reference.peak)")
            #expect(abs(rms - reference.rms) / reference.rms < 0.12, "\(reference.text) in \(voice): rms \(rms) vs \(reference.rms)")
        }
    }

    @Test func loudPiecesAreScaledDown() {
        var samples: [Float] = [0.5, -2, 1]
        TinyVoca.limitPeak(&samples)
        #expect(abs(samples[1] + 0.99) < 1e-6 && abs(samples[0] - 0.2475) < 1e-6)
        var quiet: [Float] = [0.5, -0.9]
        TinyVoca.limitPeak(&quiet)
        #expect(quiet == [0.5, -0.9])
    }
}

// MARK: - The call

/// Waits for a condition (two seconds at most).
@MainActor
func until(_ condition: @MainActor () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async throws {
    for _ in 0..<400 {
        if condition() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("Timed out waiting", sourceLocation: sourceLocation)
    throw CancellationError()
}

@MainActor
@Suite struct VoiceCallTests {
    final class Sent: @unchecked Sendable {
        var texts: [String] = []
        var failure: Error?
    }

    struct Setup {
        let call: VoiceCall
        let listener: MockListener
        let synthesizer: MockSynthesizer
        let player: MockPlayer
        let sent: Sent
    }

    /// A call whose speaker waits for `finishNext()`, unless `speed` says otherwise.
    func makeCall(speed: Double = 0, download: Bool = false, synthesizer: MockSynthesizer? = nil) async throws -> Setup {
        let listener = MockListener()
        let synthesizer = synthesizer ?? MockSynthesizer(delay: .milliseconds(5), download: download)
        let player = MockPlayer(speed: speed)
        let sent = Sent()
        let call = VoiceCall(voice: .f2, listener: listener, synthesizer: synthesizer, player: player,
                             endOfTurn: .milliseconds(60), relisten: .milliseconds(20)) { text in
            if let failure = sent.failure { throw failure }
            sent.texts.append(text)
        }
        Task { await call.start() }
        try await until { call.phase == .listening }
        return Setup(call: call, listener: listener, synthesizer: synthesizer, player: player, sent: sent)
    }

    @Test func aPauseSendsWhatYouSaid() async throws {
        let s = try await makeCall()
        #expect(s.listener.isListening && s.call.status == "Listening")
        s.listener.hear("what's")
        s.listener.hear("what's the weather")
        #expect(s.call.heard == "what's the weather" && s.sent.texts.isEmpty)
        try await until { s.sent.texts == ["what's the weather"] }
        #expect(s.call.phase == .thinking && s.call.status == "Thinking…")
        // Recognition starts over, so the next turn doesn't hold these words.
        #expect(s.listener.sessions == 2 && s.listener.isListening)
        // Final results add up until the pause.
        s.listener.hear("one", final: true)
        s.listener.hear("two", final: true)
        s.listener.hear("three")
        try await until { s.sent.texts.count == 2 }
        #expect(s.sent.texts[1] == "one two three")
    }

    @Test func readsTheReplySentenceBySentenceAsItStreams() async throws {
        let s = try await makeCall()
        s.listener.hear("hello")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "Hi there! How", done: false))
        #expect(s.call.phase == .speaking)
        try await until { s.player.waiting == 1 }
        #expect(await s.synthesizer.requests == ["Hi there!"])
        #expect(s.call.saying == "Hi there!" && s.call.status == "Speaking")
        // Markdown is read as words.
        s.call.reply(CallReply(key: "1", text: "Hi there! How are **you** today? Fine", done: false))
        s.call.reply(CallReply(key: "1", text: "Hi there! How are **you** today? Fine `thanks`", done: true))
        try await until { s.player.waiting == 3 }
        #expect(await s.synthesizer.requests == ["Hi there!", "How are you today?", "Fine thanks"])
        s.player.finishNext()
        s.player.finishNext()
        #expect(s.call.phase == .speaking)
        s.player.finishNext()
        try await until { s.call.phase == .listening }
        #expect(s.call.saying.isEmpty)
    }

    @Test func staysThinkingUntilTheReplyIsOver() async throws {
        let s = try await makeCall()
        s.listener.hear("hello")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "One. Two", done: false))
        try await until { s.player.waiting == 1 }
        s.player.finishNext()
        // Said all it has, but more is coming.
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "One. Two", done: true))
        try await until { s.player.waiting == 1 }
        s.player.finishNext()
        try await until { s.call.phase == .listening }
    }

    @Test func keepsTheReplyInOrder() async throws {
        // The first batch's phonemes take longest; it's still said first.
        let synthesizer = MockSynthesizer(delay: .milliseconds(5)) { text in text.hasPrefix("First") ? .milliseconds(120) : .milliseconds(1) }
        let s = try await makeCall(synthesizer: synthesizer)
        s.listener.hear("go")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "First one. Second", done: false))
        s.call.reply(CallReply(key: "1", text: "First one. Second one. Third", done: false))
        s.call.reply(CallReply(key: "1", text: "First one. Second one. Third one.", done: true))
        try await until { s.player.waiting == 3 }
        // All asked for at once, spoken in order.
        #expect(await Set(synthesizer.requests) == ["First one.", "Second one.", "Third one."])
        #expect(await synthesizer.spoken == ["First one.", "Second one.", "Third one."])
    }

    @Test func aReplyFromBeforeTheCallIsntRead() async throws {
        let s = try await makeCall()
        s.call.reply(CallReply(key: "0", text: "An old answer. From before.", done: true))
        s.call.reply(CallReply(key: "0", text: "An old answer. From before. Still streaming.", done: true))
        try await Task.sleep(for: .milliseconds(50))
        #expect(await s.synthesizer.requests.isEmpty)
        #expect(s.call.phase == .listening)
        // The next one is.
        s.listener.hear("and now")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "New answer.", done: true))
        try await until { s.player.waiting == 1 }
    }

    @Test func talkingOverThemStopsThem() async throws {
        let s = try await makeCall()
        s.listener.hear("tell me a story")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "Once upon a time. There was a fox. It", done: false))
        // Both sentences in one request, each its own piece.
        try await until { s.player.waiting == 2 }
        #expect(await s.synthesizer.requests == ["Once upon a time. There was a fox."])
        // One word isn't enough.
        s.listener.hear("hmm")
        #expect(s.call.phase == .speaking && s.player.stops == 0)
        s.listener.hear("hmm wait")
        #expect(s.call.phase == .listening && s.player.stops == 1 && s.player.waiting == 0 && s.call.saying.isEmpty)
        // The rest of that reply goes unsaid.
        s.call.reply(CallReply(key: "1", text: "Once upon a time. There was a fox. It ran away. The end.", done: true))
        try await Task.sleep(for: .milliseconds(40))
        #expect(await s.synthesizer.requests == ["Once upon a time. There was a fox."])
        // What you said goes to them, and their answer to it is read.
        try await until { s.sent.texts == ["tell me a story", "hmm wait"] }
        s.call.reply(CallReply(key: "2", text: "Sure, I'll stop.", done: true))
        try await until { s.player.waiting == 1 }
        #expect(await s.synthesizer.requests.last == "Sure, I'll stop.")
    }

    @Test func theirOwnVoiceThroughTheMicrophoneIsntYou() async throws {
        let s = try await makeCall()
        s.listener.hear("hi")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "Nice to see you again friend. Bye", done: false))
        try await until { s.player.waiting == 1 }
        // The speaker, heard: not a barge-in, not a turn.
        s.listener.hear("nice to see you again")
        #expect(s.call.phase == .speaking && s.player.stops == 0 && s.call.heard == "hi")
        try await Task.sleep(for: .milliseconds(100))
        #expect(s.sent.texts == ["hi"])
        // Words of your own are you.
        s.listener.hear("nice to see you again no stop please now")
        #expect(s.player.stops == 1)
    }

    @Test func muteStopsListening() async throws {
        let s = try await makeCall()
        s.call.setMuted(true)
        #expect(!s.listener.isListening && s.call.status == "Muted")
        s.listener.hear("not heard")
        #expect(s.call.heard.isEmpty)
        s.call.setMuted(false)
        #expect(s.listener.isListening && s.listener.sessions == 2 && s.call.status == "Listening")
    }

    @Test func recognitionStartsAgainWhenItStops() async throws {
        let s = try await makeCall()
        s.listener.hear("half a")
        s.listener.end()
        // What was heard goes, and a new session starts shortly.
        #expect(s.sent.texts.isEmpty)
        try await until { s.sent.texts == ["half a"] }
        try await until { s.listener.isListening && s.listener.sessions == 2 }
    }

    @Test func endingStopsEverything() async throws {
        let s = try await makeCall()
        s.listener.hear("hello")
        try await until { s.call.phase == .thinking }
        s.call.reply(CallReply(key: "1", text: "Hello! And", done: false))
        try await until { s.player.waiting == 1 }
        s.call.end()
        #expect(s.call.phase == .ended && s.call.status == "Call ended" && s.call.isOver)
        #expect(s.player.closed && !s.listener.isListening && s.call.level == 0)
        s.call.reply(CallReply(key: "1", text: "Hello! And more. Lots more.", done: true))
        s.call.setMuted(true)
        try await Task.sleep(for: .milliseconds(30))
        #expect(await s.synthesizer.requests == ["Hello!"] && s.call.phase == .ended && !s.call.muted)
    }

    @Test func noMicrophoneEndsTheCall() async throws {
        let s = try await makeCall()
        s.listener.failure("Dex needs the microphone for calls.")
        #expect(s.call.phase == .failed && s.call.error == "Dex needs the microphone for calls." && s.call.isOver)
        #expect(s.player.closed && !s.listener.isListening)
    }

    @Test func aMessageThatDidntSendSaysSo() async throws {
        let s = try await makeCall()
        s.sent.failure = AgentError.remote("Chat not found")
        s.listener.hear("hello")
        try await until { s.call.error != nil }
        #expect(s.call.phase == .listening && s.call.error == "Chat not found")
    }

    @Test func theFirstCallDownloadsTheVoice() async throws {
        let listener = MockListener()
        let call = VoiceCall(voice: .m2, listener: listener, synthesizer: MockSynthesizer(delay: .milliseconds(10), download: true), player: MockPlayer()) { _ in }
        Task { await call.start() }
        // Listening already, while the voice gets ready.
        try await until { call.downloading != nil }
        #expect(listener.isListening && call.status.hasPrefix("Getting their voice ready… "))
        try await until { call.status == "Getting their voice ready… 50%" || call.status == "Getting their voice ready… 75%" }
        try await until { call.phase == .listening && call.downloading == nil }
        call.end()
    }

    @Test func aReplyDuringTheDownloadKeepsSpeaking() async throws {
        let listener = MockListener()
        let player = MockPlayer(speed: 0)
        let call = VoiceCall(voice: .f2, listener: listener, synthesizer: MockSynthesizer(delay: .milliseconds(30), download: true), player: player,
                             endOfTurn: .milliseconds(40)) { _ in }
        Task { await call.start() }
        try await until { call.downloading != nil }
        listener.hear("quick question")
        // Sent while the voice is still on its way.
        try await until { listener.sessions == 2 }
        #expect(call.phase == .starting && call.downloading != nil)
        call.reply(CallReply(key: "1", text: "Sure thing. Ask", done: false))
        try await until { player.waiting == 1 }
        try await until { call.downloading == nil }
        #expect(call.phase == .speaking && call.status == "Speaking")
        player.finishNext()
        try await until { call.phase == .thinking }
        call.end()
    }

    @Test func aBigReplyGoesInPiecesTheServerTakes() {
        let long = String(repeating: "word ", count: 500).trimmingCharacters(in: .whitespaces) + "."
        #expect(VoiceCall.batches(["One.", "Two."]) == ["One. Two."])
        let batches = VoiceCall.batches([long, "Short.", long])
        #expect(batches == [long + " Short.", long])
        #expect(batches.allSatisfy { $0.utf16.count <= VoiceText.maxSpokenCharacters })
    }

    @Test func theLatestReplyIsTheOneAfterYourLastWords() {
        func assistant(_ text: String, at timestamp: Double) -> AssistantMessage {
            AssistantMessage(content: [.thinking("hmm", redacted: false), .text(text)], timestamp: timestamp)
        }
        let items: [DisplayItem] = [
            .user(id: "u1", text: "hi", images: 0),
            .assistant(id: "a1", messages: [assistant("Old.", at: 1)], streaming: false, endedAt: 2),
            .user(id: "u2", text: "and?", images: 0),
            .assistant(id: "a2", messages: [assistant("Let me look.", at: 1_700_000_000_123), AssistantMessage(content: [.text("")], timestamp: 5), assistant("Found it.", at: 6)],
                       streaming: true, endedAt: nil)
        ]
        let reply = CallReply.latest(items, running: true)
        #expect(reply == CallReply(key: "1700000000123", text: "Let me look.\n\nFound it.", done: false))
        #expect(CallReply.latest(items.dropLast().map { $0 }, running: false) == nil)
        let finished: [DisplayItem] = Array(items.dropLast()) + [.assistant(id: "a2", messages: [assistant("Done.", at: 9)], streaming: false, endedAt: 10)]
        #expect(CallReply.latest(finished, running: false)?.done == true)
        #expect(CallReply.latest(finished, running: true)?.done == false)
    }
}
