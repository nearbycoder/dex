// Text -> the words to say and the punctuation marks between them (dizione's normalize.py): numbers, ordinals,
// money, dates, times, telephone numbers, units, abbreviations, initialisms, symbols, chat spellings, versions,
// codes, web addresses and file names are written out by rule; emoticons and emoji are dropped. The patterns are
// Python's, rewritten with the classes in py.ts so they mean the same thing.

import { convert, fromText, isArpabet } from "./convert.ts"
import {
  back, b, bigint, charAt, charBefore, chars, D, d, end, escapeRegExp, int, isalnum, isalpha, isascii, isdigit,
  islower, isspace, isupper, lstrip, type Match, re, rstrip, s, S, split, strip, ValueError, W, w
} from "./py.ts"
import { PUNCTUATION, type Phones } from "./symbols.ts"
import { mapping, rows } from "./tables.ts"

/** A word to say: letters and apostrophes in lower case, or letters to name, or phones given inline. */
export interface Word {
  readonly kind: "word"
  readonly text: string
  readonly attach: boolean
  readonly raw: string
  readonly spell: boolean
  readonly phones: Phones | null
}

export interface Punct {
  readonly kind: "punct"
  readonly mark: string
}

export type Token = Word | Punct

const word = (text: string, fields: Partial<Omit<Word, "kind" | "text">> = {}): Word =>
  ({ kind: "word", text, attach: false, raw: "", spell: false, phones: null, ...fields })

const punct = (mark: string): Punct => ({ kind: "punct", mark })

// Private-use characters that carry decisions through the rewriting of the text: letters to be named sit between
// SPELL and END, an inline pronunciation is one character (its number added to INLINE_BASE) between two INLINE.
const SPELL = "\ue000"
const END = "\ue001"
const INLINE = "\ue003"
const INLINE_BASE = 0xe100
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ")
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ")
const SCALES = ["thousand", "million", "billion", "trillion", "quadrillion", "quintillion"]
const ORDINAL: Readonly<Record<string, string>> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" }
const MONTHS = "January February March April May June July August September October November December".split(" ")
const MONTH_NUMBER = new Map(MONTHS.map((name, index) => [name.toLowerCase().slice(0, 3), index + 1]))
const MONTH_PATTERN = MONTHS.join("|") + "|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec"
const DAY_NAMES: Readonly<Record<string, string>> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }
const DAY_PATTERN = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Thurs|Thur|Tues|Mon|Tue|Wed|Thu|Fri|Sat|Sun"
type Currency = readonly [one: string, many: string, cent: string, cents: string]
const DOLLAR: Currency = ["dollar", "dollars", "cent", "cents"]
const POUND: Currency = ["pound", "pounds", "penny", "pence"]
const EURO: Currency = ["euro", "euros", "cent", "cents"]
const YEN: Currency = ["yen", "yen", "", ""]
const RUPEE: Currency = ["rupee", "rupees", "paisa", "paise"]
const CURRENCY: Readonly<Record<string, Currency>> = {
  "$": DOLLAR, "£": POUND, "€": EURO, "¥": YEN, "₹": RUPEE, USD: DOLLAR, EUR: EURO, GBP: POUND, JPY: YEN, INR: RUPEE,
  CHF: ["Swiss franc", "Swiss francs", "centime", "centimes"], CAD: ["Canadian dollar", "Canadian dollars", "cent", "cents"],
  AUD: ["Australian dollar", "Australian dollars", "cent", "cents"], CNY: ["yuan", "yuan", "", ""]
}
const CURRENCY_CODES = "USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY"
const SCALE_LETTER: Readonly<Record<string, string>> = { k: "thousand", m: "million", b: "billion", bn: "billion", t: "trillion" }
const FRACTION: Readonly<Record<string, readonly [string, string]>> = { 2: ["half", "halves"], 4: ["quarter", "quarters"] }
const SYMBOL_WORDS: Readonly<Record<string, string>> = {
  "&": "and", "@": "at", "+": "plus", "=": "equals", "%": "percent", "×": "times", "÷": "divided by",
  "±": "plus or minus", "©": "copyright", "§": "section", "°": "degrees",
  "≥": "greater than or equal to", "≤": "less than or equal to", "≠": "not equal to", "≈": "approximately",
  "∞": "infinity", "√": "square root of", "π": "pi"
}
const COMPARISONS: Readonly<Record<string, string>> = { ">=": "greater than or equal to", "<=": "less than or equal to", "!=": "not equal to" }
const INITIALISMS = new Set("US IT AI ID UN EU UK LA AD BC AM PM OS PE PA MA LED SAT RIP ER".split(" "))
const SOUNDS = new Set("sh shh ss zz hm hmm mm tsk psst pfft hmph psh pssh".split(" "))
const IS = "\ue006"
const COMPARED = re(String.raw`(?<gap>[ \t]?)(?<sign>>=|<=|!=|[<>≥≤≠])\k<gap>`, "", true)
const VALUE_BEFORE = re(String.raw`(?:(?<![${W}.,])${d}[${D}.,]*%?|(?<![${W}'’.\-])[A-Za-z]|[)\]])${end}`)
const VALUE_AFTER = re(String.raw`(?:[\-+]?[$£€¥₹]?${d}[${D}.,]*%?(?!${w})|\.${d}|[A-Za-z](?![${W}'’])|[(\[])`)
const CLAUSE_OPENERS = new Set(("if elif while when whenever where whether that because since as and or but so then think thinks "
  + "thought know knows say says said suppose assume means implies hence thus therefore although though "
  + "unless until once else also clearly obviously indeed here now again first next finally similarly "
  + "otherwise however moreover").split(" "))
const SIGN = "[<>+*/^≤≥≠≈×÷±]"
const SPACED_SIGN = " [<>+*≤≥≠≈×÷±] "
const NO_PHRASE = String.raw`(?![${W}'’\-]|${s}+(?!(?:and|or|then|if|when|where|while|for|is|are|was|but|so|in|to)${b})[A-Za-z])`
const LETTER_PLACES = [
  String.raw`(?<![${W}'’.\-])(?<letter>[Aakur])(?=${IS}?${s}?[<>!=]?=)`,
  String.raw`[<>!=]?=${s}?(?<letter>[Aakur])${NO_PHRASE}`,
  String.raw`(?<![${W}'’.\-])(?<letter>[Aakur])(?=${IS}?${SIGN}(?:[${W}($]|\.${d}))`,
  String.raw`(?<=[${W})${IS}]${SIGN})(?<![Ww]\/)(?<letter>[Aakur])(?![${W}'’\-])`,
  String.raw`(?<![${W}'’.\-])(?<letter>[Aakur])(?=${IS}?${SPACED_SIGN}(?:[A-Za-z]|${d}[${D}.,]*)(?![${W}'’]))`,
  String.raw`(?<![${W}'’.])(?:[A-Za-z]|${d}[${D}.,]*)${IS}?${SPACED_SIGN}(?<letter>[Aakur])${NO_PHRASE}`,
  String.raw`(?<=\()(?<letter>[Aakur])(?=\)|, )`,
  String.raw`(?<=, )(?<letter>[Aakur])(?=\))`,
  String.raw`(?:(?<=${s})|^)(?<letter>[akur])(?=\)${s})`
].map((source) => re(source, "", true))
const ANGLES = re(String.raw`(?<![${W})${END}${IS}])<[A-Za-z0-9/!?][^<>(){}+*;|\n]*>`
  + String.raw`|(?<=[${W}${END}${IS}])<[^<>(){}+*;|\n]{1,80}>(?![${W}$])`
  + String.raw`|<\/?[A-Za-z][${W}\-]+\/?>`)
const ANGLE_MARK = "\ue005"

/** ``text`` with the angle brackets that enclose something replaced by a mark, one for one, the inner ones first. */
function withoutAngles(text: string): string {
  while (text.includes("<") && text.includes(">")) {
    const marked = ANGLES.sub(text, (m) => ANGLE_MARK + m.text.slice(1, -1) + ANGLE_MARK)
    if (marked === text) break
    text = marked
  }
  return text
}

const JOINED_COMPARISON = re(String.raw`(?<=[${W})${END}${IS}])[<>](?=[${W}(${SPELL}]|\.${d}| minus ${d})`)
const FIGURE_BEFORE = re(String.raw`(?<![${W}.,])${d}[${D}.,]*%?${end}`)
const FIGURE_AFTER = re(String.raw`(?:${d}[${D}.,]*%?(?!${w})|\.${d}| minus ${d})`)
const LETTER_BEFORE = re(String.raw`(?:(?<![${W}'’.])[A-Za-z]|[)${END}])${end}`)
const LETTER_AFTER = re(String.raw`(?:[A-Za-z](?![${W}'’])|[(${SPELL}])`)
const SENTENCE_STARTERS = new Set("the he she it i we they this that there but and in on at a an if when what why how who my our you then so now after before however".split(" "))
const YEAR_CONTEXT = new Set("in since by from until till before after during around circa of year early late mid summer winter spring fall autumn class".split(" "))
const CARDINAL_AFTER = new Set("war chapter part book volume act scene section phase type class level stage title article appendix world".split(" "))
const LABELLED = new Set("plan vitamin grade type option class section part team group exhibit appendix point model series hepatitis level".split(" "))
const ROMAN: Readonly<Record<string, number>> = { II: 2, III: 3, IV: 4, VI: 6, VII: 7, VIII: 8, IX: 9, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVIII: 18, XX: 20 }
const LEADING_APOSTROPHE = new Set(["'em", "'tis", "'twas", "'til", "'cause", "'bout", "'round", "'n"])
const EMOJI = re("[\\u{1F000}-\\u{1FAFF}\\u2600-\\u27bf\\u{1F1E6}-\\u{1F1FF}\\u2190-\\u21ff\\u2b00-\\u2bff\\ufe0f\\u200d\\u20e3]+")
const EMOTICON = re(
  String.raw`(?<![A-Za-z0-9])(?:[:;=]['^\-]?[DPpOo3|/\\*\]\[}{><]+|[)(\]\[][\-^']?[:;=]|<3+|<\/3|\^_?\^|-_-|[oO]_[oO]|>_<|T_T|\\o\/|:'[()])(?![A-Za-z0-9])`
  + String.raw`|[:;]['^\-]?[)(]+`
  + String.raw`|(?<![A-Za-z0-9)])=['^\-]?[)(]+|=['^\-]?[)(]+(?![A-Za-z0-9(.$\-])`
  + String.raw`|(?<=[A-Za-z]{2})<3+(?![.,]?${d})`)

const PHONE_WORDS = new Set("call dial ring phone telephone tel mobile cell fax hotline text sms whatsapp".split(" "))
const PHONE_LINKS = new Set("to on at or us me him her them back".split(" "))
const PIN_WORDS = new Set("code pin extension ext passcode password zip postcode cvv cvc otp".split(" "))
const STRONG_WORDS = new Set("number id reference ref serial account tracking booking confirmation".split(" "))
const WEAK_WORDS = new Set(("order ticket invoice case claim policy receipt transaction parcel shipment container payment "
  + "reservation membership customer batch lot item job issue bug request").split(" "))
const LINK_WORDS = new Set("is was are were ends ending in with starts starting begins beginning".split(" "))
const NOT_COUNTED = new Set(("is was has does goes ships arrives departs leaves shows needs blocks remains includes contains "
  + "says reads starts ends closes opens runs takes comes this his its us as yes plus minus less").split(" "))
const NUMBERED = new Set(("ref reference serial account order invoice tracking part model phone tel fax id room flight case "
  + "ticket policy licence license booking customer vat tax reg registration").split(" "))
const DATE_BEFORE = new Set(("on dated due until till by since from before after for shipped delivered arriving arrives arrive "
  + "arrived expires expired ends ending starts starting begins beginning monday tuesday wednesday "
  + "thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun").split(" "))
const CLASSIC_FRACTIONS = new Set([2, 3, 4, 5, 6, 8, 10, 16, 32, 64, 100].map(BigInt))
const RATIO_WORDS = new Set("ratio ratios scale odds aspect mix split proportion".split(" "))
const DURATION_WORDS = new Set("lasted took duration runtime recording video clip track lap pace length long".split(" "))
const CLOCK_WORDS = new Set(("window slot open opens opening hours shift session served service available booked appointment "
  + "delivery arrive arrives arriving").split(" "))
