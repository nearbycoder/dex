import Foundation

// Voice calls with sidekicks: their voices and the text rules (apps/web/src/shared/voice.ts). Each app speaks with
// tiny-voca (https://huggingface.co/n4ze3m/tiny-voca), a 4.5M-parameter English text-to-speech model, run on the device:
// Dex serves its files (/api/voice/model/<file>) and turns text into the phoneme ids it reads (/api/voice/phonemes).
// Listening is the device's own speech recognition. What you say goes into the sidekick's conversation like a typed
// message, marked as spoken, and the reply is read aloud a sentence at a time as it streams in.
//
// The rules are the web's regular expressions, run with NSRegularExpression (UTF-16, like JavaScript's strings). Where
// ICU reads a pattern differently from JavaScript, it's spelled out: `\s` as JavaScript's whitespace, `\b` as an ASCII
// word's start, `\d` as ASCII digits, and the end of the text as `\z`.

/// tiny-voca's two voices: its `voice` input is the index.
public enum Voice: String, CaseIterable, Codable, Sendable, Hashable, Identifiable {
    case f2 = "F2"
    case m2 = "M2"

    public var id: String { rawValue }
    /// The model's `voice` input.
    public var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    public var label: String {
        switch self {
        case .f2: "Bright (female)"
        case .m2: "Warm (male)"
        }
    }

    /// A sidekick without a voice of their own gets one from their id, so it stays the same from call to call (the
    /// web's `voiceOf`: a 32-bit hash over the first UTF-16 unit of each character of the id).
    public static func of(id: String, voice: String? = nil) -> Voice {
        if let voice, let picked = Voice(rawValue: voice) { return picked }
        var hash: UInt32 = 0
        for scalar in id.unicodeScalars {
            let unit = UInt32(String(scalar).utf16.first ?? 0)
            hash = hash &* 31 &+ unit
        }
        return allCases[Int(hash % UInt32(allCases.count))]
    }
}

public extension CharacterProfile {
    /// Their voice on calls: their own, or the one picked from their id.
    var callVoice: Voice { Voice.of(id: id, voice: voice) }
}

public enum VoiceText {
    /// The Hugging Face revision of tiny-voca Dex uses (TINY_VOCA_REVISION): the model and its phonemizer data are a
    /// matched pair, and its first 12 characters are the model's address, so a new revision is a new file.
    public static let revision = "e5f9b11651a4db525fb207a56a91e4df2d1dd387"
    /// The model's sample rate (config.json `sample_rate`).
    public static let sampleRate = 24_000
    /// The longest text one phonemes request takes.
    public static let maxSpokenCharacters = 4_000

    // MARK: Sentences

