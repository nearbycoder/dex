import DexCore
import Intents
import os
import SwiftUI
import UIKit
import UserNotifications

/// Puts a sidekick's face on their notifications: each becomes a communication notification (an incoming
/// INSendMessageIntent from them), so iOS shows their picture where it would show the app icon. The picture is the one
/// the widgets show, fetched the same way (`WidgetFeed`, with the session the app shares in the Keychain) and kept in
/// this extension's own container, so usually nothing needs fetching. Whatever fails, the notification arrives as sent.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private struct Pending {
        var content: UNMutableNotificationContent
        var deliver: (UNNotificationContent) -> Void
    }

    private let pending = OSAllocatedUnfairLock<Pending?>(uncheckedState: nil)
    private var task: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else { return contentHandler(request.content) }
        guard content.userInfo["kind"] as? String == "sidekick", let sessionId = content.userInfo["sessionId"] as? String, !sessionId.isEmpty else {
            return contentHandler(content)
        }
        pending.withLockUnchecked { $0 = Pending(content: content, deliver: contentHandler) }
        task = Task { [weak self] in
            let sender = await Senders.sidekick(sessionId: sessionId)
            await self?.finish(from: sender, sessionId: sessionId)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
        deliver { $0 }
    }

    private func finish(from sender: Senders.Sender?, sessionId: String) async {
        guard let sender else { return deliver { $0 } }
        let person = INPerson(
            personHandle: INPersonHandle(value: sender.id, type: .unknown),
            nameComponents: nil,
            displayName: sender.name,
            image: INImage(imageData: sender.face),
            contactIdentifier: nil,
            customIdentifier: sender.id
        )
        let body = pending.withLockUnchecked { $0?.content.body } ?? ""
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: body,
            speakableGroupName: nil,
            conversationIdentifier: sessionId,
            serviceName: nil,
            sender: person,
            attachments: nil
        )
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()
        deliver { content in (try? content.updating(from: intent)) ?? content }
    }

    /// Hands the notification over once (expiry and the lookup can race).
    private func deliver(_ change: (UNMutableNotificationContent) -> UNNotificationContent) {
        guard let pending = pending.withLockUnchecked({ state in defer { state = nil }; return state }) else { return }
        pending.deliver(change(pending.content))
    }
}

/// Who a sidekick's notification is from: the widgets' snapshot of the sidekicks, looked up by the chat it opens.
enum Senders {
    struct Sender: Sendable {
        let id: String
        let name: String
        /// Their round face as a PNG.
        let face: Data
    }

    static let store = WidgetStore.local

    static func sidekick(sessionId: String) async -> Sender? {
        let share = WidgetShare.load()
        // What's kept, when it has this sidekick and pictures as recent as the app's; else a fetch.
        if let kept = store.load(), let sidekick = kept.sidekicks.first(where: { $0.sessionId == sessionId }), store.picturesAreRecent(tag: share?.pictures) {
            return sender(sidekick)
        }
        guard case .ready(let snapshot, _) = await WidgetFeed.load(store: store, credentials: share?.credentials, pictures: share?.pictures),
              let sidekick = snapshot.sidekicks.first(where: { $0.sessionId == sessionId }) else { return nil }
        return sender(sidekick)
    }

    private static func sender(_ sidekick: WidgetSidekick) -> Sender? {
        guard let face = face(sidekick, picture: store.picture(sidekick.id).flatMap(UIImage.init(data:))) else { return nil }
        return Sender(id: sidekick.id, name: sidekick.name, face: face)
    }

    /// Their picture on a wash of their color in a circle, like the widgets' faces (else their emoji or initial).
    static func face(_ sidekick: WidgetSidekick, picture: UIImage?, side: CGFloat = 256) -> Data? {
        let tint = UIColor(AgentColors.color(sidekick.color))
        let bounds = CGRect(x: 0, y: 0, width: side, height: side)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(bounds: bounds, format: format).pngData { context in
            UIBezierPath(ovalIn: bounds).addClip()
            UIColor.white.setFill()
            context.fill(bounds)
            tint.withAlphaComponent(0.3).setFill()
            context.fill(bounds)
            if let picture {
                // Fill the circle, cropping the longer side.
                let scale = max(side / picture.size.width, side / picture.size.height)
                let size = CGSize(width: picture.size.width * scale, height: picture.size.height * scale)
                picture.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
            } else {
                let glyph = sidekick.glyph as NSString
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: side * 0.44, weight: .semibold),
                    .foregroundColor: tint
                ]
                let size = glyph.size(withAttributes: attributes)
                glyph.draw(at: CGPoint(x: (side - size.width) / 2, y: (side - size.height) / 2), withAttributes: attributes)
            }
        }
    }
}