const CAPITAL_WORDS = new Set("IN ON AT TO OF BY OR IS AS IF NO SO WE HE MY ME DO GO UP AN AM PM BE IT US THE AND FOR BUT NOT ALL".split(" "))
const SHORT_WORDS = new Set("my to in on of go up no do me we us it is at by be so or an as if he hi ok".split(" "))
const ZONES = "ET|CT|MT|PT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|GMT|UTC|BST|CET|CEST|IST|AEST|AEDT|JST"
const SIZES = "XXXL|XXL|XXS|XL|XS|S|M|L"
const LENGTHS = "mm|cm|km|m|ft|in|inch|inches|feet|foot|metres?|meters?|yards?|yd|px|pixels?"
const VERSIONED = ("version|ver|release|firmware|patch|kernel|build|python|node|nodejs|ios|ipados|macos|watchos|tvos|android|"
  + "chrome|firefox|safari|java|php|ruby|rust|swift|kotlin|golang|django|rails|react|angular|vue|docker|"
  + "kubernetes|ubuntu|debian|fedora|windows|linux|postgres|postgresql|mysql|redis|numpy|pytorch|tensorflow|cuda|"
  + "xcode|gcc|clang|unity|minecraft|typescript|bluetooth|usb|hdmi|opengl|vulkan|directx|"
  + "upgrade[ds]?|update[ds]?|downgrade[ds]?")
const SEPARATORS: Readonly<Record<string, string>> = { ".": "dot", "/": "slash", "@": "at", "-": "dash", "_": "underscore", ":": "colon", "=": "equals", "&": "and", "+": "plus" }
const HALF_DAY = String.raw`(?:${s}?([AaPp])\.[Mm]\.?|${s}?([AaPp])[Mm]${b})`
const AMOUNT = String.raw`(?<whole>${d}{1,3}(?:,${d}{3})+|${d}+)(?:\.(?<fraction>${d}+))?`
const MONEY = re(String.raw`(?:(?<![${W}.])(?<minus>-)${s}?)?(?<symbol>[$£€¥₹]|(?<![A-Za-z])(?:${CURRENCY_CODES})(?![A-Za-z]))${s}?`
  + String.raw`(?<inner>-)?${AMOUNT}(?:${s}?(?<scale>thousand|million|billion|trillion|bn|[kKmMbB])(?![A-Za-z]))?`)
const SIGN_AFTER = String.raw`[$£€¥₹](?![${W}$£€¥₹])|(?:${CURRENCY_CODES})(?![A-Za-z])`
const MONEY_AFTER = re(String.raw`(?:(?<![${W}.])(?<minus>-)${s}?)?(?<![${W}.,^])`
  + String.raw`(?<whole>${d}{1,3}(?:,${d}{3})+|[1-9]${d}{0,2}(?: ${d}{3})+|${d}+)(?:\.(?<fraction>${d}+))?`
  + String.raw`${s}?(?<symbol>${SIGN_AFTER})`)
const RANGE_BEFORE_SIGN = re(String.raw`(?<![${W}.,\-])(${d}[${D},]*(?:\.${d}+)?)-(?=${d}[${D},]*(?:\.${d}+)?${s}?(?:${SIGN_AFTER}))`)
const CONTINENTAL = re(String.raw`(?<![${W}.,])([1-9]${d}{0,2}(?:\.${d}{3})+),(${d}{1,2})(?!${d}|[.,]${d})`)
const COMMA_AFTER_SIGN = re(String.raw`((?:[$£€¥₹]|(?<![A-Za-z])(?:${CURRENCY_CODES}))${s}?-?${d}+),(${d}{1,2})(?!${d}|[.,]${d})`)
const COMMA_BEFORE_SIGN = re(String.raw`(?<![${W}.,])(${d}+),(${d}{1,2})(?=${s}?(?:%|${SIGN_AFTER}))`)
const FORMULA_SIGN = "\ue004"
const FORMULA_END = re(String.raw`(?<![${W}$])(?<!${d}${s})\$(?:(?=[^${S}${D}$.,;:!?)])[^$\n]{0,80}`
  + String.raw`|(?=${d})[^$\n]{0,80}[=^_\\{}+*/<>][^$\n]{0,80}`
  + String.raw`|(?=${s})[^$\n]{0,80}[=^_\\{}+*<>][^$\n]{0,80})${d}${s}?\$(?![${W}$])`)
const VULGAR = re(String.raw`(?<![${D}.,/])(?:(${d}+)${s}?)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])`)
const ADDRESS = re(
  String.raw`(?<url>(?:https?:\/\/|www\.)[^${S}<>"']+)`
  + String.raw`|(?<mail>[${W}.+\-]+@[${W}\-]+(?:\.[${W}\-]+)+)`
  + String.raw`|(?<file>(?<![${W}@.\/\-])(?<folder>\/?(?:[${W}~\-]+\/)+)?(?<stem>[${W}\-]+(?:\.[${W}\-]+)*)\.(?<ending>[A-Za-z][A-Za-z0-9]{0,9})`
  + String.raw`(?![${W}\-])(?<path>\/[^${S}<>"']*)?)`)
const DAY_RANGE = re(String.raw`${b}(${DAY_PATTERN}|${MONTH_PATTERN})${b}(\.?)${s}?[\-–]${s}?(${DAY_PATTERN}|${MONTH_PATTERN})${b}(\.?)`)
const RATIO = re(String.raw`(?<![${D}:.,])(${d}{1,3}):(${d}{1,3}(?:,${d}{3})+|${d}+)(?![${D}:]|[.,]${d})`)
const CODE = re(String.raw`(?<![${W}.,\/\-])(#)?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)(?![${W}\-]|[.,]${d})`)
const SLASHED = re(String.raw`(?<![${W}.,\/\-])(${d}+(?:\/${d}+){2,})(?![${W}\/]|[.,]${d})`)
// Python's conditional group "(?(lead)...)" as two branches: with the two capitals first, as the optional group tries.
const GROUP_CORE = String.raw`[A-Z0-9]*${d}[A-Z0-9]*(?: [A-Z0-9]*${d}[A-Z0-9]*)+`
const GROUPED = re(
  String.raw`(?<![${W}.,:\/#+\-])(?<plus>\+)?(?:(?<lead>[A-Z]{2}) (?<core>${GROUP_CORE})(?: (?<trail>[A-Z]{2})(?![${W}]))?|(?<bare>${GROUP_CORE}))`
  + String.raw`(?![${W}]|[.,:\/\-]${d}|${s}?[%°])`)
const GLUED = re(String.raw`(?<![${W}'.])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*${d})[A-Za-z0-9]+(?![${W}']|\.${d})`)

const ACCENT_DECIDES: Readonly<Record<string, string>> = {
  "résumé": "R EH1 Z AH0 M EY2", "resumé": "R EH1 Z AH0 M EY2", "exposé": "EH2 K S P OW0 Z EY1",
  "rosé": "R OW0 Z EY1", "pâté": "P AA0 T EY1", "maté": "M AA1 T EY2", "saké": "S AA1 K EY2", "lamé": "L AA0 M EY1"
}
const LETTER_FORMS: Readonly<Record<string, string>> = { "ß": "ss", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe", "ø": "o", "Ø": "O", "đ": "d", "ł": "l", "Ł": "L" }

const caseless = new Map<string, ReturnType<typeof re>>()

/** A pattern with Python's IGNORECASE: JavaScript's "i", plus the letters Python also takes for "i" (ı, İ). */
function ignorecase(source: string, indices = false) {
  const key = (indices ? "d" : "") + source
  let pattern = caseless.get(key)
  if (!pattern) {
    pattern = re(withDotlessI(source), "i", indices)
    caseless.set(key, pattern)
  }
  return pattern
}

function withDotlessI(source: string) {
  let out = ""
  for (let k = 0; k < source.length; k++) {
    const c = source[k]!
    if (c === "\\") {
      const next = source[k + 1] ?? ""
      let stop = k + 2
      if ("pPu".includes(next) && source[k + 2] === "{") stop = source.indexOf("}", k) + 1
      else if (next === "u") stop = k + 6
      else if (next === "x") stop = k + 4
      else if (next === "k" && source[k + 2] === "<") stop = source.indexOf(">", k) + 1
      out += source.slice(k, stop)
      k = stop - 1
    } else if (c === "[") {
      let close = k + 1
      while (close < source.length && source[close] !== "]") {
        close += source[close] === "\\" ? 2 : 1
      }
      const body = source.slice(k + 1, close)
      out += "[" + body + (/a-z|A-Z|[iI]/.test(body) ? "ıİ" : "") + "]"
      k = close
    } else if (c === "(" && source.startsWith("(?<", k) && /[A-Za-z]/.test(source[k + 3] ?? "")) {
      const close = source.indexOf(">", k)
      out += source.slice(k, close + 1)
      k = close
    } else if (c === "i" || c === "I") {
      out += "[iıİ]"
    } else {
      out += c
    }
  }
  return out
}

const PUNCT_NORM_MAP: Readonly<Record<string, string>> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "`": "'", "´": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"',
  "–": "—", "―": "—", "[": "(", "]": ")"
}
const PUNCT_NORM = /[‘’‚‛`´“”„‟«»–―[\]]/g
const ASCII_PUNCT_NORM = /[`[\]]/
const HAS_DIGIT = re(d)
const HAS_ASCII_DIGIT = /\d/
const HAS_COMPARISON = re("[<>≥≤≠]|!=")
const HAS_EMOTICON_CHAR = /[:;=^_<>\/]/
const HAS_MONEY_HINT = /[$£€¥₹]|(?:USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY)/
const HAS_HALF_DAY_HINT = /[AaPp]\.?[Mm]/
const HAS_MONTH_HINT = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/
const HAS_TIMES_HINT = /[xX×]/
const HAS_ORDINAL_HINT = /(?:st|nd|rd|th)/
const HAS_MATH_SIGN = /[=<>+*/^()≤≥≠≈×÷±]/
const PUNCTUATION_SET = new Set<string>(PUNCTUATION)
const COUNTED_IRREGULAR = new Set(["people", "men", "women", "children", "feet", "miles"])
const AMBIGUOUS_ABBR = new Set(["mar", "sun", "sat", "jan", "dec", "max", "min", "est", "no"])
const COUNTED_NOUN_RE = re(String.raw`(?:[^s]s|people|men|women|children|feet|miles)${end}`)
const MODEL_PREFIX_RE = re(String.raw`(?<![A-Za-z])([A-Z]{2,5}) ${end}`)
const ALNUM_RUN_RE = re(String.raw`[A-Za-z]+|${d}+`)
const DIGITS_LETTERS_RE = re(String.raw`${d}+[A-Za-z]+`)
const DIGITS_ORD_RE = re(String.raw`${d}+(?:s|st|nd|rd|th)`)
const ADDRESS_PIECES_RE = re(String.raw`[A-Za-z]+|${d}+|[^\n]`)
const ADDRESS_CAMEL_RE = re("[A-Z]?[a-z]+|[A-Z]+(?![a-z])")
const ALPHA_RUNS_ASCII = /[A-Za-z]{2,}/g
const asciiCaseInsensitive = (word: string) => {
  let out = ""
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!
    const lo = ch.toLowerCase()
    const hi = ch.toUpperCase()
    out += lo !== hi ? `[${hi}${lo}]` : escapeRegExp(ch)
  }
  return out
}
const EN_DASH_NUM = re(String.raw`(?<=${d})–(?=${d})`)
const INLINE_RE = re("([A-Za-z']+)?\\{([^{}]*)\\}")
const ELLIPSIS_RE = re("\\.{3,}")
const NUM_SPACED_MINUS = re(String.raw`(?<=${d})${s}-${s}(?=${d}[${D}.,]*${s}?=)`)
const NUM_MINUS = re(String.raw`(?<![${D}.,\/\-])(${d}[${D}.,]*)-(?=${d}[${D}.,]*=)`)
const DASH_RE = re(String.raw`-{2,}|${s}-${s}`)
const WITHOUT_RE = ignorecase(String.raw`${b}w\/o${b}`)
const WITH_RE = ignorecase(String.raw`${b}w\/(?=${s}|${end})`)
const NA_RE = ignorecase(String.raw`${b}n\/a${b}`)