    /// JavaScript's `\s` (ICU's differs a little).
    static let space = #"[\t\n\u000B\f\r    -     　﻿]"#
    static let notSpace = #"[^\t\n\u000B\f\r    -     　﻿]"#

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern.replacingOccurrences(of: "\\s", with: space).replacingOccurrences(of: "\\S", with: notSpace), options: options)
    }

    private static let spaces = regex(#"\s+"#)
    private static let edges = regex(#"^\s+|\s+\z"#)
    private static let boundary = regex(#"(?<=[.!?…]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])"#)
    /// ABBREVIATIONS, matched against the text with A–Z lowered (the web's `i` flag), and its `\b` as "no ASCII word
    /// character before".
    private static let abbreviation = regex(#"(?:(?<![A-Za-z0-9_])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|(?<![A-Za-z0-9_])[a-z])\.\z"#)
    private static let letterOrDigit = regex(#"[\p{L}\p{N}]"#)

    /// Sentences, without breaking after titles, initials, or inside numbers. The same rule as tiny-voca's own
    /// (`tiny_voca.infer.sentences`, and its web demo's worker.js).
    public static func sentences(_ text: String) -> [String] {
        var parts: [String] = []
        var current = ""
        for piece in split(trim(replace(spaces, in: text, with: " ")), at: boundary) {
            current = current.isEmpty ? piece : "\(current) \(piece)"
            if !matches(abbreviation, asciiLowercased(current)) {
                parts.append(current)
                current = ""
            }
        }
        if !current.isEmpty { parts.append(current) }
        return parts.filter { matches(letterOrDigit, $0) }
    }

    private static let trailingSpace = regex(#"\s+\z"#)
    private static let lastMarked = regex(#"[.!?…,;:]["'”’)\]»]*\z"#)
    private static let anyStop = regex(#"[.!?…]"#)
    private static let onlyPause = regex(#"^[,;:]\z"#)

    /// The text with a full stop when it ends without a mark: before one the voice lets the last syllable fall, without
    /// one the audio breaks off. A face or sign after the last word ("see you :)") is no mark; a comma or colon is.
    /// The same rule as `tiny_voca.infer.finished`.
    public static func finished(_ text: String) -> String {
        let body = replace(trailingSpace, in: text, with: "")
        guard !body.isEmpty else { return text }
        let last = split(body, at: spaces).last ?? body
        let marked = matches(letterOrDigit, last) ? matches(lastMarked, last) : matches(anyStop, last) || matches(onlyPause, last)
        return marked ? text : "\(body)."
    }

    private static let codeBlocks = regex(#"```[\s\S]*?(?:```|\z)"#)
    private static let tableRows = regex(#"^\s*\|.*\|\s*$"#, .anchorsMatchLines)
    private static let images = regex(#"!\[[^\]]*\]\([^)]*\)"#)
    private static let links = regex(#"\[([^\]]+)\]\([^)]*\)"#)
    private static let tags = regex(#"<[^>\n]+>"#)
    private static let inlineCode = regex(#"`([^`]*)`"#)
    private static let headings = regex(#"^\s{0,3}#{1,6}\s+(.*)$"#, .anchorsMatchLines)
    private static let listItems = regex(#"^\s*(?:[-*+]|[0-9]+[.)])\s+(.*)$"#, .anchorsMatchLines)
    private static let quotes = regex(#"^\s*>\s?"#, .anchorsMatchLines)
    private static let emphasis = regex(#"(\*\*|__|\*|_|~~)(?=\S)([^*_~\n]+?)\1"#)
    private static let addresses = regex(#"https?://\S+"#)
    private static let runs = regex(#"[ \t]+"#)
    private static let blankLines = regex(#"\n{2,}"#)

    /// What of a reply's Markdown can be read aloud: code, tables, images, and UI cards are left out, links read as their
    /// text, and the marks around words go.
    public static func speakable(_ markdown: String) -> String {
        var text = markdown
        text = replace(codeBlocks, in: text, with: " ")
        text = replace(tableRows, in: text, with: " ")
        text = replace(images, in: text, with: " ")
        text = replace(links, in: text, with: "$1")
        text = replace(tags, in: text, with: " ")
        text = replace(inlineCode, in: text, with: "$1")
        text = replace(headings, in: text, with: "$1.")
        text = replace(listItems, in: text) { groups in finished(groups[1]) }
        text = replace(quotes, in: text, with: "")
        text = replace(emphasis, in: text, with: "$2")
        text = replace(addresses, in: text, with: "a link")
        text = replace(runs, in: text, with: " ")
        text = replace(blankLines, in: text, with: "\n")
        return trim(text)
    }

    private static let wordPattern = regex(#"[\p{L}\p{N}']+"#)

    /// The words of what was heard or said, lowercased, for telling the speaker's echo from you.
    public static func words(_ text: String) -> [String] {
        let lower = text.lowercased()
        let source = lower as NSString
        return wordPattern.matches(in: lower, range: NSRange(location: 0, length: source.length)).map { source.substring(with: $0.range) }
    }

    // MARK: JavaScript's string methods

    static func trim(_ text: String) -> String { replace(edges, in: text, with: "") }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    /// `String.prototype.split` with a pattern that has no groups.
    private static func split(_ text: String, at regex: NSRegularExpression) -> [String] {
        let source = text as NSString
        var pieces: [String] = []
        var start = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) where match.range.length > 0 {
            pieces.append(source.substring(with: NSRange(location: start, length: match.range.location - start)))
            start = match.range.location + match.range.length
        }
        pieces.append(source.substring(from: start))
        return pieces
    }

    private static func replace(_ regex: NSRegularExpression, in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: template)
    }

    /// A replacement worked out from each match's groups (unmatched ones are empty).
    private static func replace(_ regex: NSRegularExpression, in text: String, _ make: ([String]) -> String) -> String {
        let source = text as NSString
        var result = ""
        var start = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: start, length: match.range.location - start))
            let groups = (0..<match.numberOfRanges).map { index in
                match.range(at: index).location == NSNotFound ? "" : source.substring(with: match.range(at: index))
            }
            result += make(groups)
            start = match.range.location + match.range.length
        }
        return result + source.substring(from: start)
    }

    /// A–Z to a–z only (as the web's case-insensitive ABBREVIATIONS reads letters).
    private static func asciiLowercased(_ text: String) -> String {
        String(String.UnicodeScalarView(text.unicodeScalars.map { (65...90).contains($0.value) ? Unicode.Scalar($0.value + 32)! : $0 }))
    }
}

/// Cuts a reply into sentences while it streams (`sentenceStream`): `take` returns the sentences complete so far that
/// haven't been taken (a sentence is complete once text follows it), `rest` what's left once the reply has ended.
public struct SentenceStream: Sendable {
    private var spoken = 0
    private var last = ""

    public init() {}

    private static func split(_ text: String) -> [String] { VoiceText.sentences(VoiceText.speakable(text)) }

    public mutating func take(_ text: String) -> [String] {
        last = text
        let all = Self.split(text)
        // The last sentence may still be growing.
        let complete = Array(all.dropLast())
        let fresh = complete.count > spoken ? Array(complete[spoken...]) : []
        spoken = complete.count
        return fresh
    }

    public mutating func rest(_ text: String? = nil) -> [String] {
        let all = Self.split(text ?? last)
        let fresh = all.count > spoken ? Array(all[spoken...]) : []
        spoken += fresh.count
        return fresh
    }
}
