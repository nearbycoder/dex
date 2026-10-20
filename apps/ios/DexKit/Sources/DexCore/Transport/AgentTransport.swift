import Foundation

/// What a transport reports while it's open.
public enum TransportEvent: Sendable {
    case opened
    case message(String)
    /// The socket closed. `code` is the WebSocket close code (4001: signed out everywhere); `httpStatus` is set when
    /// the upgrade itself was refused (401: the session is no longer valid).
    case closed(code: Int, reason: String?, httpStatus: Int?)
}

/// A WebSocket to the user's DexAgent, or a stand-in for one. One transport is one connection attempt: the
/// connection makes a new one to reconnect.
public protocol AgentTransport: AnyObject, Sendable {
    /// Opens the socket and reports what happens on it, in order, until `.closed`.
    func open(_ handler: @escaping @Sendable (TransportEvent) -> Void)
    func send(_ text: String)
    func close()
}

/// Makes a transport for each connection attempt.
public protocol AgentTransportFactory: Sendable {
    func makeTransport() -> AgentTransport
}

/// The real thing: `wss://<host>/agents/dex-agent/<user id>`, signed in with the session token as the `dex_session`
/// cookie and no Origin header (the agent route rejects other origins).
public final class WebSocketTransport: NSObject, AgentTransport, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let request: URLRequest
    private let lock = NSLock()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var handler: (@Sendable (TransportEvent) -> Void)?
    private var finished = false

    public init(server: URL, userId: String, token: String) {
        var components = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        components.scheme = server.scheme == "http" ? "ws" : "wss"
        components.path = "/agents/dex-agent/\(userId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? userId)"
        components.queryItems = [URLQueryItem(name: "_pk", value: UUID().uuidString)]
        var request = URLRequest(url: components.url!)
        request.setValue("\(DexHTTP.sessionCookie)=\(token)", forHTTPHeaderField: "Cookie")
        request.timeoutInterval = 30
        self.request = request
    }

    public func open(_ handler: @escaping @Sendable (TransportEvent) -> Void) {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 64 * 1024 * 1024
        lock.withLock {
            self.handler = handler
            self.session = session
            self.task = task
        }
        task.resume()
        receive(on: task)
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.string(let text)):
                self.emit(.message(text))
                self.receive(on: task)
            case .success(.data(let data)):
                if let text = String(data: data, encoding: .utf8) { self.emit(.message(text)) }
                self.receive(on: task)
            case .success:
                self.receive(on: task)
            case .failure:
                let status = (task.response as? HTTPURLResponse)?.statusCode
                self.finish(code: task.closeCode.rawValue == 0 ? 1006 : task.closeCode.rawValue, reason: task.closeReason.flatMap { String(data: $0, encoding: .utf8) }, httpStatus: status.flatMap { $0 == 101 ? nil : $0 })
            }
        }
    }

    private func emit(_ event: TransportEvent) {
        let handler = lock.withLock { finished ? nil : self.handler }
        handler?(event)
    }

    private func finish(code: Int, reason: String?, httpStatus: Int?) {
        let handler: (@Sendable (TransportEvent) -> Void)? = lock.withLock {
            if finished { return nil }
            finished = true
            return self.handler
        }
        handler?(.closed(code: code, reason: reason, httpStatus: httpStatus))
        lock.withLock { session }?.invalidateAndCancel()
    }

    public func send(_ text: String) {
        lock.withLock { task }?.send(.string(text)) { _ in }
    }

    public func close() {
        lock.withLock { task }?.cancel(with: .normalClosure, reason: nil)
        finish(code: 1000, reason: nil, httpStatus: nil)
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        emit(.opened)
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(code: closeCode.rawValue, reason: reason.flatMap { String(data: $0, encoding: .utf8) }, httpStatus: nil)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode
        finish(code: 1006, reason: error?.localizedDescription, httpStatus: status.flatMap { $0 == 101 ? nil : $0 })
    }
}

public struct WebSocketTransportFactory: AgentTransportFactory {
    public let server: URL
    public let userId: String
    public let token: String
    public init(server: URL, userId: String, token: String) { self.server = server; self.userId = userId; self.token = token }
    public func makeTransport() -> AgentTransport { WebSocketTransport(server: server, userId: userId, token: token) }
}

/// Shared HTTP details.
public enum DexHTTP {
    public static let sessionCookie = "dex_session"

    /// A request to the Dex server, signed in with the session token as its cookie.
    public static func request(_ url: URL, token: String?) -> URLRequest {
        var request = URLRequest(url: url)
        if let token { request.setValue("\(sessionCookie)=\(token)", forHTTPHeaderField: "Cookie") }
        return request
    }

    /// The session cookie for web views and media players on the server's host.
    public static func cookie(server: URL, token: String) -> HTTPCookie? {
        guard let host = server.host() else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: sessionCookie, .value: token, .domain: host, .path: "/",
            .expires: Date().addingTimeInterval(60 * 60 * 24 * 30)
        ]
        if server.scheme == "https" { properties[.secure] = "TRUE" }
        return HTTPCookie(properties: properties)
    }

    /// A URLSession that never stores or sends cookies on its own (requests carry the session cookie explicitly).
    public static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }()
}