const CENTS_RE = re(String.raw`(?<![${W}.])(${d}[${D},]*(?:\.${d}+)?)${s}?¢`)
const CLOCK_EXPR = String.raw`${d}{1,2}:[0-5]${d}(?:${s}?[AaPp]\.?[Mm]\.?)?|${b}${d}{1,2}${s}?[AaPp]\.?[Mm]\.?`
const CLOCK_ZONE_RE = re(String.raw`(${CLOCK_EXPR})${s}(${ZONES})${b}`)
const DOT_CLOCK_RE = re(String.raw`(?<![${D}.,:])(${d}{1,2})\.([0-5]${d})(?=${s}?[AaPp]\.?[Mm]${b})`)
const DOT_TIMES_RE = re(String.raw`(?<![${D}.,:])(${d}{1,2})\.(00|15|30|45)(${s}?(?:to|until|till|and|[\-—])${s}?)(${d}{1,2})\.(00|15|30|45)(?!${d}|\.${d})`)
const CLOCK_RANGE_RE = re(String.raw`(${CLOCK_EXPR})${s}?[\-—]${s}?(?=${d}{1,2}(?::[0-5]${d}|${s}?[AaPp]\.?[Mm]${b}))`)
const TIME_RE = re(String.raw`(?<![${D}:])(${d}{1,2}):([0-5]${d})(?::([0-5]${d}))?${HALF_DAY}?(?![${D}:])`)
const HALF_DAY_RE = re(String.raw`(?<![${D}.:,])(${d}{1,2})${HALF_DAY}(?![A-Za-z])`)

const SLASH_PAIR_RE = re(String.raw`(?<![${D}\/.])(${d}{1,2})\/(${d}{1,2})(?:\/(?:${d}{4}|${d}{2}))?(?![${D}\/])`)
const SLASH_DATED_RE = re(String.raw`(?<![${D}\/])${d}{1,2}\/${d}{1,2}\/(?:${d}{4}|${d}{2})(?![${D}\/])`)
const ISO_DASH_DATE_RE = re(String.raw`(?<![${D}\-])(${d}{4})-(${d}{1,2})-(${d}{1,2})(?![${D}\-])`)
const ISO_SLASH_DATE_RE = re(String.raw`(?<![${D}\/])(${d}{4})\/(${d}{1,2})\/(${d}{1,2})(?![${D}\/])`)
const DOT_DATE_RE = re(String.raw`(?<![${D}.])(${d}{1,2})\.(${d}{1,2})\.(${d}{4})(?!${d}|\.${d})`)
const SLASH_DATE_RE = re(String.raw`(?<![${D}\/])(${d}{1,2})\/(${d}{1,2})\/(${d}{4}|${d}{2})(?![${D}\/])`)
const MONTH_RANGE_RE = re(String.raw`${b}(${MONTH_PATTERN})\.?${s}+(${d}{1,2})(?:st|nd|rd|th)?${s}?[\-—]${s}?(${d}{1,2})(?:st|nd|rd|th)?(?:,?${s}+(${d}{4}))?(?![${D}:])`)
const RANGE_MONTH_RE = re(String.raw`(?<![${D}.,\/:\-])(${d}{1,2})(?:st|nd|rd|th)?${s}?[\-—]${s}?(${d}{1,2})(?:st|nd|rd|th)?${s}+(${MONTH_PATTERN})${b}(?:,?${s}+(${d}{4}))?`)
const MONTH_DAY_RE = re(String.raw`${b}(${MONTH_PATTERN})\.?${s}+(${d}{1,2})(?:st|nd|rd|th)?(?:,?${s}+(${d}{4}))?(?![${D}:])`)
const DAY_MONTH_RE = re(String.raw`(?<![${D}.,\/:\-])(${d}{1,2})(?:st|nd|rd|th)?${s}+(${MONTH_PATTERN})${b}(\.(?=${s}+[a-z${D}]))?(?:,?${s}+(${d}{4}))?`)

const PHONE_FULL_RE = re(String.raw`(?<![${D}\-])(?:\+?(1)[\-.${S}])?\(?(${d}{3})\)?[\-.${S}](${d}{3})[\-.${S}](${d}{4})(?![${D}\-])`)
const PHONE_LOCAL_RE = re(String.raw`(?<![${W}.,\-])(${d}{3})-(${d}{4})(?![${W}\-])`)
const VERSION_LONG_RE = re(String.raw`(?<![${W}.])([vV])?(${d}+(?:\.${d}+){2,})(?:-(${d}+)(?![${W}\-]|\.${d}))?(?![${W}])`)
const VERSION_SHORT_RE = re(String.raw`(?<![${W}.])([vV])(${d}+)\.(${d}{2,3})(?!${d}|\.${d}|${w})`)
const VERSIONED_RE = ignorecase(String.raw`${b}(${VERSIONED})(\.?${s}(?:(?:from|to)${s})?)(${d}+)\.(${d}{2,3})(?:(${s}(?:to|or|and)${s})(${d}+)\.(${d}{2,3}))?(?!${d}|\.${d}|${s}?%|${s}(?:percent|million|billion)${b})`)

const NEGATIVE_RE = re(String.raw`(?<![${W}.])-(?=${d})`)
const DIM_BY_RE = re(String.raw`(?:(?<=${d})${s}?[xX×]|×)${s}?(?=${d}[${D}.,]*${s}?(?:${LENGTHS})${b})`)
const TIMES_RE = re(String.raw`(?<=${d})${s}[xX×]${s}(?=${d})`)
const CHAT_DIGIT_RE = re(String.raw`(?<![${W}\/'])[A-Za-z0-9\/]*[0-9\/][A-Za-z0-9\/]*(?![${W}\/'])`)
const DECADE_RE = re(String.raw`(?<![${W}.])'?(${d}{2}|${d}{4})'?s${b}`)
const ORDINAL_RE = re(String.raw`(?<![${W}.])(${d}+)(?:st|nd|rd|th)${b}`)
const VIDEO_RES_RE = re(String.raw`(?<![${W}.])(144|240|360|480|540|576|720|900|1080|1440|2160|4320)([pi])${b}`)
const PERCENT_RE = re(String.raw`(${d}[${D},]*(?:\.${d}+)?)${s}?%`)
const MIXED_FRAC_RE = re(String.raw`(?<![${D}\/.,\-])(${d}+) (${d})\/(2|3|4|5|6|8|10|16)(?![${D}\/]|\.${d})`)
const FRAC_RE = re(String.raw`(?<![${D}\/.])(${d}+)\/(${d}+)(?![${D}\/]|\.${d})`)
const YEAR_RANGE_RE = re(String.raw`(?<![${W}.,\-])(${d}{4})[\-–](${d}{4})(?![${W}.,\-])`)
const NUM_RANGE_RE = re(String.raw`(?<![${W}.,\-])(${d}+)[\-–](${d}+)(?![${W}\-]|[.,]${d})`)
const NUM_TIMES_RE = re(String.raw`(?<![${W}.])(${d}+)x${b}`)
const POWER_RE = re(String.raw`(?<=${d})\^(?=${d})`)

const CLAUSE_WORD_RE = re(String.raw`[A-Za-z']+${end}`)
const SIZE_RANGE_RE = re(String.raw`(?<![${W}\-])(${SIZES})-(${SIZES})(?![${W}\-])`)
const HASH_NUM_RE = re(String.raw`#(?=${d})`)
const HASH_CODE_RE = re(String.raw`#(?=[A-Z]{1,4}-?${d})`)
const HASH_TAG_RE = re("#(?=[A-Za-z])")
const TILDE_ABOUT_RE = re(String.raw`~(?=${s}?${d})`)
const MULTI_COMP_RE = re(String.raw`(?<=[${W}${S}${END}${IS}])(>=|<=|!=)(?=[${W}${S}${SPELL}])`)
const GPU_TI_RE = re(String.raw`(?<=${d}) Ti${b}`)
const REF_NO_RE = re(String.raw`${b}([Rr])ef\.${s}?[Nn]o\.(?=${s})`)
const DOTTED_RE = re(String.raw`${b}((?:[A-Za-z]\.){2,})`)
const ABBR_RE = re(String.raw`${b}([A-Za-z]{1,6})${b}(\.?)(?![A-Za-z'’])`)
const ABBR_NEXT_WORD = re(String.raw`${s}*([A-Za-z]+|${d})`)
const ABBR_CAP_BEFORE = re(String.raw`[A-Z][a-z]+${s}+${end}`)
const ABBR_PREV_WORD = re(String.raw`([A-Za-z]+)\.?${s}+${end}`)
const NUMBER_RE = re(String.raw`(?<![${W}.])${d}{1,3}(?:,${d}{3})+(?:\.${d}+)?|${d}+(?:\.${d}+)?|(?<![${W}.])\.${d}+`)
const SLASH_WORD_RE = re("(?<=[A-Za-z])/(?=[A-Za-z])")
const COMP_ANGLE_RE = re(String.raw`(?<=${d})${IS}?${s}?[<>]${s}?(?=${d})|(?<=${s})[<>](?=${s})`)
const SYMBOL_WORDS_RE = re("[" + Object.keys(SYMBOL_WORDS).join("") + "]")

const STRETCH_3_RE = re(String.raw`([^\n])\1\1`)
const STRETCH_RUN_RE = re(String.raw`([^\n])\1{2,}`)
const STRETCH_LIKED_RE = re(String.raw`([lfsz])\1\1+${end}`)
const STRETCH_END_RE = re(String.raw`([^\n])\1{2,}${end}`)
const CAPITALS_RE = re("[a-z]+(?:[A-Z][a-z]+)*[A-Z]{2,}(?:'s)?")
const CAMEL_PARTS_RE = re("[A-Z]?[a-z']+|[A-Z]+(?![a-z])")
const ALPHA_RUNS_RE = re("[A-Za-z]{2,}")
const AFTER_LETTER_RE = re(String.raw`${s}*[A-Za-z]`)
const SHORT_FOLLOW_RE = re(String.raw`[.!?…,;:—"')]*(?:${s}|${end})`)
const REPLY_FOLLOW_RE = re(String.raw`(?:[.?…,;—]*["']?(?:${s}|${end})|!+["']?${s}*${end})`)

const ACCENTED = ignorecase(String.raw`${b}(${Object.keys(ACCENT_DECIDES).join("|")})(s?)${b}`)

/** An accented Latin letter without its accent ("café" is in the dictionary as "cafe"). */
function plainLetter(char: string): string {
  if (isascii(char) || !isalpha(char)) return char
  const form = LETTER_FORMS[char]
  if (form !== undefined) return form
  const base = char.normalize("NFKD").replace(/[\p{Mn}\p{Me}]/gu, "")
  return isascii(base) && isalpha(base) ? base : char
}

// ---- numbers as words --------------------------------------------------------

const THOUSAND = 1000n

/** ``1234`` -> ``"one thousand two hundred thirty four"``. */
export function cardinal(value: number | bigint): string {
  let number = BigInt(value)
  if (number < 0n) return "minus " + cardinal(-number)
  if (number < 20n) return ONES[Number(number)]!
  if (number < 100n) {
    const tens = Number(number / 10n)
    const ones = Number(number % 10n)
    return TENS[tens - 2]! + (ones ? " " + ONES[ones]! : "")
  }
  if (number < 1000n) {
    const hundreds = Number(number / 100n)
    const rest = number % 100n
    return ONES[hundreds]! + " hundred" + (rest ? " " + cardinal(rest) : "")
  }
  if (number >= THOUSAND ** BigInt(SCALES.length + 1)) return digits(number.toString())
  const parts: string[] = []
  for (let power = SCALES.length; power > 0; power--) {
    const size = THOUSAND ** BigInt(power)
    const count = number / size
    number %= size
    if (count) parts.push(cardinal(count) + " " + SCALES[power - 1]!)
  }
  if (number) parts.push(cardinal(number))
  return parts.join(" ")
}

export function ordinal(value: number | bigint): string {
  const words = cardinal(value).split(" ")
  const last = words[words.length - 1]!
  words[words.length - 1] = ORDINAL[last] || (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th")
  return words.join(" ")
}

export function digits(text: string, zero = "zero"): string {
  if (isascii(text)) {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c >= 48 && c <= 57) {
        if (out) out += " "
        out += c === 48 ? zero : ONES[c - 48]!
      }
    }
    return out
  }
  return chars(text).filter(isdigit).map((c) => (c === "0" ? zero : ONES[int(c)]!)).join(" ")
}

