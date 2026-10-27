import Foundation
import Testing
@testable import DexCore

/// Attachments: the tags the agent writes into messages (the same cases as the web's goldens in
/// apps/android/core/model/src/test/resources/golden/attachments.json), decoding, the upload body, and sending.
@MainActor
@Suite struct AttachmentTests {
    @Test func splitsTagsOutOfText() {
        let pdf = #"<attachment name="Q3 report.pdf" type="application/pdf" converted="markdown">"#
        let photo = #"<attachment name="IMG_0036.png" type="image/png" />"#
        let cases: [(String, String, [AttachedFile])] = [
            ("plain message, no files", "plain message, no files", []),
            ("What does this say?\n\(pdf)\n# Q3\nRevenue up 12%.\n</attachment>", "What does this say?",
             [AttachedFile(name: "Q3 report.pdf", mimeType: "application/pdf")]),
            (#"<attachment name="notes &quot;draft&quot; &lt;1&gt;.md" type="text/markdown" truncated="true">"# + "\nline one\n\n\n\nline two\n</attachment>", "",
             [AttachedFile(name: #"notes "draft" <1>.md"#, mimeType: "text/markdown")]),
            ("Look at this\n\(photo)", "Look at this", [AttachedFile(name: "IMG_0036.png", mimeType: "image/png")]),
            ("\(photo)\n\(pdf)\ntext\n</attachment>\n\n\n\nAnd these two", "And these two",
             [AttachedFile(name: "IMG_0036.png", mimeType: "image/png"), AttachedFile(name: "Q3 report.pdf", mimeType: "application/pdf")]),
            (#"<attachment name="IMG_0036.png" type="image/png">"# + "\n(An image the user attached. This chat's model reads text only, so it can't see it.)\n</attachment>", "",
             [AttachedFile(name: "IMG_0036.png", mimeType: "image/png")]),
            (#"<attachment name="broken" type="text/plain">no closing tag"#, #"<attachment name="broken" type="text/plain">no closing tag"#, []),
            ("  spaced text with no tags  ", "  spaced text with no tags  ", []),
        ]
        for (input, text, files) in cases {
            let split = splitAttachments(input)
            #expect(split.text == text, "\(input)")
            #expect(split.files == files, "\(input)")
        }
        #expect(attachmentSummary([]) == "")
        #expect(attachmentSummary(["a.png"]) == "a.png")
        #expect(attachmentSummary(["a.png", "b.pdf", "c.txt"]) == "a.png and 2 more")
    }

    @Test func readsAttachmentsInTheTranscript() throws {
        let json = #"""
        {"type":"snapshot","entries":[{"id":2,"conversationId":1,"kind":"pi.user","model":[{"role":"user","timestamp":1,"content":[
          {"type":"text","text":"Compare these"},
          {"type":"text","text":"<attachment name=\"IMG_0036.png\" type=\"image/png\" />"},
          {"type":"image","data":"iVBORw0KGgo=","mimeType":"image/png"},
          {"type":"text","text":"<attachment name=\"big.jpg\" type=\"image/jpeg\" />"},
          {"type":"image","data":"","mimeType":"image/jpeg","ref":"2:0:4"},
          {"type":"text","text":"<attachment name=\"Q3 report.pdf\" type=\"application/pdf\" converted=\"markdown\" />"}
        ]}]}],"tools":[],"nestedTools":[],"compactions":[],"inbox":[],"agent":{},"usage":{}}
        """#
        let snapshot = try JSONDecoder().decode(SnapshotEvent.self, from: Data(json.utf8))
        let items = TranscriptState.from(snapshot: snapshot).displayItems
        guard case .user(_, let text, let images, let files, let parts) = items.first else { Issue.record("no user item"); return }
        #expect(text == "Compare these")
        #expect(images == 2)
        #expect(files.map(\.name) == ["IMG_0036.png", "big.jpg", "Q3 report.pdf"])
        #expect(parts == [ImagePart(data: "iVBORw0KGgo=", mimeType: "image/png"), ImagePart(data: "", mimeType: "image/jpeg", ref: "2:0:4")])
    }

    @Test func decodesQueuedMessagesAndAttachments() throws {
        let old = try JSONDecoder().decode(QueuedMessage.self, from: Data(#"{"id":"q","text":"hi","createdAt":1}"#.utf8))
        #expect(old.attachments.isEmpty)
        let new = try JSONDecoder().decode(QueuedMessage.self, from: Data(#"{"id":"q","text":"","createdAt":1,"attachments":[{"name":"a.pdf","mimeType":"application/pdf"}]}"#.utf8))
        #expect(new.attachments == [AttachedFile(name: "a.pdf", mimeType: "application/pdf")])
        let attachment = ChatAttachment(json: try JSONValue.parse(##"{"kind":"text","name":"n.md","mimeType":"text/markdown","text":"# x","truncated":true}"##))
        #expect(attachment.kind == "text")
        #expect(attachment.name == "n.md")
        #expect(attachment.json["truncated"]?.bool == true)
    }

    @Test func buildsTheUploadBody() {
        let body = AttachmentUploader.multipart(boundary: "b", data: Data("# Hi".utf8), name: #"my "notes".md"#, mimeType: "text/markdown")
        let text = String(decoding: body, as: UTF8.self)
        #expect(text == "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"my 'notes'.md\"\r\nContent-Type: text/markdown\r\n\r\n# Hi\r\n--b--\r\n")
    }

    @Test func sendsAttachmentsAndShowsThem() async throws {
        let agent = MockAgent()
        agent.chunkDelay = .milliseconds(1)
        let client = DexClient(credentials: nil, factory: MockTransportFactory(agent: agent), cache: nil)
        client.uploader = { data, name, type in try await MockAgent.upload(data: data, name: name, mimeType: type) }
        client.start()
        await eventually { client.isConnected }
        let photo = try await client.uploadAttachment(Data([1, 2]), name: "shot.png", mimeType: "image/png")
        let notes = try await client.uploadAttachment(Data("# n".utf8), name: "notes.md", mimeType: "text/markdown")
        await #expect(throws: AttachmentError("Dex can't read .zip files yet.", status: 415)) {
            try await client.uploadAttachment(Data([0]), name: "a.zip", mimeType: "application/zip")
        }
        let feed = client.chat(MockData.welcomeId)
        await eventually { feed.transcript.loaded }
        try await feed.send("", attachments: [photo, notes])
        await eventually {
            feed.transcript.displayItems.contains { if case .user(_, _, _, let files, _) = $0 { !files.isEmpty } else { false } }
        }
        let sent = feed.transcript.displayItems.compactMap { item -> ([AttachedFile], [ImagePart])? in
            if case .user(_, _, _, let files, let parts) = item, !files.isEmpty { (files, parts) } else { nil }
        }.last
        #expect(sent?.0.map(\.name) == ["shot.png", "notes.md"])
        #expect(sent?.1.count == 1)
        #expect(agent.calls.last { $0.method == "sendMessage" }?.args.count == 3)
    }
}
