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

    /// The native face is framed as the web's PNG of a look: a BoopFace in the 0 -8 240 248 view box, on clear.
    @Test func plainFaceMatchesTheWebsFraming() throws {
        let url = try #require(SidekickArt.png(SidekickParts(skin: "teal")))
        #expect(url.count < Characters.maxImageURLLength)
        let image = try #require(AgentAvatar.decode(url)?.cgImage)
        #expect(image.width == 256 && image.height == 256 && SidekickPicture.isFace(image))
        var pixels = [UInt8](repeating: 0, count: 256 * 256 * 4)
        let context = try #require(CGContext(data: &pixels, width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 256 * 4,
                                             space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: 256, height: 256))
        // A point in the view box, as RGBA (rows from the top).
        func pixel(_ x: Double, _ y: Double) -> [UInt8] {
            let scale = 256.0 / 248
            let column = Int((256 - 240 * scale) / 2 + x * scale), row = Int((y + 8) * scale)
            let index = (row * 256 + column) * 4
            return Array(pixels[index..<index + 4])
        }
        let teal: [UInt8] = [0x14, 0xb8, 0xa6, 255]
        func near(_ a: [UInt8], _ b: [UInt8]) -> Bool { zip(a, b).allSatisfy { abs(Int($0) - Int($1)) <= 6 } }
        #expect(near(pixel(120, 200), teal), "the head")
        #expect(near(pixel(120, 4), teal), "the antenna")
        #expect(near(pixel(86, 126), [255, 255, 255, 255]) && near(pixel(154, 126), [255, 255, 255, 255]), "the eyes")
        #expect(pixel(4, 120)[3] == 0 && pixel(120, 236)[3] == 0, "clear around the head")
    }
}