/** The way a year is said: 1984, 1905, 1900, 2005, 2026. */
function year(number: number): string {
  if (!(number >= 1000 && number <= 2999)) return cardinal(number)
  const high = Math.floor(number / 100)
  const low = number % 100
  if (low === 0) return high % 10 === 0 ? cardinal(number) : cardinal(high) + " hundred"
  if (high === 20 && low < 10) return "two thousand " + ONES[low]!
  return cardinal(high) + (low < 10 ? " oh " + ONES[low]! : " " + cardinal(low))
}

/** A number read two digits at a time, the way model numbers are: 4070 "forty seventy". */
function pairs(number: number): string {
  const high = Math.floor(number / 100)
  const low = number % 100
  if (!(number >= 100 && number <= 9999) || (low === 0 && (high < 10 || high % 10 === 0))) return cardinal(number)
  if (low === 0) return cardinal(high) + " hundred"
  return cardinal(high) + (low < 10 ? " oh " + ONES[low]! : " " + cardinal(low))
}

const len = (text: string) => (isascii(text) ? text.length : chars(text).length)

/** An unsigned number as written: ``1,234``, ``3.14``, ``007``. */
export function numberWords(text: string): string {
  const plain = text.replaceAll(",", "")
  const point = plain.indexOf(".")
  const whole = point < 0 ? plain : plain.slice(0, point)
  const fraction = point < 0 ? "" : plain.slice(point + 1)
  if (fraction) return (whole ? cardinal(bigint(whole)) : "") + " point " + digits(fraction)
  if ((len(whole) > 1 && whole.startsWith("0")) || len(whole) > 18) return digits(whole)
  return cardinal(bigint(whole))
}

/** ``2:03:45`` as a length of time. */
function duration(hours: number, minutes: number, seconds: number): string {
  const parts = ([[hours, "hour"], [minutes, "minute"], [seconds, "second"]] as const)
    .filter(([count]) => count).map(([count, name]) => `${cardinal(count)} ${count === 1 ? name : name + "s"}`)
  if (parts.length < 2) return parts.length ? parts[0]! : "zero seconds"
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]!
}

/** Plural of a spelled number, for decades: "nineteen nineties". */
function pluralOf(words: string): string {
  const space = words.lastIndexOf(" ")
  const head = space < 0 ? "" : words.slice(0, space)
  let last = space < 0 ? words : words.slice(space + 1)
  last = last.endsWith("y") ? last.slice(0, -1) + "ies" : last + "s"
  return (head ? head + " " : "") + last
}

/** "three quarters", "one half"; after a whole number "a half", "an eighth". */
function fractionWords(top: bigint, bottom: bigint, article = false): string {
  const known = FRACTION[bottom.toString()]
  const [one, many] = known ?? [ordinal(bottom), ordinal(bottom) + "s"]
  if (top !== 1n) return `${cardinal(top)} ${many}`
  return (article ? ("aeiou".includes(one[0]!) ? "an " : "a ") : "one ") + one
}

/** One part of a version number: "4" four, "12" twelve, "03" zero three, "129" one two nine. */
const versionPart = (part: string) => (len(part) > 2 ? digits(part) : numberWords(part))

/** The part after the point of a version: "12" twelve, "04" oh four. */
const minor = (part: string) => (part.startsWith("0") ? digits(part, "oh") : cardinal(bigint(part)))

/** A number in a code said as a number: one or two digits, or a round one (B-12, KX-300). */
function shortNumber(text: string): boolean {
  if (text.startsWith("0")) return false
  const rest = chars(text).slice(1)
  return len(text) <= 2 || (rest.length > 0 && rest.every((c) => c === "0"))
}

const spelled = (letters: string) => `${SPELL}${letters}${END}`

const CLAUSE_SPLIT = re(String.raw`[.!?;…]${s}|[()"]`)
const LETTERS = re("[A-Za-z]+")

/** The words just before ``position`` in the same clause, in lower case. */
function before(text: string, position: number, count = 4): string[] {
  const parts = CLAUSE_SPLIT.split(text.slice(back(text, position, 80), position))
  return LETTERS.findall(parts[parts.length - 1]!).map((word) => word.toLowerCase()).slice(-count)
}

/** What the words before a number say it is: "phone", "pin", "strong", "weak", "enter" or null. */
function identifier(text: string, position: number): string | null {
  const words = before(text, position)
  if (!words.length) return null
  const last = words[words.length - 1]!
  if (PHONE_WORDS.has(last) || (PHONE_LINKS.has(last) && words.slice(-3, -1).some((w) => PHONE_WORDS.has(w)))) return "phone"
  let index = words.length - 1
  while (index > 0 && LINK_WORDS.has(words[index]!)) index--
  for (const [kind, group] of [["phone", PHONE_WORDS], ["pin", PIN_WORDS], ["strong", STRONG_WORDS], ["weak", WEAK_WORDS]] as const) {
    if (group.has(words[index]!)) return kind
  }
  return last === "enter" ? "enter" : null
}

const DECIMAL_COMMA = re(String.raw`${d}+,${d}{1,2}`)

/** "1,5" before a unit is one number; "1,250" is left as it is. */
const decimalComma = (text: string) => (DECIMAL_COMMA.fullmatch(text) ? text.replaceAll(",", ".") : text)

/** Digits inside a file name or an address: 3, 2026, 0412. */
function addressDigits(text: string): string {
  if (len(text) <= 2 && !(len(text) === 2 && text[0] === "0")) return cardinal(bigint(text))
  if (len(text) === 4 && int(text) >= 1900 && int(text) <= 2099) return year(int(text))
  return digits(text)
}

const pyEscape = (text: string) => text.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, "\\$&")

const SMALL_WORD_AFTER = re(String.raw`${s}+[a-z]`)
const AFTER_WORD = re(String.raw`${s}*([A-Za-z]+)`)
const FIRST_WORD = re("[A-Za-z']+")
const TOKEN = re(SPELL + "([A-Za-z ]+)" + END + "|" + INLINE + "([^\\n])" + INLINE
  + String.raw`|('?[A-Za-z]+(?:'[A-Za-z]+)*)|(${d}+)|(-)|([^${S}])`)

/** ``following`` starts a new sentence: a capitalised word that often opens one. */
function startsSentence(following: string) {
  const first = FIRST_WORD.match(following)
  return isupper(charAt(following, 0)) && first !== null && SENTENCE_STARTERS.has(first.text.toLowerCase())
}

// ---- rewriting -----------------------------------------------------------------

export class Normalizer {
  private readonly isWord: (word: string) => boolean
  private readonly abbreviations = new Map<string, readonly [string, string]>()
  private readonly units = new Map<string, readonly [string, string]>()
  private readonly exactUnits = new Map<string, readonly [string, string]>()
  private readonly chat = new Map<string, string>()
  private readonly replies = new Set<string>()
  private readonly endings: Map<string, string>
  private readonly unitNames: string
  private readonly unit: ReturnType<typeof re>
  private readonly unitFollow: ReturnType<typeof re>
  private readonly unitBare: ReturnType<typeof re>
  private readonly abbrRe: ReturnType<typeof re>
  private readonly area = re(String.raw`(?<![${W}.])(${d}[${D},]*(?:\.${d}+)?)${s}?(km|cm|mm|m|ft|mi|yd|in)([²³])`)
  private readonly areaPlain = re(String.raw`(?<![${W}.])(${d}[${D},]*(?:\.${d}+)?)${s}?(km|cm|mm|m|ft)([23])(?![${W}])`)
  private inline: (readonly [string, Phones])[] = []
  private dayFirst = false
  private dated = false

  constructor(tables: { abbreviations: string; units: string; chat: string; endings: string }, isWord: (word: string) => boolean) {
    this.isWord = isWord
    for (const [, columns] of rows(tables.abbreviations)) this.abbreviations.set(columns[0]!, [columns[1]!, columns[2]!])
    for (const [, columns] of rows(tables.units)) {
      if (columns.length > 3 && columns[3] === "exact") this.exactUnits.set(columns[0]!, [columns[1]!, columns[2]!])
      else this.units.set(columns[0]!.toLowerCase(), [columns[1]!, columns[2]!])
    }
    for (const [number, columns] of rows(tables.chat)) {
      if (columns.length > 2 && !(columns.length === 3 && columns[2] === "alone")) {
        throw new Error(`chat.txt line ${number}: after the words to say there can only be "alone"`)
      }
      this.chat.set(columns[0]!, columns.length > 1 ? columns[1]! : "-")
      if (columns.length > 2) this.replies.add(columns[0]!)
    }
    this.endings = mapping(tables.endings)
    // Python sorts the escaped names, longest first; the order decides which name the alternation tries first.
    const names = [...new Set([...this.units.keys(), ...this.exactUnits.keys()])]
      .map((name) => [pyEscape(name), name] as const)
      .sort(([x], [y]) => len(y) - len(x) || (x < y ? -1 : x > y ? 1 : 0))
    this.unitNames = names.map(([, name]) => escapeRegExp(name)).join("|")
    this.unit = ignorecase(String.raw`(?<![${W}.])(${d}[${D},]*(?:\.${d}+)?)(?:[\-–](${d}[${D},]*(?:\.${d}+)?))?${s}?(${this.unitNames})(?![A-Za-z])(\.(?=${s}+[a-z]))?`, true)
    this.unitFollow = ignorecase(String.raw`${s}?(?:%|percent|million|billion|${this.unitNames})(?![A-Za-z])`)
    this.unitBare = ignorecase(String.raw`${s}?(?:${this.unitNames})(?![A-Za-z])`)
    const abbrKeys = [...new Set(["st", "dr", ...this.abbreviations.keys()])]
      .filter((k) => /^[A-Za-z]{1,6}$/.test(k))
      .sort((a, b) => b.length - a.length)
      .map(asciiCaseInsensitive)
    this.abbrRe = abbrKeys.length ? re(String.raw`${b}(${abbrKeys.join("|")})${b}(\.?)(?![A-Za-z'’])`) : ABBR_RE
  }

  // -- pieces of the text that are not words --

  private amount(symbol: string, whole: string, fraction: string | undefined, scale: string | undefined): string {
    const [one, many, cent, cents] = CURRENCY[symbol]!
    if (scale) {
      const name = SCALE_LETTER[scale.toLowerCase()] ?? scale.toLowerCase()
      return `${numberWords(whole + (fraction ? "." + fraction : ""))} ${name} ${many}`
    }
    if (fraction && (len(fraction) > 2 || !cent)) return `${numberWords(whole + "." + fraction)} ${many}`
    const amount = bigint(whole)
    const cents_ = fraction || "0"
    const change = int(len(cents_) >= 2 ? cents_ : cents_ + "0".repeat(2 - len(cents_)))
    const parts: string[] = []
    if (amount || !change) parts.push(`${cardinal(amount)} ${amount === 1n ? one : many}`)
    if (change && cent) parts.push(`${cardinal(change)} ${change === 1 ? cent : cents}`)
    return parts.join(" and ")
  }

  private static continental(m: Match): string {
    const groups = m.group(1)!.split(".")
    if (groups.length === 4 && groups.every((group) => int(group) <= 255)) return m.text
    return groups.join(",") + "." + m.group(2)!
  }

  private money(m: Match): string {
    const whole = m.group("whole")!.replaceAll(",", "").replaceAll(" ", "")
    const words = this.amount(m.group("symbol")!, whole, m.group("fraction"), m.group("scale"))
    return (m.group("minus") || m.group("inner") ? " minus " : " ") + words + " "
  }

  /** " A M" or " P M" as letters; a stop that closes "p.m." ends the sentence only when a new one follows. */
  private static halfDay(m: Match, dotted: string | undefined, plain: string | undefined): string {
    if (!(dotted || plain)) return ""
    const following = lstrip(m.string.slice(m.end()))
    const closes = Boolean(dotted) && m.text.endsWith(".") && (!following || startsSentence(following))
    return `${SPELL}${(dotted || plain)!.toUpperCase()}M${END}${closes ? " ." : ""} `
  }

