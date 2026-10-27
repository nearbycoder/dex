import Foundation
import Network

/// Sign in with ChatGPT from the app: OpenAI sends the browser back only to a 127.0.0.1 address (it allows nothing else
/// for open-source apps). Dex's server can't listen there, but this device can: while the browser sheet is open, the
/// app listens on that address, takes the callback, and sends the sheet on to `dex://`, which closes it. The agent
/// then finishes the sign-in with the address, exactly as if it had been pasted.
enum ChatGPTSignIn {
    enum Outcome {
        /// The address the browser landed on, for `finishChatGPTSignIn`.
        case captured(String)
        /// The sheet closed without a callback.
        case closed
        /// Nothing can listen on the callback address (an unexpected one, or the port is taken): paste it instead.
        case unavailable
    }

    static func run(_ url: URL, redirectUri: String) async -> Outcome {
        guard let listener = LoopbackCallback(redirectUri: redirectUri), await listener.start() else { return .unavailable }
        defer { listener.cancel() }
        let first = await withTaskGroup(of: String?.self) { group in
            group.addTask { await listener.callback() }
            group.addTask {
                await WebSignIn.present(url)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        // The sheet can finish first: the callback was taken before the sheet was sent on.
        if let address = first ?? listener.address { return .captured(address) }
        return .closed
    }
}

/// A one-request HTTP listener on a loopback address: it keeps the first GET to the callback path and answers it
/// with a redirect to `dex://chatgpt/signed-in`. Everything runs on its own queue.
nonisolated final class LoopbackCallback: @unchecked Sendable {
    private let host: String
    private let port: NWEndpoint.Port
    private let path: String
    private let queue = DispatchQueue(label: "dev.trydex.chatgpt-callback")
    private var listener: NWListener?
    private var captured: String?
    private var closed = false
    private var waiters: [CheckedContinuation<String?, Never>] = []

    /// Only a plain http address on this device, with a port.
    init?(redirectUri: String) {
        guard let parts = URLComponents(string: redirectUri), parts.scheme == "http",
              let host = parts.host, host == "127.0.0.1" || host == "localhost",
              let number = parts.port, let port = NWEndpoint.Port(rawValue: UInt16(clamping: number))
        else { return nil }
        self.host = host
        self.port = port
        self.path = parts.path.isEmpty ? "/" : parts.path
    }

    /// The callback address, once the browser has landed on it.
    var address: String? { queue.sync { captured } }

    /// Starts listening; false when it can't (the port is taken).
    func start() async -> Bool {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
        parameters.allowLocalEndpointReuse = true
        guard let listener = try? NWListener(using: parameters) else { return false }
        return await withCheckedContinuation { continuation in
            queue.async {
                var resumed = false
                let answer = { (ready: Bool) in
                    guard !resumed else { return }
                    resumed = true
                    continuation.resume(returning: ready)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    switch state {
                    case .ready: answer(true)
                    case .failed, .cancelled:
                        answer(false)
                        self?.close()
                    default: break
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                self.listener = listener
                listener.start(queue: self.queue)
            }
        }
    }

    /// Waits for the callback; nil once cancelled or closed.
    func callback() async -> String? {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                queue.async {
                    if let captured = self.captured {
                        continuation.resume(returning: captured)
                    } else if self.closed {
                        continuation.resume(returning: nil)
                    } else {
                        self.waiters.append(continuation)
                    }
                }
            }
        } onCancel: {
            cancel()
        }
    }

    func cancel() {
        queue.async { self.close() }
    }

    // MARK: On the queue

    private func close() {
        closed = true
        listener?.cancel()
        listener = nil
        let waiting = waiters
        waiters = []
        for waiter in waiting { waiter.resume(returning: captured) }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, Data())
    }

    private func receive(_ connection: NWConnection, _ buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            guard let self else { return connection.cancel() }
            var buffer = buffer
            if let data { buffer.append(data) }
            if buffer.range(of: Data("\r\n\r\n".utf8)) != nil || buffer.count > 65_536 || complete || error != nil {
                self.answer(connection, buffer)
            } else {
                self.receive(connection, buffer)
            }
        }
    }

    private func answer(_ connection: NWConnection, _ request: Data) {
        let line = String(decoding: request.prefix { $0 != 13 && $0 != 10 }, as: UTF8.self).split(separator: " ")
        let target = line.count >= 2 ? String(line[1]) : ""
        let targetPath = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        guard line.first == "GET", targetPath == path, !closed else {
            return respond(connection, status: "404 Not Found", headers: [], body: "Not found")
        }
        if captured == nil {
            captured = "http://\(host):\(port.rawValue)\(target)"
            let waiting = waiters
            waiters = []
            for waiter in waiting { waiter.resume(returning: captured) }
        }
        respond(
            connection,
            status: "302 Found",
            headers: ["Location: dex://chatgpt/signed-in"],
            body: #"<!doctype html><meta name="viewport" content="width=device-width"><p>Signed in to ChatGPT. <a href="dex://chatgpt/signed-in">Return to Dex.</a></p>"#
        )
    }

    private func respond(_ connection: NWConnection, status: String, headers: [String], body: String) {
        let bytes = Data(body.utf8)
        let head = (["HTTP/1.1 \(status)", "Content-Type: text/html; charset=utf-8", "Content-Length: \(bytes.count)", "Connection: close", "Cache-Control: no-store"] + headers)
            .joined(separator: "\r\n") + "\r\n\r\n"
        connection.send(content: Data(head.utf8) + bytes, completion: .contentProcessed { _ in connection.cancel() })
    }
}
