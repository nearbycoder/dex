import Foundation

// Files attached to a chat message (apps/web/src/shared/attachments.ts). `POST /api/attachments` turns an upload into a
// ChatAttachment (an image prepared for the model, or a file's text); the app sends it back unchanged with the message,
// and the agent writes each one into the message as an `<attachment …>` tag. Apps show those tags as chips.

/// An attachment as the server prepared it. Kept as its JSON, so it goes back to `sendMessage` exactly as it came.
public struct ChatAttachment: Sendable, Hashable {
    public var json: JSONValue
    public init(json: JSONValue) { self.json = json }
    /// `image` or `text`.
    public var kind: String { json["kind"]?.string ?? "text" }
    public var name: String { json["name"]?.string ?? "file" }
    public var mimeType: String { json["mimeType"]?.string ?? "application/octet-stream" }
    /// An image's base64.
    public var data: String? { json["data"]?.string }
}

/// A file named in a message: what the apps show for it.
public struct AttachedFile: Codable, Sendable, Hashable {
    public var name: String
    public var mimeType: String
    public init(name: String, mimeType: String) { self.name = name; self.mimeType = mimeType }
    enum CodingKeys: String, CodingKey { case name, mimeType }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.value(.name, default: "file"); mimeType = c.value(.mimeType, default: "application/octet-stream")
    }
}

public enum AttachmentLimits {
    /// Files per message.
    public static let files = 10
    /// An upload's size before the server prepares it.
    public static let uploadBytes = 25 * 1024 * 1024
}

/// Why a file couldn't be attached; `status` is the server's (401: the session ended; 503: try again soon).
public struct AttachmentError: LocalizedError, Sendable, Equatable {
    public var message: String
    public var status: Int?
    public init(_ message: String, status: Int? = nil) { self.message = message; self.status = status }
    public var errorDescription: String? { message }
}

private func unescapeAttribute(_ value: String) -> String {
    value.replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&lt;", with: "<")
        .replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&amp;", with: "&")
}

/// A message's text without its attachment tags, and the files they name (splitAttachments on the web).
public func splitAttachments(_ text: String) -> (text: String, files: [AttachedFile]) {
    let attachmentTag = try! NSRegularExpression(pattern: #"<attachment ((?:[a-z]+="[^"]*"\s*)+)(?:/>|>\n?[\s\S]*?\n?</attachment>)"#)
    let attachmentAttribute = try! NSRegularExpression(pattern: #"([a-z]+)="([^"]*)""#)
    let blankLines = try! NSRegularExpression(pattern: #"\n{3,}"#)
    let source = text as NSString
    let matches = attachmentTag.matches(in: text, range: NSRange(location: 0, length: source.length))
    guard !matches.isEmpty else { return (text, []) }
    let files = matches.map { match -> AttachedFile in
        let attributes = source.substring(with: match.range(at: 1))
        var values: [String: String] = [:]
        let attributeSource = attributes as NSString
        for pair in attachmentAttribute.matches(in: attributes, range: NSRange(location: 0, length: attributeSource.length)) {
            values[attributeSource.substring(with: pair.range(at: 1))] = unescapeAttribute(attributeSource.substring(with: pair.range(at: 2)))
        }
        return AttachedFile(name: values["name"] ?? "file", mimeType: values["type"] ?? "application/octet-stream")
    }
    let rest = attachmentTag.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: source.length), withTemplate: "")
    let collapsed = blankLines.stringByReplacingMatches(in: rest, range: NSRange(location: 0, length: (rest as NSString).length), withTemplate: "\n\n")
    return (collapsed.trimmingCharacters(in: .whitespacesAndNewlines), files)
}

/// A short line naming the attachments, for a pending or queued message that has no text.
public func attachmentSummary(_ names: [String]) -> String {
    switch names.count {
    case 0: ""
    case 1: names[0]
    default: "\(names[0]) and \(names.count - 1) more"
    }
}

/// `POST /api/attachments` (apps/web/src/routes/api.attachments.ts): sends one file, which comes back prepared for the
/// model. Nothing is stored; the result goes with the message.
public enum AttachmentUploader {
    public static func upload(server: URL, token: String, data: Data, name: String, mimeType: String,
                              session: URLSession = DexHTTP.session) async throws -> ChatAttachment {
        guard data.count <= AttachmentLimits.uploadBytes else {
            throw AttachmentError("\(name) is too large (limit \(AttachmentLimits.uploadBytes / 1024 / 1024) MB).", status: 413)
        }
        let boundary = "dex-\(UUID().uuidString)"
        var request = DexHTTP.request(server.appending(path: "api/attachments"), token: token)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipart(boundary: boundary, data: data, name: name, mimeType: mimeType)
        let (body, response): (Data, URLResponse)
        do {
            (body, response) = try await session.data(for: request)
        } catch {
            throw AttachmentError("Couldn't reach Dex: \(error.localizedDescription)")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = try? JSONDecoder().decode(JSONValue.self, from: body)
        guard (200..<300).contains(status), let json, json.object != nil else {
            let fallback = switch status {
            case 401: "Sign in again"
            case 503: "Dex is restarting. Try again in a moment."
            default: "Upload failed (\(status))."
            }
            throw AttachmentError(json?["error"]?.string ?? fallback, status: status)
        }
        return ChatAttachment(json: json)
    }

    /// One `file` field, as a browser's FormData sends it.
    static func multipart(boundary: String, data: Data, name: String, mimeType: String) -> Data {
        let safeName = name.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }
}