  private time(m: Match): string {
    const hour = int(m.group(1)!)
    const minute = int(m.group(2)!)
    const second = m.group(3)
    const half = m.group(4) || m.group(5)
    const words_ = before(m.string, m.start(), 3)
    if (second !== undefined && !half && !(words_.length && words_[words_.length - 1] === "at")) return ` ${duration(hour, minute, int(second))} `
    if (hour > 24 && second === undefined && !half) {
      const after = AFTER_WORD.match(m.string.slice(m.end()))
      if (words_.some((w) => DURATION_WORDS.has(w)) || (after && DURATION_WORDS.has(after.group(1)!.toLowerCase()))) return ` ${duration(0, hour, minute)} `
      return ` ${cardinal(hour)} ${minute < 10 ? "oh " : ""}${cardinal(minute)} `
    }
    if (hour > 24) return m.text
    let words = cardinal(hour)
    if (minute === 0) {
      if (half) {
        // the half of the day is said instead
      } else if (hour === 0) words = "midnight"
      else if (hour > 12) words += " hundred"
      else words += " o'clock"
    } else {
      words += (minute < 10 ? " oh " : " ") + cardinal(minute)
    }
    if (second) words += " and " + cardinal(int(second)) + (int(second) === 1 ? " second" : " seconds")
    return ` ${words} ` + Normalizer.halfDay(m, m.group(4), m.group(5))
  }

  /** "9.30 to 11.30" where the words before say it is a time of day. */
  private dotTimes(m: Match): string {
    if (int(m.group(1)!) > 23 || int(m.group(4)!) > 23 || !before(m.string, m.start()).some((w) => CLOCK_WORDS.has(w))
        || this.unitFollow.matchAt(m.string, m.end())) return m.text
    return `${m.group(1)}:${m.group(2)}${m.group(3)}${m.group(4)}:${m.group(5)}`
  }

  /** 16:9, 3:1, 1:25,000. Two digits after the colon are a time unless the words say "ratio". */
  private ratio(m: Match): string {
    const first = m.group(1)!
    const second = m.group(2)!
    if (len(first) <= 2 && len(second) === 2 && "012345".includes(second[0]!)) {
      const after = AFTER_WORD.match(m.string.slice(m.end()))
      if (!(before(m.string, m.start(), 3).some((w) => RATIO_WORDS.has(w)) || (after && RATIO_WORDS.has(after.group(1)!.toLowerCase())))) return m.text
    }
    return ` ${numberWords(first)} to ${numberWords(second)} `
  }

  private date(month: number, day: number, yearText?: string, the = false): string | null {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null
    let words = the ? `the ${ordinal(day)} of ${MONTHS[month - 1]}` : `${MONTHS[month - 1]} ${ordinal(day)}`
    if (yearText) words += " " + (len(yearText) === 4 ? year(int(yearText)) : (int(yearText) < 10 ? "oh " : "") + cardinal(int(yearText)))
    return ` ${words} `
  }

  private slashDate(m: Match): string {
    let first = int(m.group(1)!)
    let second = int(m.group(2)!)
    if ((first > 12 && 12 >= second) || (this.dayFirst && second <= 12)) [first, second] = [second, first]
    return this.date(first, second, m.group(3)) ?? m.text
  }

  /** 15.11.2026: dates written with full stops put the day first. */
  private dotDate(m: Match): string {
    let day = int(m.group(1)!)
    let month = int(m.group(2)!)
    if (month > 12 && 12 >= day) [day, month] = [month, day]
    return this.date(month, day, m.group(3)) ?? m.text
  }

  /** "22 February", "5 Jan. 2026". The stop after a short month name is dropped; any other one ends the sentence. */
  private dayMonth(m: Match): string {
    const month = m.group(2)!
    const spoken = this.date(MONTH_NUMBER.get(month.toLowerCase().slice(0, 3))!, int(m.group(1)!), m.group(4), true)
    if (spoken === null) return m.text
    return spoken + (m.group(3) && MONTHS.includes(month) ? ". " : "")
  }

  /** "3-17 November" and "November 3-17". */
  private daysOfMonth(m: Match): string {
    const monthFirst = isalpha(charAt(m.group(1)!, 0))
    const [month, firstText, secondText] = monthFirst ? [m.group(1)!, m.group(2)!, m.group(3)!] : [m.group(3)!, m.group(1)!, m.group(2)!]
    const first = int(firstText)
    const second = int(secondText)
    if (!(first >= 1 && first <= 31 && second >= 1 && second <= 31)) return m.text
    const name = MONTHS[MONTH_NUMBER.get(month.toLowerCase().slice(0, 3))! - 1]!
    const words = monthFirst ? `${name} ${ordinal(first)} to ${ordinal(second)}` : `the ${ordinal(first)} to the ${ordinal(second)} of ${name}`
    return ` ${words}${m.group(4) ? " " + year(int(m.group(4)!)) : ""} `
  }

  /** "Mon.-Fri.", "Jan-Mar": from one day or month to another. */
  private dayRange(m: Match): string {
    const names = [m.group(1)!, m.group(3)!].map((name) => {
      const key = name.toLowerCase()
      const abbreviation = this.abbreviations.get(key)
      return abbreviation ? abbreviation[1] : (DAY_NAMES[key] ?? name)
    })
    const following = lstrip(m.string.slice(m.end()))
    const ends = Boolean(m.group(4)) && (!following || startsSentence(following))
    return `${names[0]} to ${names[1]}${ends ? " ." : ""}`
  }

  /** "14/03", "12/10" as a day of the year, or null when it is a fraction. */
  private shortDate(m: Match): string | null {
    const firstText = m.group(1)!
    const secondText = m.group(2)!
    if (len(firstText) > 2 || len(secondText) > 2) return null
    let first = int(firstText)
    let second = int(secondText)
    const words = before(m.string, m.start())
    if (first >= 1 && first <= 12 && second >= 20 && second <= 49 && words.includes("card")) return ` ${MONTHS[first - 1]} ${year(2000 + second)} `
    const last = words.length ? words[words.length - 1]! : ""
    const classic = first < second && CLASSIC_FRACTIONS.has(BigInt(second))
    const zero = (len(firstText) === 2 && firstText[0] === "0") || (len(secondText) === 2 && secondText[0] === "0")
    if (!(zero || (first > 12 && first <= 31 && second <= 12 && !(first === 24 && second === 7))
        || (DATE_BEFORE.has(last) && (!classic || last === "on"))
        || (this.dated && !classic && first !== second))) return null
    if (first > 12 || (this.dayFirst && second <= 12)) [first, second] = [second, first]
    return this.date(first, second)
  }

  private fraction(m: Match): string {
    const spoken = this.shortDate(m)
    if (spoken) return spoken
    const top = bigint(m.group(1)!)
    const bottom = bigint(m.group(2)!)
    if ((top === 24n && bottom === 7n) || top === bottom) return ` ${cardinal(top)} ${cardinal(bottom)} `
    if (!(top > 0n && top < 100n) || !(bottom > 1n && bottom <= 100n)) return ` ${cardinal(top)} over ${cardinal(bottom)} `
    return ` ${fractionWords(top, bottom)} `
  }

  /** "2 1/2": two and a half. */
  private mixedFraction(m: Match): string {
    const top = bigint(m.group(2)!)
    const bottom = bigint(m.group(3)!)
    if (!(top > 0n && top < bottom)) return m.text
    return ` ${numberWords(m.group(1)!)} and ${fractionWords(top, bottom, true)} `
  }

  /** "½" and "1½", before the text is normalised (which would turn "1½" into "11/2"). */
  private static vulgar(m: Match): string {
    const [top, bottom] = m.group(2)!.normalize("NFKC").split("⁄").map(bigint) as [bigint, bigint]
    if (m.group(1) === undefined) return ` ${top}/${bottom} `
    return ` ${cardinal(bigint(m.group(1)!))} and ${fractionWords(top, bottom, true)} `
  }

  private static phone(m: Match): string {
    return " " + m.groups().filter((g): g is string => Boolean(g)).map((g) => (g === "800" ? "eight hundred" : digits(g, "oh"))).join(", ") + " "
  }

  private measure(m: Match): string {
    // The pattern can't say Python's "(?-i:[a-z])", so it takes the stop before any letter; a stop it should have
    // left (before a capital) goes back after the words.
    const stop = Boolean(m.group(4)) && !SMALL_WORD_AFTER.match(m.string.slice(m.end()))
    const unit = m.group(3)!
    const names = this.exactUnits.get(unit) ?? this.units.get(unit.toLowerCase())
    const next = m.string.slice(m.end(3), m.end(3) + 1)
    if (names === undefined || (len(unit) === 1 && (next === "-" || next === "'" || next === "/"))) return m.text
    return this.measureWords(m, names) + (stop ? "." : "")
  }

  private measureWords(m: Match, [one, many]: readonly [string, string]): string {
    const value = decimalComma(m.group(1)!)
    const upper = m.group(2) && decimalComma(m.group(2)!)
    if (upper) return ` ${numberWords(value)} to ${numberWords(upper)} ${many} `
    return ` ${numberWords(value)} ${value === "1" || value === "1.0" ? one : many} `
  }

  /** "120 m²", "3 m3": square and cubic measures. */
  private square(m: Match): string {
    const unit = m.group(2)!
    const [one, many] = unit === "in" ? ["inch", "inches"] : (this.exactUnits.get(unit) ?? this.units.get(unit)!)
    const kind = "²2".includes(m.group(3)!) ? "square" : "cubic"
    const value = decimalComma(m.group(1)!)
    return ` ${numberWords(value)} ${kind} ${value === "1" || value === "1.0" ? one : many} `
  }

  /** True when a plural noun follows a number: it is then an amount, not a reference. */
  private counted(text: string, at: number): boolean {
    const after = AFTER_WORD.matchAt(text, at)
    if (!after) return false
    const word = after.group(1)!.toLowerCase()
    if (COUNTED_IRREGULAR.has(word)) return true
    return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !NOT_COUNTED.has(word) && this.isWord(word.slice(0, -1))
  }

  private number(m: Match, text: string): string {
    const value = m.text
    const plain = value.replaceAll(",", "")
    if (!plain.includes(".") && !value.includes(",") && !plain.startsWith("0") && len(plain) > 2) {
      const kind = identifier(text, m.start())
      const limit = ({ phone: 3, pin: 3, strong: 4, enter: 4, weak: 5 } as Record<string, number>)[kind ?? ""] ?? 7
      if (len(plain) >= limit && !(kind === null && plain.endsWith("000"))
          && !(kind === "enter" && len(plain) === 4 && int(plain) >= 1900 && int(plain) <= 2099)
          && !((kind === null || kind === "phone" || kind === "weak") && this.counted(text, m.end()))) {
        return ` ${digits(plain, kind === "phone" ? "oh" : "zero")} `
      }
    }
    if (!plain.includes(".") && !value.includes(",") && len(plain) === 4 && !plain.startsWith("0")) {
      const number = int(plain)
      const head = text.slice(0, m.start())
      const words = LETTERS.findall(head.slice(back(head, head.length, 24)))
      const after = AFTER_WORD.matchAt(text, m.end())
      const counted = Boolean(after) && COUNTED_NOUN_RE.test(after!.group(1)!.toLowerCase())
      const lastWord = words.length ? words[words.length - 1]!.toLowerCase() : ""
      const dated = words.length > 0 && (YEAR_CONTEXT.has(lastWord) || MONTH_NUMBER.has(lastWord.slice(0, 3)))
      const model = MODEL_PREFIX_RE.search(head)
      if (model && !CAPITAL_WORDS.has(model.group(1)!) && !counted) return ` ${pairs(number)} `
      if ((number >= 1100 && number <= 1999) || (number >= 2000 && number <= 2099 && (dated || !counted))) return ` ${year(number)} `
    }
    return ` ${numberWords(value)} `
  }

  // -- codes and reference numbers --

  /** Letters inside a code that are a word to say, not letters to name: SAVE-20. */
  private readsAsWord(letters: string): boolean {
    const lower = letters.toLowerCase()
    if (lower.length < 3 || !this.isWord(lower)) return false
    return lower.length > 3 || ["s", "es", "ed", "ing"].some((ending) => this.isWord(lower + ending))
  }

  /** A group that mixes letters and digits: the letters are named, the digits read one by one. */
  private static alnum(group: string, zero = "zero"): string {
    return ALNUM_RUN_RE.findall(group).map((run) => (isdigit(run) ? digits(run, zero) : spelled(run))).join(" ")
  }

