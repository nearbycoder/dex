// What the port needs of Python's strings and `re` module, with Python's meaning. Python's `\w`, `\d`, `\s` and `\b`
// are Unicode-aware and JavaScript's are not, so patterns are written with the classes below instead; `$` also
// matches before a final newline in Python (`end` here), and `.` excludes only "\n" (written `[^\n]`).

/** Python's `\w` as the body of a character class (exactly `str.isalnum()` or "_"). */
export const W = "\\p{L}\\p{N}_"
/** Python's `\d`: decimal digits of any script. */
export const D = "\\p{Nd}"
/** Python's `\s` (and `str.isspace()`) as the body of a character class. */
export const S = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
export const w = `[${W}]`
export const d = `\\p{Nd}`
export const s = `[${S}]`
/** Python's `\b`. */
export const b = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`
/** Python's `$` without MULTILINE. */
export const end = "(?=\\n?(?![\\s\\S]))"

/** One match, read the way Python's `re.Match` is. */
export class Match {
  readonly string: string
  private readonly m: RegExpExecArray

  constructor(m: RegExpExecArray, string: string) {
    this.m = m
    this.string = string
  }

  group(key: number | string = 0): string | undefined {
    return typeof key === "number" ? this.m[key] : this.m.groups?.[key]
  }

  /** The text of group 0. */
  get text(): string {
    return this.m[0]
  }

  groups(): (string | undefined)[] {
    return this.m.slice(1)
  }

  start(key: number | string = 0): number {
    if (key === 0) return this.m.index
    const span = typeof key === "number" ? this.m.indices?.[key] : this.m.indices?.groups?.[key]
    return span ? span[0] : -1
  }

  end(key: number | string = 0): number {
    if (key === 0) return this.m.index + this.m[0].length
    const span = typeof key === "number" ? this.m.indices?.[key] : this.m.indices?.groups?.[key]
    return span ? span[1] : -1
  }
}

/** A compiled pattern with Python's `sub`, `search`, `match`, `fullmatch`, `finditer`, `findall` and `split`.
 * `indices` is needed only by callers that ask for the start or end of a group. */
export class Pattern {
  private _all?: RegExp
  private _first?: RegExp
  private _sticky?: RegExp
  private whole?: RegExp
  private _allInUse = false
  readonly source: string
  readonly flags: string

  constructor(source: string, flags = "", indices = false) {
    this.source = source
    this.flags = "u" + flags + (indices ? "d" : "")
  }

  private get all(): RegExp {
    return (this._all ??= new RegExp(this.source, this.flags + "g"))
  }

  private acquireAll(): readonly [RegExp, boolean] {
    if (!this._allInUse) {
      this._allInUse = true
      const rx = this.all
      rx.lastIndex = 0
      return [rx, true]
    }
    return [new RegExp(this.source, this.flags + "g"), false]
  }

  private get first(): RegExp {
    return (this._first ??= new RegExp(this.source, this.flags))
  }

  private get sticky(): RegExp {
    return (this._sticky ??= new RegExp(this.source, this.flags + "y"))
  }

  *finditer(text: string): Generator<Match> {
    const [rx, owned] = this.acquireAll()
    try {
      let m: RegExpExecArray | null
      while ((m = rx.exec(text)) !== null) {
        if (m[0].length === 0) {
          if (rx.lastIndex >= text.length) break
          const cp = text.codePointAt(rx.lastIndex)
          rx.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
        }
        yield new Match(m, text)
      }
    } finally {
      if (owned) this._allInUse = false
    }
  }

  sub(text: string, repl: string | ((m: Match) => string)): string {
    if (typeof repl === "string") {
      // Literal replacement (Python's plain string sub has no JS `$` expansion).
      const safe = repl.includes("$") ? repl.replaceAll("$", "$$$$") : repl
      const [rx, owned] = this.acquireAll()
      try {
        return text.replace(rx, safe)
      } finally {
        if (owned) this._allInUse = false
      }
    }
    const [rx, owned] = this.acquireAll()
    try {
      let m = rx.exec(text)
      if (m === null) return text
      let out = ""
      let last = 0
      do {
        out += text.slice(last, m.index) + repl(new Match(m, text))
        last = m.index + m[0].length
        if (m[0].length === 0) {
          if (rx.lastIndex >= text.length) break
          const cp = text.codePointAt(rx.lastIndex)
          rx.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
        }
        m = rx.exec(text)
      } while (m !== null)
      return out + text.slice(last)
    } finally {
      if (owned) this._allInUse = false
    }
  }

  search(text: string): Match | null {
    const m = this.first.exec(text)
    return m ? new Match(m, text) : null
  }

  /** Fast boolean test without allocating a Match wrapper. */
  test(text: string): boolean {
    return this.first.test(text)
  }

  /** Python's `match`: anchored at the start of ``text``. */
  match(text: string): Match | null {
    return this.matchAt(text, 0)
  }

  /** Anchored match starting at ``index`` in ``text``, avoiding a slice allocation. */
  matchAt(text: string, index: number): Match | null {
    const sticky = this.sticky
    sticky.lastIndex = index
    const m = sticky.exec(text)
    return m ? new Match(m, text) : null
  }

  fullmatch(text: string): Match | null {
    this.whole ??= new RegExp(`^(?:${this.source})(?![\\s\\S])`, this.flags)
    const m = this.whole.exec(text)
    return m ? new Match(m, text) : null
  }

  /** Python's `findall`: the whole matches, the only group, or every group. */
  findall(text: string): string[] {
    const [rx, owned] = this.acquireAll()
    const out: string[] = []
    try {
      let m: RegExpExecArray | null
      while ((m = rx.exec(text)) !== null) {
        out.push(m.length === 2 ? (m[1] ?? "") : m[0])
        if (m[0].length === 0) {
          if (rx.lastIndex >= text.length) break
          const cp = text.codePointAt(rx.lastIndex)
          rx.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
        }
      }
      return out
    } finally {
      if (owned) this._allInUse = false
    }
  }

  findallGroups(text: string): (string | undefined)[][] {
    const [rx, owned] = this.acquireAll()
    const out: (string | undefined)[][] = []
    try {
      let m: RegExpExecArray | null
      while ((m = rx.exec(text)) !== null) {
        out.push(m.slice(1))
        if (m[0].length === 0) {
          if (rx.lastIndex >= text.length) break
          const cp = text.codePointAt(rx.lastIndex)
          rx.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
        }
      }
      return out
    } finally {
      if (owned) this._allInUse = false
    }
  }

  split(text: string): string[] {
    const [rx, owned] = this.acquireAll()
    const out: string[] = []
    let last = 0
    try {
      let m: RegExpExecArray | null
      while ((m = rx.exec(text)) !== null) {
        out.push(text.slice(last, m.index))
        for (let k = 1; k < m.length; k++) out.push(m[k] ?? "")
        last = m.index + m[0].length
        if (m[0].length === 0) {
          if (rx.lastIndex >= text.length) break
          const cp = text.codePointAt(rx.lastIndex)
          rx.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
        }
      }
      out.push(text.slice(last))
      return out
    } finally {
      if (owned) this._allInUse = false
    }
  }
}

const cache = new Map<string, Pattern>()

/** A pattern compiled once (Python's `re` caches them too). */
export function re(source: string, flags = "", indices = false): Pattern {
  const key = flags + (indices ? "d" : "") + "\u0000" + source
  let pattern = cache.get(key)
  if (!pattern) {
    pattern = new Pattern(source, flags, indices)
    cache.set(key, pattern)
  }
  return pattern
}

/** ``text`` with the regular-expression characters escaped, for a JavaScript pattern. */
export const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")

// ---- characters -------------------------------------------------------------

/** The characters of ``text`` (code points, as Python counts them). */
export const chars = (text: string): string[] => Array.from(text)

/** The character that starts at ``index`` (a whole surrogate pair). */
export function charAt(text: string, index: number): string {
  const code = text.codePointAt(index)
  return code === undefined ? "" : String.fromCodePoint(code)
}

/** The character that ends at ``index``. */
export function charBefore(text: string, index: number): string {
  if (index <= 0) return ""
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index)
  }
  return text.slice(index - 1, index)
}

/** The index ``count`` characters before ``index``, or 0. */
export function back(text: string, index: number, count: number): number {
  let position = index
  for (let k = 0; k < count && position > 0; k++) position -= charBefore(text, position).length
  return position
}

const SPACE = new RegExp(`^[${S}]+$`, "u")
const ALPHA = /^\p{L}+$/u
const DECIMAL = /^\p{Nd}+$/u
const ALNUM = /^[\p{L}\p{N}]+$/u
const UPPER = /\p{Uppercase}/u
const LOWER = /\p{Lowercase}/u
const TITLE = /\p{Lt}/u
// Characters that are digits to `str.isdigit()` but not decimal: superscripts, circled digits and the like
// (Unicode 15, the version of Python's unicodedata the original was checked with).
const OTHER_DIGITS =
  /^[²³¹፩-፱᧚⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}]$/u

const isAsciiSpaceCode = (c: number) => c === 32 || (c >= 9 && c <= 13) || (c >= 28 && c <= 31)

export function isascii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false
  return true
}

export function isspace(text: string): boolean {
  if (!text) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0x7f) return SPACE.test(text)
    if (!isAsciiSpaceCode(c)) return false
  }
  return true
}

export function isalpha(text: string): boolean {
  if (!text) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0x7f) return ALPHA.test(text)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false
  }
  return true
}

export function isalnum(text: string): boolean {
  if (!text) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0x7f) return ALNUM.test(text)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57))) return false
  }
  return true
}

export function isdigit(text: string): boolean {
  if (!text) return false
  let hasNonAscii = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0x7f) {
      hasNonAscii = true
      break
    }
    if (c < 48 || c > 57) return false
  }
  if (!hasNonAscii) return true
  for (const c of text) if (!DECIMAL.test(c) && !OTHER_DIGITS.test(c)) return false
  return true
}

/** `str.isupper()`: at least one cased character and no lower-case or title-case one. */
export function isupper(text: string): boolean {
  let cased = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c <= 0x7f) {
      if (c >= 97 && c <= 122) return false
      if (c >= 65 && c <= 90) cased = true
    } else {
      const ch = charAt(text, i)
      if (ch.length === 2) i++
      if (LOWER.test(ch) || TITLE.test(ch)) return false
      if (UPPER.test(ch)) cased = true
    }
  }
  return cased
}

/** `str.islower()`. */
export function islower(text: string): boolean {
  let cased = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c <= 0x7f) {
      if (c >= 65 && c <= 90) return false
      if (c >= 97 && c <= 122) cased = true
    } else {
      const ch = charAt(text, i)
      if (ch.length === 2) i++
      if (UPPER.test(ch) || TITLE.test(ch)) return false
      if (LOWER.test(ch)) cased = true
    }
  }
  return cased
}

const SPACE_CHAR = new RegExp(`[${S}]`, "u")

/** `str.strip()`, `lstrip()`, `rstrip()`: Python's whitespace, or the characters given (all of them, like Python's
 * whitespace, single UTF-16 units). */
export function strip(text: string, set?: string): string {
  let start = 0
  let endIndex = text.length
  if (set === undefined) {
    while (start < endIndex) {
      const c = text.charCodeAt(start)
      if (c <= 0x7f ? isAsciiSpaceCode(c) : SPACE_CHAR.test(text[start]!)) start++
      else break
    }
    while (endIndex > start) {
      const c = text.charCodeAt(endIndex - 1)
      if (c <= 0x7f ? isAsciiSpaceCode(c) : SPACE_CHAR.test(text[endIndex - 1]!)) endIndex--
      else break
    }
  } else {
    while (start < endIndex && set.includes(text[start]!)) start++
    while (endIndex > start && set.includes(text[endIndex - 1]!)) endIndex--
  }
  return start === 0 && endIndex === text.length ? text : text.slice(start, endIndex)
}

export function lstrip(text: string, set?: string): string {
  let k = 0
  if (set === undefined) {
    while (k < text.length) {
      const c = text.charCodeAt(k)
      if (c <= 0x7f ? isAsciiSpaceCode(c) : SPACE_CHAR.test(text[k]!)) k++
      else break
    }
  } else {
    while (k < text.length && set.includes(text[k]!)) k++
  }
  return k === 0 ? text : text.slice(k)
}

export function rstrip(text: string, set?: string): string {
  let k = text.length
  if (set === undefined) {
    while (k > 0) {
      const c = text.charCodeAt(k - 1)
      if (c <= 0x7f ? isAsciiSpaceCode(c) : SPACE_CHAR.test(text[k - 1]!)) k--
      else break
    }
  } else {
    while (k > 0 && set.includes(text[k - 1]!)) k--
  }
  return k === text.length ? text : text.slice(0, k)
}

const SPACES = new RegExp(`[${S}]+`, "u")

/** `str.split()` with no separator. */
export function split(text: string): string[] {
  return text.split(SPACES).filter((part) => part !== "")
}

/** `str.splitlines()`. */
export function splitlines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines
}

/** The value of a decimal digit of any script (`int(char)`). */
function digitValue(char: string): number {
  let code = char.codePointAt(0)!
  let start = code
  while (start > 0 && DECIMAL.test(String.fromCodePoint(start - 1))) start--
  code -= start
  return code % 10
}

const isAsciiDigits = (text: string): boolean => {
  if (!text) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** `int(text)` for a run of decimal digits of any script, as a bigint. Raises Python's ValueError on anything else. */
export function bigint(text: string): bigint {
  if (isAsciiDigits(text)) return BigInt(text)
  if (!text || !DECIMAL.test(text)) throw new ValueError(`invalid literal for int() with base 10: ${JSON.stringify(text)}`)
  return BigInt(chars(text).map(digitValue).join(""))
}

/** `int(text)` as a number (for runs short enough to be exact). */
export function int(text: string): number {
  if (text.length <= 15 && isAsciiDigits(text)) return Number(text)
  return Number(bigint(text))
}

// Characters Unicode assigned after 15.0, the version of Python's unicodedata (Python 3.12, and the Pyodide 0.26 of
// tiny-voca's web demo): to Python they are unassigned, with no class or case. Emoji keep their place: the patterns
// name those ranges. Generated with Python 3.12 against Node 22 (Unicode 17).
const NEWER = /[\u088f\u0897\u0c5c\u0cdc\u1acf-\u1add\u1ae0-\u1aeb\u1b4e-\u1b4f\u1b7f\u1c89-\u1c8a\u20c1\u2427-\u2429\u2ffc-\u2fff\u31e4-\u31e5\u31ef\ua7cb-\ua7cf\ua7d2\ua7d4\ua7da-\ua7dc\ua7f1\ufbc3-\ufbd2\ufd90-\ufd91\ufdc8-\ufdce\u{105c0}-\u{105f3}\u{10940}-\u{10959}\u{10d40}-\u{10d65}\u{10d69}-\u{10d85}\u{10d8e}-\u{10d8f}\u{10ec2}-\u{10ec7}\u{10ed0}-\u{10ed8}\u{10efa}-\u{10efc}\u{11380}-\u{11389}\u{1138b}\u{1138e}\u{11390}-\u{113b5}\u{113b7}-\u{113c0}\u{113c2}\u{113c5}\u{113c7}-\u{113ca}\u{113cc}-\u{113d5}\u{113d7}-\u{113d8}\u{113e1}-\u{113e2}\u{116d0}-\u{116e3}\u{11b60}-\u{11b67}\u{11bc0}-\u{11be1}\u{11bf0}-\u{11bf9}\u{11db0}-\u{11ddb}\u{11de0}-\u{11de9}\u{11f5a}\u{13460}-\u{143fa}\u{16100}-\u{16139}\u{16d40}-\u{16d79}\u{16ea0}-\u{16eb8}\u{16ebb}-\u{16ed3}\u{16ff2}-\u{16ff6}\u{187f8}-\u{187ff}\u{18cff}\u{18d09}-\u{18d1e}\u{18d80}-\u{18df2}\u{1cc00}-\u{1ccfc}\u{1cd00}-\u{1ceb3}\u{1ceba}-\u{1ced0}\u{1cee0}-\u{1cef0}\u{1e5d0}-\u{1e5fa}\u{1e5ff}\u{1e6c0}-\u{1e6de}\u{1e6e0}-\u{1e6f5}\u{1e6fe}-\u{1e6ff}\u{1fbcb}-\u{1fbef}\u{1fbfa}\u{2b73a}-\u{2b73f}\u{2cea2}-\u{2cead}\u{2ebf0}-\u{2ee5d}\u{323b0}-\u{33479}]/gu

/** ``text`` with the characters Python's Unicode doesn't know yet replaced by one no version knows (U+0378). */
export const asPythonSees = (text: string) => (isascii(text) ? text : text.replace(NEWER, "\u0378"))

/** Python's ValueError, for the cases where the original raises one. */
export class ValueError extends Error {
  override name = "ValueError"
}

/** Compare strings by code point, as Python sorts them. */
export function compare(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const p = a.codePointAt(i)!
    const q = b.codePointAt(j)!
    if (p !== q) return p - q
    i += p > 0xffff ? 2 : 1
    j += q > 0xffff ? 2 : 1
  }
  return (a.length - i) - (b.length - j)
}
