import DexCore
import Foundation
import Testing
import UIKit
@testable import Dex

@MainActor
@Suite struct CharacterRouteTests {
    @Test func libraryPage() {
        let router = Router()
        #expect(AppTab.libraryPages.contains(.characters))
        router.open(.newCharacter, compact: true)
        #expect(router.libraryPath == [.page(.characters), .newCharacter])
        #expect(router.libraryNewItem?.route == .newCharacter)
        // Creating one: the new page becomes theirs.
        router.replaceLibrary(.newCharacter, with: .character("muse"))
        #expect(router.libraryPath == [.page(.characters), .character("muse")])
        // Unfolding keeps it open in the sidebar's Characters page.
        router.adapt(compact: false)
        #expect(router.tab == .characters && router.charactersPath == [.character("muse")])
        router.closeLibrary(.character("muse"))
        #expect(router.charactersPath.isEmpty)
    }

    @Test func sheetAndConversation() {
        let router = Router()
        router.characterSheet = .character("muse")
        #expect(router.characterSheet?.id == .character("muse"))
        router.openChat("s-muse")
        #expect(router.tab == .chats && router.chat == "s-muse")
    }
}

@MainActor
@Suite struct CharacterPictureTests {
    func photo(width: CGFloat, height: CGFloat) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        // Noise, so the JPEG can't compress it away.
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            for x in stride(from: 0, to: Int(width), by: 8) {
                for y in stride(from: 0, to: Int(height), by: 8) {
                    UIColor(hue: .random(in: 0...1), saturation: 1, brightness: .random(in: 0.3...1), alpha: 1).setFill()
                    context.fill(CGRect(x: x, y: y, width: 8, height: 8))
                }
            }
        }.pngData()!
    }

    @Test func squareAndSmall() throws {
        let url = try CharacterPicture.dataURL(from: photo(width: 1600, height: 900))
        #expect(url.hasPrefix("data:image/jpeg;base64,"))
        #expect(url.count < Characters.maxImageURLLength)
        let image = try #require(AgentAvatar.decode(url))
        #expect(image.size.width == image.size.height && image.size.width <= 256)
    }

    @Test func refusesWhatIsntAPicture() {
        #expect(throws: CharacterPicture.Problem.self) { try CharacterPicture.dataURL(from: Data("not an image".utf8)) }
    }
}