  /** Groups of digits with a short break between them. Small numbers stay numbers: 9-1-1. */
  private static digitGroups(groups: readonly string[], zero = "zero"): string {
    if (groups.every((group) => shortNumber(group) && len(group) <= 2)) return groups.map((group) => cardinal(bigint(group))).join(" , ")
    return groups.map((group) => digits(group, zero)).join(" , ")
  }

  private codeWords(groups: string[], m: Match): string | null {
    const token = groups.join("-")
    if (!HAS_DIGIT.test(token)) return null
    const kinds = groups.map((g) => (isdigit(g) ? "d" : HAS_DIGIT.test(g) ? "m" : isupper(g) ? "u" : "l"))
    if (kinds.every((kind) => kind === "d")) {
      if (groups.length === 2) {
        const years = groups.every((g) => len(g) === 4 && int(g) >= 1000 && int(g) <= 2100)
        const kind = identifier(m.string, m.start())
        if (!(m.group(1) || groups.some((g) => len(g) > 1 && g[0] === "0")
            || (Math.min(...groups.map(len)) >= 4 && !years) || kind === "strong" || kind === "pin")) return null
      }
      return Normalizer.digitGroups(groups)
    }
    if (groups.length === 2 && kinds[1] === "d" && (kinds[0] === "u" || kinds[0] === "l")) {
      const [letters, number] = groups as [string, string]
      if ((kinds[0] === "l" && letters.length > 1) || this.readsAsWord(letters)) return null
      if (shortNumber(number)) return `${spelled(letters)} ${cardinal(bigint(number))}`
      return `${spelled(letters)} , ${digits(number)}`
    }
    if (groups.length === 2 && kinds[0] === "d" && (kinds[1] === "l" || len(groups[1]!) === 1
        || DIGITS_LETTERS_RE.fullmatch(groups[1]!))) return null
    if (groups.some((g, k) => (kinds[k] === "l" && g.length > 2) || (kinds[k] === "m" && DIGITS_ORD_RE.fullmatch(g)))) return null
    if (!chars(token).some(isupper) && (kinds.includes("l") || kinds.includes("m"))) return null
    const parts = groups.map((group, k) => {
      const kind = kinds[k]
      if (kind === "d") return digits(group)
      if (kind === "m") return Normalizer.alnum(group)
      if (group.length > 3 && this.isWord(group.toLowerCase())) return group
      return group.length <= 5 ? spelled(group) : group
    })
    return parts.join(" , ")
  }

  /** Codes written with hyphens: AB-4471-Z, 91-220-0017, #A7-4419. */
  private code(m: Match): string {
    const words = this.codeWords(m.group(2)!.split("-"), m)
    if (words === null) return m.text
    return (m.group(1) ? " number " : " ") + words + " "
  }

  /** Digits written in groups with spaces: a telephone, card or tracking number, or thousands parted by spaces. */
  private grouped(m: Match): string {
    const text = m.string
    const plus = m.group("plus")
    let lead = m.group("lead")
    let trail = m.group("trail")
    const core = (m.group("core") ?? m.group("bare"))!.split(" ")
    let head = ""
    let tail = ""
    if (lead !== undefined && CAPITAL_WORDS.has(lead)) {
      head = lead + " "
      tail = trail ? " " + trail : ""
      lead = undefined
      trail = undefined
    }
    const kind = identifier(text, m.start())
    const pure = core.every((part) => isdigit(part))
    if (pure && !plus && !lead) {
      const amount = this.counted(text, m.end())
        || this.unitBare.matchAt(text, m.end()) !== null
      if (kind === null && charAt(core[0]!, 0) !== "0" && len(core[0]!) <= 3 && core.slice(1).every((part) => len(part) === 3)
          && (core[core.length - 1] === "000" || (amount && core.length > 2))) return head + core.join(",") + tail
      if (!(kind || (len(core[0]!) > 1 && charAt(core[0]!, 0) === "0") || (core.length > 2 && core.some((part) => len(part) > 2)))) return m.text
    } else if (!pure && !lead && !plus && kind === null) {
      return m.text
    }
    const zero = plus || kind === "phone" || (pure && charAt(core[0]!, 0) === "0" && core.reduce((total, part) => total + len(part), 0) >= 10) ? "oh" : "zero"
    let spoken = pure ? Normalizer.digitGroups(core, zero)
      : core.map((part) => (isdigit(part) ? digits(part, zero) : Normalizer.alnum(part, zero))).join(" , ")
    if (lead) spoken = `${spelled(lead)} , ${spoken}`
    if (trail) spoken = `${spoken} , ${spelled(trail)}`
    return head + (plus ? " plus " : " ") + spoken + " " + tail
  }

  /** Letters and digits written together: B12, 14C, X7K, PS5. A single letter is always named. */
  private glued(m: Match): string {
    const out = ALNUM_RUN_RE.findall(m.text).map((run) => {
      if (isdigit(run)) return shortNumber(run) ? cardinal(bigint(run)) : digits(run)
      if (run.length === 1 || ((isupper(run) || run.length <= 3) && !this.readsAsWord(run))) return spelled(run)
      return run
    })
    return " " + out.join(" ") + " "
  }

  // -- web addresses and file names --

  /** One run of letters inside an address: a word, or letters to name. */
  private addressPart(part: string): string {
    const lower = part.toLowerCase()
    if (part.length > 1 && this.isWord(lower) && (part.length > 2 || SHORT_WORDS.has(lower))) return part
    return part.length <= 3 ? spelled(part) : part
  }

  private spokenAddress(core: string): string {
    const pieces = ADDRESS_PIECES_RE.findall(core)
    const mail = core.includes("@")
    let host = false
    const out: string[] = []
    pieces.forEach((piece, index) => {
      const following = index + 1 < pieces.length ? pieces[index + 1]! : ""
      if (piece === "@") host = true
      if (isdigit(piece)) {
        out.push(addressDigits(piece))
      } else if (!isalpha(piece)) {
        out.push(SEPARATORS[piece] ?? "")
      } else if (index && pieces[index - 1] === "." && (host || !mail) && (["", "/", ":", "?", "#"].includes(following)
          || (piece.length <= 3 && (this.endings.has(piece.toLowerCase()) || !this.isWord(piece.toLowerCase()))))) {
        out.push(this.endings.get(piece.toLowerCase()) === "word" ? piece.toLowerCase() : spelled(piece))
      } else {
        let letters = ""
        for (const part of ADDRESS_CAMEL_RE.findall(piece)) {
          const spoken = this.addressPart(part)
          if (spoken.startsWith(SPELL)) {
            letters += part
            continue
          }
          if (letters) {
            out.push(spelled(letters))
            letters = ""
          }
          out.push(spoken)
        }
        if (letters) out.push(spelled(letters))
      }
    })
    return out.filter(Boolean).join(" ")
  }

  /** Web and mail addresses, file names and paths: the dots, slashes, underscores and @ are spoken. */
  private address(m: Match): string {
    const whole = m.text
    const text = rstrip(whole, ".,;:!?)")
    const tail = whole.slice(text.length)
    if (m.group("file")) {
      const ending = m.group("ending")!
      const known = this.endings.has(ending.toLowerCase())
      const marked = Boolean(m.group("folder") || m.group("path")) || m.group("stem")!.includes("_")
      if (!(known || (marked && ending.length <= 5 && (islower(ending) || isupper(ending)) && !this.isWord(ending.toLowerCase())))) return whole
    }
    const core = rstrip(text.replace(/^(?:https?:\/\/)?(?:www\.)?/, ""), "/")
    return ` ${this.spokenAddress(core)} ${tail}`
  }

  /** Chat spellings that contain a digit or a slash: gr8, b4, 2day. */
  private chatForm(m: Match): string {
    const said = this.chat.get(m.text.toLowerCase())
    if (said === undefined) return m.text
    if (said === "-") return " "
    return " " + split(said).map((part) => (part.startsWith("*") ? `${SPELL}${part.slice(1)}${END}` : part)).join(" ") + " "
  }

  /** `{...}`: a pronunciation written by the user. Braces that hold anything else stay and are read like brackets. */
  private inlinePronunciation(m: Match): string {
    const symbols = split(m.group(2)!)
    if (!symbols.length || symbols.every((symbol) => len(symbol) === 1 && isascii(symbol))) return m.text
    let phones: Phones
    try {
      phones = isArpabet(symbols) ? convert("", symbols) : fromText(symbols.join(" "))
    } catch (error) {
      if (error instanceof ValueError) return m.text
      throw error
    }
    this.inline.push([m.group(1) || "", phones])
    return ` ${INLINE}${String.fromCodePoint(INLINE_BASE + this.inline.length - 1)}${INLINE} `
  }

  /** `U.S.`, `e.g.`, `p.m.`: letters with full stops. */
  private dotted(m: Match, text: string): string {
    const letters = m.text.replaceAll(".", "")
    const key = letters.toLowerCase()
    const following = lstrip(text.slice(m.end()))
    const words = key === "eg" ? "for example" : key === "ie" ? "that is" : `${SPELL}${letters.toUpperCase()}${END}`
    const endsSentence = !following || startsSentence(following)
    return ` ${words}${endsSentence && m.text.endsWith(".") ? " ." : ""} `
  }

  private abbreviation(m: Match, text: string): string {
    const token = m.group(1)!
    const key = token.toLowerCase()
    const stOrDr = (key === "st" || key === "dr") && isupper(token[0]!)
    const entry = stOrDr ? undefined : this.abbreviations.get(key)
    // Almost every 1–6 letter word is not an abbreviation; bail out before slicing or running lookaround patterns.
    if (!stOrDr && !entry) return m.text
    const stop = m.group(2)!
    const nextWord = ABBR_NEXT_WORD.matchAt(text, m.end())
    const next = nextWord ? nextWord.group(1)! : ""
    const capitalNext = Boolean(nextWord) && isupper(charAt(next, 0))
    if (stOrDr) {
      if (capitalNext && (stop || key === "dr")) return key === "st" ? " saint " : " doctor "
      if (stop && ABBR_CAP_BEFORE.search(text.slice(0, m.start())) !== null) {
        return (key === "st" ? " street" : " drive") + (!strip(text.slice(m.end())) ? " ." : " ")
      }
      return m.text
    }
    const when = entry![0]
    let words = entry![1]
    const numberNext = Boolean(nextWord) && isdigit(next)
    if (when === "title") {
      if (!(isupper(token[0]!) && (capitalNext || stop))) return m.text
    } else if (when === "number") {
      const previous = stop && !numberNext && key === "no" ? ABBR_PREV_WORD.search(text.slice(0, m.start())) : null
      if (!(stop && (numberNext || (key === "no" && previous && NUMBERED.has(previous.group(1)!.toLowerCase()))))) return m.text
    } else if (!stop || (when === "small" && isupper(token))) {
      return m.text
    } else if (AMBIGUOUS_ABBR.has(key) && !isupper(token[0]!) && !numberNext) {
      if (!((key === "max" || key === "min" || key === "est") && nextWord && islower(charAt(next, 0)))) return m.text
    }
    if (key === "est" && !numberNext) words = "estimated"
    const endsSentence = when !== "title" && (!strip(text.slice(m.end())) || (capitalNext && SENTENCE_STARTERS.has(next.toLowerCase())))
    return ` ${words}${endsSentence ? " ." : ""} `
  }

  /** The text with every non-word written out, markers included. */
  rewrite(text: string): string {
    let ascii = isascii(text)
    if (!ascii) {
      text = VULGAR.sub(text, Normalizer.vulgar)
      if (text.includes("²") || text.includes("³")) {
        text = this.area.sub(text, (m) => this.square(m))
        text = text.replaceAll("²", " squared ").replaceAll("³", " cubed ")
      }
      text = text.normalize("NFKC")
      if (text.includes("⁄")) text = text.replaceAll("⁄", "/")
      if (text.includes("−")) text = text.replaceAll("−", " minus ")
      ascii = isascii(text)
      if (!ascii) {
        text = ACCENTED.sub(text, (m) => "{" + ACCENT_DECIDES[m.group(1)!.toLowerCase()]! + (m.group(2) ? " Z" : "") + "}")
        text = chars(text).map(plainLetter).join("")
        ascii = isascii(text)
      }
      if (!ascii && text.includes("–")) text = EN_DASH_NUM.sub(text, "-")
    }
    if (text.includes("-") || (!ascii && text.includes("–"))) text = DAY_RANGE.sub(text, (m) => this.dayRange(m))
    if (!ascii || ASCII_PUNCT_NORM.test(text)) text = text.replace(PUNCT_NORM, (ch) => PUNCT_NORM_MAP[ch]!)
    this.inline = []
    if (text.includes("{") || text.includes("}")) {
      if (text.includes("{") && text.includes("}")) text = INLINE_RE.sub(text, (m) => this.inlinePronunciation(m))
      text = text.replaceAll("{", "(").replaceAll("}", ")")
    }
    if (text.includes(".") || text.includes("://")) text = ADDRESS.sub(text, (m) => this.address(m))
    if (!ascii) {
      if (text.includes("→")) text = text.replaceAll("→", " to ")
      text = EMOJI.sub(text, " ")
    }
    if (HAS_EMOTICON_CHAR.test(text)) text = EMOTICON.sub(text, " ")
    if (text.includes("...")) text = ELLIPSIS_RE.sub(text, "…")
    if (text.includes("-")) {
      if (text.includes("=")) {
        text = NUM_SPACED_MINUS.sub(text, " minus ")
        text = NUM_MINUS.sub(text, (m) => m.group(1)! + " minus ")
      }
      text = DASH_RE.sub(text, "—")
    }
    if (text.includes("/")) {
      text = WITHOUT_RE.sub(text, " without ")
      text = WITH_RE.sub(text, " with ")
      text = NA_RE.sub(text, " not applicable ")
    }
    if (text.includes("'n'")) text = text.replaceAll("'n'", " 'n ")
    if (HAS_COMPARISON.test(text)) text = Normalizer.markComparisons(text)
    if (ascii ? HAS_ASCII_DIGIT.test(text) : HAS_DIGIT.test(text)) text = this.figures(text)
    return this.signs(text)
  }

  /** The passes that need a digit: money, times, dates, telephone numbers, versions, codes, units, fractions, ranges. */
  private figures(text: string): string {
    if (text.includes("$")) text = FORMULA_END.sub(text, (m) => m.text.slice(0, -1) + FORMULA_SIGN)
    if (text.includes(",")) {
      if (text.includes(".")) text = CONTINENTAL.sub(text, Normalizer.continental)
      text = COMMA_AFTER_SIGN.sub(text, (m) => `${m.group(1)}.${m.group(2)}`)
      text = COMMA_BEFORE_SIGN.sub(text, (m) => `${m.group(1)}.${m.group(2)}`)
    }
    if (HAS_MONEY_HINT.test(text)) {
      text = MONEY.sub(text, (m) => this.money(m))
      if (text.includes("-")) text = RANGE_BEFORE_SIGN.sub(text, (m) => `${m.group(1)} to `)
      text = MONEY_AFTER.sub(text, (m) => this.money(m))
    }
    if (text.includes("¢")) {
      text = CENTS_RE.sub(text,
        (m) => ` ${numberWords(m.group(1)!)} ${m.group(1) === "1" ? "cent" : "cents"} `)
    }

    // times of day, lengths of time, ratios
    let hasColon = text.includes(":")
    let hasHalfDay = HAS_HALF_DAY_HINT.test(text)
    if (hasColon || hasHalfDay) text = CLOCK_ZONE_RE.sub(text, (m) => `${m.group(1)} ${spelled(m.group(2)!)}`)
    if (text.includes(".")) {
      if (hasHalfDay) text = DOT_CLOCK_RE.sub(text, (m) => `${m.group(1)}:${m.group(2)}`)
      text = DOT_TIMES_RE.sub(text, (m) => this.dotTimes(m))
      hasColon = text.includes(":")
    }
    if ((hasColon || hasHalfDay) && (text.includes("-") || text.includes("—"))) {
      text = CLOCK_RANGE_RE.sub(text, (m) => `${m.group(1)} to `)
    }
    if (hasColon) {
      text = RATIO.sub(text, (m) => this.ratio(m))
      text = TIME_RE.sub(text, (m) => this.time(m))
      hasHalfDay = HAS_HALF_DAY_HINT.test(text)
    }
    if (hasHalfDay) {
      text = HALF_DAY_RE.sub(text,
        (m) => ` ${cardinal(int(m.group(1)!))} ` + Normalizer.halfDay(m, m.group(2), m.group(3)))
    }

    // dates
    if (text.includes("/")) {
      const seen = SLASH_PAIR_RE.findallGroups(text)
        .map(([a, b]) => [int(a!), int(b!)] as const).filter(([a, b]) => !(a === 24 && b === 7))
      this.dayFirst = seen.some(([a, b]) => a > 12 && 12 >= b) && !seen.some(([a, b]) => b > 12 && 12 >= a)
      this.dated = SLASH_DATED_RE.test(text)
    } else {
      this.dayFirst = false
      this.dated = false
    }
    if (text.includes("-")) {
      text = ISO_DASH_DATE_RE.sub(text,
        (m) => this.date(int(m.group(2)!), int(m.group(3)!), m.group(1)) ?? m.text)
    }
    if (text.includes("/")) {
      text = ISO_SLASH_DATE_RE.sub(text,
        (m) => this.date(int(m.group(2)!), int(m.group(3)!), m.group(1)) ?? m.text)
    }
    if (text.includes(".")) text = DOT_DATE_RE.sub(text, (m) => this.dotDate(m))
    if (text.includes("/")) text = SLASH_DATE_RE.sub(text, (m) => this.slashDate(m))
    if (HAS_MONTH_HINT.test(text)) {
      if (text.includes("-") || text.includes("—")) {
        text = MONTH_RANGE_RE.sub(text, (m) => this.daysOfMonth(m))
        text = RANGE_MONTH_RE.sub(text, (m) => this.daysOfMonth(m))
      }
      text = MONTH_DAY_RE.sub(text,
        (m) => this.date(MONTH_NUMBER.get(m.group(1)!.toLowerCase().slice(0, 3))!, int(m.group(2)!), m.group(3)) ?? m.text)
      text = DAY_MONTH_RE.sub(text, (m) => this.dayMonth(m))
    }

    if (!HAS_DIGIT.test(text)) return text

    // telephone numbers, versions, codes
    if (text.length >= 12) text = PHONE_FULL_RE.sub(text, Normalizer.phone)
    if (text.includes("-")) text = PHONE_LOCAL_RE.sub(text, Normalizer.phone)
    if (text.includes(".")) {
      if (text.indexOf(".") !== text.lastIndexOf(".")) {
        text = VERSION_LONG_RE.sub(text,
          (m) => " " + (m.group(1) ? spelled(m.group(1)!) + " " : "") + m.group(2)!.split(".").map(versionPart).join(" point ")
            + (m.group(3) ? " dash " + numberWords(m.group(3)!) : "") + " ")
      }
      if (text.includes("v") || text.includes("V")) {
        text = VERSION_SHORT_RE.sub(text,
          (m) => ` ${spelled(m.group(1)!)} ${cardinal(bigint(m.group(2)!))} point ${minor(m.group(3)!)} `)
      }
      text = VERSIONED_RE.sub(text, (m) => `${m.group(1)}${m.group(2)}${cardinal(bigint(m.group(3)!))} point ${minor(m.group(4)!)}`
        + (m.group(5) ? `${m.group(5)}${cardinal(bigint(m.group(6)!))} point ${minor(m.group(7)!)}` : "") + " ")
    }
    if (text.includes("-")) text = CODE.sub(text, (m) => this.code(m))
    if (text.includes("/") && text.indexOf("/") !== text.lastIndexOf("/")) {
      text = SLASHED.sub(text, (m) => " " + Normalizer.digitGroups(m.group(1)!.split("/")) + " ")
    }
    if (text.includes(" ")) text = GROUPED.sub(text, (m) => this.grouped(m))

    if (!HAS_DIGIT.test(text)) return text

    if (text.includes("-")) text = NEGATIVE_RE.sub(text, " minus ")
    if (HAS_TIMES_HINT.test(text)) {
      text = DIM_BY_RE.sub(text, " by ")
      text = TIMES_RE.sub(text, " times ")
    }
    text = CHAT_DIGIT_RE.sub(text, (m) => this.chatForm(m))
    if (text.includes("s")) {
      text = DECADE_RE.sub(text,
        (m) => " " + pluralOf(len(m.group(1)!) === 4 ? year(int(m.group(1)!)) : cardinal(int(m.group(1)!))) + " ")
    }
    if (HAS_ORDINAL_HINT.test(text)) text = ORDINAL_RE.sub(text, (m) => ` ${ordinal(bigint(m.group(1)!))} `)
    if (text.includes("p") || text.includes("i")) {
      text = VIDEO_RES_RE.sub(text,
        (m) => ` ${pairs(int(m.group(1)!))} ${spelled(m.group(2)!)} `)
    }
    if (text.includes("%")) text = PERCENT_RE.sub(text, (m) => ` ${numberWords(m.group(1)!)} percent `)
    if (text.includes("2") || text.includes("3")) text = this.areaPlain.sub(text, (m) => this.square(m))
    if (HAS_DIGIT.test(text)) text = this.unit.sub(text, (m) => this.measure(m))
    if (text.includes("/")) {
      text = MIXED_FRAC_RE.sub(text, (m) => this.mixedFraction(m))
      text = FRAC_RE.sub(text, (m) => this.fraction(m))
    }
    if (text.includes("-") || text.includes("–")) {
      text = YEAR_RANGE_RE.sub(text,
        (m) => ` ${year(int(m.group(1)!))} to ${year(int(m.group(2)!))} `)
      text = NUM_RANGE_RE.sub(text,
        (m) => ` ${numberWords(m.group(1)!)} to ${numberWords(m.group(2)!)} `)
    }
    if (text.includes("x")) text = NUM_TIMES_RE.sub(text, (m) => ` ${numberWords(m.group(1)!)} times `)
    if (text.includes("^")) text = POWER_RE.sub(text, " to the power of ")
    return text
  }

  /** Mark the letters that stand for something, to be named: "a=10", "b>a", "(k)". */
  private static namedLetters(text: string): string {
    if (!HAS_MATH_SIGN.test(text)) return text
    const plain = withoutAngles(text)
    const places = new Set<number>()
    for (const pattern of LETTER_PLACES) for (const m of pattern.finditer(plain)) places.add(m.start("letter"))
    if (!places.size) return text
    let out = ""
    for (let k = 0; k < text.length; k++) out += places.has(k) ? `${SPELL}${text[k]!.toUpperCase()}${END}` : text[k]!
    return out
  }

  /** Put the mark for "is" after the first value of each comparison between two values, unless a word that opens
   * no clause stands before that value ("for n > 4"). */
  private static markComparisons(text: string): string {
    const plain = withoutAngles(text)
    return COMPARED.sub(text, (m) => {
      const head = plain.slice(0, m.start())
      const after = plain.slice(m.end())
      const value = VALUE_BEFORE.search(head)
      if (plain[m.start("sign")] !== m.group("sign")![0] || value === null || !VALUE_AFTER.match(after)) return m.text
      let start = value.start()
      if (value.text === ")" || value.text === "]") {
        let depth = 0
        while (start >= 0) {
          const c = head[start]!
          depth += (c === ")" || c === "]" ? 1 : 0) - (c === "(" || c === "[" ? 1 : 0)
          if (depth === 0) break
          start -= 1
        }
        while (start > 0 && (isalnum(charBefore(head, start)) || "_.".includes(head[start - 1]!))) start -= charBefore(head, start).length
      }
      const word = CLAUSE_WORD_RE.search(rstrip(head.slice(0, Math.max(start, 0))))
      if (word && !CLAUSE_OPENERS.has(word.text.toLowerCase())) return m.text
      return IS + m.text
    })
  }

  /** ``words`` for a comparison sign, after "is" where the mark for it stands before the sign. */
  private static compared(m: Match, words: string): string {
    const marked = m.text.startsWith(IS) || rstrip(m.string.slice(0, m.start()), " ").endsWith(IS)
    return ` ${marked ? "is " : ""}${words} `
  }

  /** "b>a", "x<5", "p<.05": the words for "<" and ">" written with no spaces. */
  private static joinedComparisons(text: string): string {
    const plain = withoutAngles(text)
    return JOINED_COMPARISON.sub(text, (m) => {
      const head = rstrip(text.slice(0, m.start()), IS)
      const after = text.slice(m.end())
      if (plain[m.start()] !== m.text) return m.text
      if (!(FIGURE_BEFORE.search(head) || FIGURE_AFTER.match(after) || (LETTER_BEFORE.search(head) && LETTER_AFTER.match(after)))) return m.text
      return Normalizer.compared(m, m.text === "<" ? "less than" : "greater than")
    })
  }

  /** The passes that follow: signs, abbreviations, and the numbers that are left. */
  private signs(text: string): string {
    text = Normalizer.namedLetters(text)
    if (text.includes("<") || text.includes(">")) text = Normalizer.joinedComparisons(text)
    if (text.includes("-")) text = SIZE_RANGE_RE.sub(text, (m) => ` ${spelled(m.group(1)!)} to ${spelled(m.group(2)!)} `)
    if (text.includes("#")) {
      text = HASH_NUM_RE.sub(text, " number ")
      text = HASH_CODE_RE.sub(text, " number ")
      text = HASH_TAG_RE.sub(text, " hashtag ")
    }
    if (text.includes("~")) text = TILDE_ABOUT_RE.sub(text, " about ")
    if (text.includes("=")) text = MULTI_COMP_RE.sub(text, (m) => Normalizer.compared(m, COMPARISONS[m.group(1)!]!))
    if (text.includes(" Ti")) text = GPU_TI_RE.sub(text, ` ${spelled("TI")}`)
    if (text.includes(".") && (text.includes("Ref") || text.includes("ref"))) {
      text = REF_NO_RE.sub(text, (m) => `${m.group(1)}eference number`)
    }
    if (text.includes(".")) {
      const original = text
      text = DOTTED_RE.sub(text, (m) => this.dotted(m, original))
    }
    {
      const original = text
      text = this.abbrRe.sub(text, (m) => this.abbreviation(m, original))
    }
    if (HAS_DIGIT.test(text)) {
      text = GLUED.sub(text, (m) => this.glued(m))
      const original = text
      text = NUMBER_RE.sub(text, (m) => this.number(m, original))
    }
    if (text.includes("/")) text = SLASH_WORD_RE.sub(text, " ")
    if (text.includes("<") || text.includes(">")) {
      text = COMP_ANGLE_RE.sub(text,
        (m) => Normalizer.compared(m, m.text.includes("<") ? "less than" : "greater than"))
    }
    text = SYMBOL_WORDS_RE.sub(text,
      (m) => ("≥≤≠".includes(m.text) ? Normalizer.compared(m, SYMBOL_WORDS[m.text]!) : ` ${SYMBOL_WORDS[m.text]} `))
    return text.includes(IS) ? text.replaceAll(IS, "") : text
  }

  // -- words --

  /** Spellings a word stretched for emphasis may stand for: "sooo" so, "goood" good, "mmm" mm. */
  private static unstretched(word: string): string[] {
    if (!STRETCH_3_RE.search(word)) return []
    const cut = (doubleInside: boolean, doubleFinal: boolean) =>
      STRETCH_RUN_RE.sub(word, (m) => {
        const final = m.end() === word.length
        return m.group(1)!.repeat((final ? doubleFinal : doubleInside) ? 2 : 1)
      })
    const liked = STRETCH_LIKED_RE.search(word) !== null || (word.length > 0 && [...word].every((c) => c === "m"))
      || STRETCH_END_RE.sub(word, (m) => m.group(1)!) === "to"
    return [...new Set([cut(true, liked), cut(true, !liked), cut(false, liked), cut(false, !liked)])]
  }

  /** Tokens for one row of the chat table: words, letters to name, or nothing. */
  private static chatWords(said: string, raw: string): Word[] {
    if (said === "-") return []
    return split(said).map((part) => (part.startsWith("*") ? word(part.slice(1).toLowerCase(), { raw, spell: true }) : word(part.toLowerCase(), { raw: part })))
  }

  /** True when the word at ``place`` is a clause by itself and can be a reply: "k", "k, thanks". */
  private static reply(out: readonly Token[], place: number): boolean {
    const marks: string[] = []
    for (const step of [-1, 1]) {
      let index = place + step
      while (index >= 0 && index < out.length && out[index]!.kind === "punct" && "\"'()".includes((out[index] as Punct).mark)) index += step
      if (!(index >= 0 && index < out.length)) {
        marks.push("")
      } else if (out[index]!.kind === "word") {
        return false
      } else {
        const mark = (out[index] as Punct).mark
        marks.push(mark)
        const beyond = index + step >= 0 && index + step < out.length ? out[index + step]! : null
        if (mark === "," && beyond?.kind === "word" && beyond.text.length === 1 && beyond.text !== "i") return false
      }
    }
    return !(marks[0] === "," && marks[1] === ",")
  }

  /** Tokens for one run of letters and apostrophes as written. */
  private wordTokens(raw: string, allCaps: boolean, previous: string, following = true, fresh = false): Word[] {
    const lower = raw.toLowerCase()
    const chat = this.chat.get(lower)
    if (chat !== undefined && (raw.length > 1 || islower(raw)) && !this.replies.has(lower)) return Normalizer.chatWords(chat, raw)
    if (Object.prototype.hasOwnProperty.call(ROMAN, raw) && previous && isupper(previous[0]!)) {
      const number = ROMAN[raw]!
      const words = CARDINAL_AFTER.has(previous.toLowerCase()) ? cardinal(number) : "the " + ordinal(number)
      return words.split(" ").map((part) => word(part, { raw }))
    }
    const letters = raw.replaceAll("'", "")
    const possessive = lower.endsWith("'s")
    const stem = possessive ? raw.slice(0, -2) : raw
    if (stem.length === 1 && isalpha(stem)) {
      const label = stem === "A" && Boolean(previous) && (!following || (!fresh && LABELLED.has(previous.toLowerCase())))
      if (["a", "A", "I", "i"].includes(stem) && !possessive && !label) return [word(stem.toLowerCase(), { raw })]
      return [word(lower, { raw, spell: true })]
    }
    if (stem.length > 2 && "SsZz".includes(stem[0]!) && new Set(lower).size === 1 && (allCaps || !isupper(stem))) {
      return [word(lower, { raw, phones: [[lower[0]!, 0]] })]
    }
    if (isupper(stem) && isalpha(stem) && stem.length >= 2 && stem.length <= 5 && (!allCaps || !this.isWord(stem.toLowerCase()))) {
      if (INITIALISMS.has(stem) || !this.isWord(stem.toLowerCase())) return [word(lower, { raw, spell: true })]
    }
    if (!isalpha(letters)) return []
    const capitals = CAPITALS_RE.fullmatch(raw) !== null
    if (capitals || !this.isWord(lower)) {
      for (const candidate of capitals ? [] : Normalizer.unstretched(lower)) {
        if (this.isWord(candidate)) return [word(candidate, { raw })]
      }
      const parts = CAMEL_PARTS_RE.findall(raw)
      if (parts.length > 1 && parts.join("") === raw) {
        const out: Word[] = []
        for (const part of parts) {
          const named = capitals && isupper(part) ? INITIALISMS.has(part) : false
          const spell = part.length === 1 || named || (isupper(part) && !this.isWord(part.toLowerCase()))
          const last = out[out.length - 1]
          if (capitals && last && last.spell && (spell || part === "'s")) {
            out[out.length - 1] = { ...last, text: last.text + part.toLowerCase(), raw: last.raw + part }
          } else {
            out.push(word(part.toLowerCase(), { attach: out.length > 0, raw: part, spell }))
          }
        }
        return out
      }
    }
    return [word(lower, { raw })]
  }

  /** Words and punctuation marks of ``text``. */
  tokens(input: string): Token[] {
    const text = this.rewrite(input)
    let runCount = 0
    let upperCount = 0
    ALPHA_RUNS_ASCII.lastIndex = 0
    let rm: RegExpExecArray | null
    while ((rm = ALPHA_RUNS_ASCII.exec(text)) !== null) {
      runCount++
      if (isupper(rm[0]!)) upperCount++
    }
    const allCaps = runCount >= 3 && upperCount >= 0.6 * runCount
    const out: Token[] = []
    let attach = false
    let previous = ""
    let fresh = true
    const short: number[] = []
    const replies: number[] = []
    for (const m of TOKEN.finditer(text)) {
      const spelledLetters = m.group(1)
      const inline = m.group(2)
      const raw = m.group(3)
      const number = m.group(4)
      const hyphen = m.group(5)
      const other = m.group(6)
      const before_ = m.start() ? charBefore(text, m.start()) : " "
      if (hyphen) {
        attach = out.length > 0 && out[out.length - 1]!.kind === "word" && !isspace(before_) && m.end() < text.length && isalnum(charAt(text, m.end()))
        continue
      }
      let fresh_: Token[] = []
      if (spelledLetters !== undefined) {
        fresh_ = [word(spelledLetters.replaceAll(" ", "").toLowerCase(), { raw: spelledLetters, spell: true })]
      } else if (inline !== undefined) {
        const entry = this.inline[inline.codePointAt(0)! - INLINE_BASE]
        if (entry) {
          const [written, phones] = entry
          fresh_ = [word(written.toLowerCase(), { raw: written, phones })]
        }
      } else if (raw !== undefined) {
        let spelling = raw
        if (spelling.startsWith("'") && !LEADING_APOSTROPHE.has(spelling.toLowerCase())) {
          out.push(punct("'"))
          spelling = spelling.slice(1)
        } else if (spelling.startsWith("'") && !this.isWord(spelling.toLowerCase())) {
          spelling = spelling.slice(1)
        }
        const afterIndex = m.end()
        fresh_ = this.wordTokens(spelling, allCaps, previous, AFTER_LETTER_RE.matchAt(text, afterIndex) !== null, fresh)
        previous = spelling
        if ((spelling === "Ss" || spelling === "ss" || spelling === "Zz" || spelling === "zz") && fresh_.length === 1 && (isspace(before_) || "\"'(".includes(before_))
            && SHORT_FOLLOW_RE.matchAt(text, afterIndex)) short.push(out.length)
        if (this.replies.has(spelling.toLowerCase()) && (spelling.length > 1 || islower(spelling)) && fresh_.length === 1
            && (isspace(before_) || "\"'".includes(before_))
            && REPLY_FOLLOW_RE.matchAt(text, afterIndex)) replies.push(out.length)
      } else if (number !== undefined) {
        fresh_ = numberWords(number).split(" ").map((part) => word(part, { raw: number }))
      } else if (PUNCTUATION_SET.has(other!)) {
        if (!(other === "'" && isalnum(before_) && m.end() < text.length && isalnum(charAt(text, m.end())))) out.push(punct(other!))
        if (".!?;…".includes(other!)) fresh = true
        attach = false
        continue
      }
      if (fresh_.length && attach) fresh_[0] = { ...(fresh_[0] as Word), attach: true }
      for (let i = 0; i < fresh_.length; i++) out.push(fresh_[i]!)
      attach = false
      fresh = fresh && !fresh_.length
    }
    // "Ss!" and "Sh, ss, tsk" are a hiss; beside an ordinary word the two letters stay letters.
    const isBracket = (token: Token) => token.kind === "punct" && "\"'()".includes(token.mark)
    for (const place of short) {
      let first = place
      let last = place + 1
      while (first && (out[first - 1]!.kind === "word" || isBracket(out[first - 1]!))) first--
      while (last < out.length && (out[last]!.kind === "word" || isBracket(out[last]!))) last++
      if (out.slice(first, last).every((token) => token.kind !== "word" || SOUNDS.has(token.text) || (token.phones !== null && new Set(token.text).size === 1))) {
        const token = out[place] as Word
        out[place] = { ...token, phones: [[token.text[0]!, 0]] }
      }
    }
    // "k" is "okay" as a reply by itself; beside a word or a figure it is the letter.
    for (const place of [...replies].reverse()) {
      if (Normalizer.reply(out, place)) {
        const raw = (out[place] as Word).raw
        out.splice(place, 1, ...Normalizer.chatWords(this.chat.get(raw.toLowerCase())!, raw))
      }
    }
    return out
  }
}
