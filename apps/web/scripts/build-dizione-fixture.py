"""Writes tests/fixtures/dizione.json: what the Python dizione gives for a few thousand varied texts, the reference
the TypeScript port in src/server/voice/dizione is tested against (tests/dizione.test.ts).

Needs Python 3.10+ with numpy and dizione installed at the commit the port follows (src/server/voice/dizione/data.ts
names it), and DIZIONE_DATA pointing at tiny-voca's phonemizer/ files at the pinned revision:

    pip install numpy "dizione @ git+https://github.com/n4ze3m/dizione@<commit>"
    DIZIONE_DATA=/path/to/phonemizer python scripts/build-dizione-fixture.py /path/to/dizione /path/to/tiny-voca/README.md

The first argument is a checkout of dizione at that commit (its tests supply inputs), the second tiny-voca's model card.
Each case is [text, result]: the symbols with their stress marks (str(result)), null where tiny-voca's web demo
returns null (nothing to pronounce), or "!" and the exception's name where dizione raises.
"""

import ast
import json
from pathlib import Path
import random
import subprocess
import sys

import dizione

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests" / "fixtures" / "dizione.json"


def result(text):
    try:
        return str(dizione.phonemize(text))
    except ValueError as error:
        try:
            if any(word for mark, words in dizione.pieces(text) if not mark for word in words):
                return "!" + type(error).__name__
        except Exception as inner:
            return "!" + type(inner).__name__
        return None
    except Exception as error:
        return "!" + type(error).__name__


def from_dizione_tests(checkout):
    lines = (checkout / "tests" / "data" / "tricky_sentences.txt").read_text(encoding="utf-8").splitlines()
    out = [line.split(":", 1)[1].strip() for line in lines if line.startswith("TEXT:")]
    out += [line for line in lines if line.strip()]
    tree = ast.parse((checkout / "tests" / "test_dizione.py").read_text(encoding="utf-8"))
    out += [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.strip()]
    return out


def from_prose(*paths):
    out = []
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("<audio"):
                out.append(line)
    return out


HAND = """
Hello! This is tiny voca, a small text to speech model that runs on a phone or in a browser.
The meeting moved to 3:30 pm on March 14th, so we have about 45 minutes left.
Did you really think I would forget your birthday?
She had never seen the sea before, and for a long while she stood at the edge of the water without saying a word.
I read the book yesterday, and I will read it again tomorrow.
The lead singer will lead the band through the lead-lined tunnel.
He plays the bass; she caught a bass.
Please record the record before the record store closes.
I want to present the present to the president at present.
They live near the venue where the band plays live.
The wind was too strong to wind the kite string.
A tear rolled down her cheek as she saw the tear in the paper.
I object to that object being here.
Close the door, it's close to midnight.
What's the use? I use it every day.
Excuse me, there's no excuse for that.
Wait a minute, that's a minute detail.
He wound the bandage around the wound.
Take a bow, then tie a bow.
Does he know the does are in the field?
They had a row about who would row the boat.
Sow the seeds, then feed the sow.
I'm content with the content.
Don't desert me in the desert.
They refuse to collect the refuse.
The invalid's ID was invalid.
Polish the Polish silverware.
Produce the produce by Monday.
You need a permit; we permit it.
Their conduct showed how to conduct business.
The dove dove into the bushes.
He shed a tear and the tears kept coming.
I separate the separate piles.
We estimate the estimate is high.
The project will project its future.
They increase the increase every year.
The rebels rebel against the rule.
Use the subject line to subject them to tests.
Moped riders moped around all day.
A learned man learned to read.
She was blessed with a blessed life.
The convict was convicted.
Insert the insert into the slot.
Contract the contract terms.
Export the export data.
Address the address on the envelope.
The suspect was suspected of fraud.
Graduate from graduate school.
Alternate between the alternate routes.
Attribute it to the attribute field.
Combine the combine harvester parts.
Perfect: let us perfect it.
Coordinate the coordinate system.
Invite them; send the invite.
Upset the upset team.
Okafor and Nguyen met Siobhan and Kayleigh at the cafe.
Ryleigh, Xiomara and Aoife are coming too.
The coronavirus and the rhinovirus are different viruses.
My iPhone, my MacBook and my eSIM work with macOS and iOS.
I watched it on YouTube and wrote it in JavaScript and TypeScript.
Run kubectl apply, then restart nginx and PostgreSQL.
The colour of the organisation's theatre programme is grey.
Have you analysed the catalogue of travellers' cheques?
The sandpiper landed near the houseplant.
Supercalifragilisticexpialidocious is a made-up word.
Gloobinate the frizzlewump before the snargle quoffs.
Zyxwv qwrtp blorf, mrrrph.
Antidisestablishmentarianism is long.
Pneumonoultramicroscopicsilicovolcanoconiosis.
Floccinaucinihilipilification.
Tung tung tung sahur is a meme.
The ss was written as 'ss' in the text.
Sh! Ss! Tsk!
Zzzz... he's asleep.
Sssss, said the snake.
Hmmm, I'm not sure.
Mmm, that's delicious.
Soooo good! Goooood morning! Heyyy! Alllll of it. Offff.
It's sooooo cooool.
k
k, thanks
see you there, k?
i, j, k
the value of k
8 k
K.
OK, ok, Ok.
lol that's so funny
omg wtf brb ttyl idk imo tbh
gr8 job, see u l8r, b4 2day
u r the best
thx, np, pls, plz
xD :) :( ;-) :P <3 </3 ^_^ -_- o_O >_< T_T \\o/ :'(
I love you<3
y=(a+b)
=( that's sad
😂😂😂
👍🏽 Great job! 🎉
🇺🇸 🇬🇧 ❤️ ☀️ ✨
The weather is ☀️ today.
→ next step
It costs $3.14, including tax.
She paid $1,250.50 for it.
It's €12,50 or 0,99 € or 1.299,50 €.
The price is £5 or 50p.
That's ¥1000 or ₹500.
They raised $5k, then $2.5 million, then $1bn.
It dropped -$40 today.
Gas is 99¢ a gallon.
It's 20€ or 20 € or 12.50 EUR or 750 000 $.
Prices from $5 to 30$.
The CHF 100 note and CAD 50 and AUD 20 and CNY 88.
USD 1,000,000 is a lot.
It costs 5-10 €.
$x = 2$ and $3 + 5 = 8$.
I have 1,234,567 apples.
Pi is 3.14159.
The code is 007.
It's 0.5 or .5 or 5.0.
Negative -42 and minus 7.
We need 100%, not 3,5% or 99.9%.
I was born in 1984 and moved in 2005.
In 1905, 1900, 2000, 2026 and 1066.
The 1990s and the '80s and the 60s.
He finished 1st, 2nd, 3rd, 4th, 21st, 22nd, 101st, 111th.
Add 1/2 cup and 3/4 teaspoon and 2 1/2 cups.
It's 1/3 or 2/3 or 7/10 or 5/100 or 24/7.
½ cup, 1½ cups, ¾ mile, ⅛ inch.
50/50 chance.
Pages 10-15 and years 2019-2021.
Chapter 11, World War II, Henry VIII, Super Bowl LVII.
Call me at 555-1234.
Call (555) 123-4567 or +1 555 123 4567.
Dial +44 20 7946 0958.
Call 911 or 9-1-1.
My PIN is 4821 and the code is 0042.
Order #12345 and ticket 98765.
Ref. No. 4471 and account number 123456789.
The tracking number is 1Z 999 AA1 01 2345 6784.
Card 4111 1111 1111 1111 expires 08/27.
Your OTP is 839201.
Enter 2024 in the box.
The population is 1 000 000.
Code AB-4471-Z and 91-220-0017 and #A7-4419.
B-12, COVID-19, F-16s, SAVE-20, Wi-Fi, 3-in-1, 50s-60s.
The X7K and PS5 and B12 and 14C.
I bought an RTX 4070 Ti and ISO 9001.
Watch it in 1080p or 4K or 720p.
The meeting is at 3:30 pm EST.
Lunch at 12:00, dinner at 20:00, midnight at 00:00.
It lasted 2:03:45 and the video was 48:12 long.
Open 9.30 to 11.30 and 7.30pm.
The shop is open 10am-2pm.
Train leaves at 5:45:30.
See you at 7 a.m. Then we leave.
It's 6 p.m. and the sun is setting.
Mon-Fri and Mon.-Fri. and Jan-Mar.
On 14/03/2026 and 03/14/2026 and 2026-11-15 and 15.11.2026.
On March 14, 2026 and 5 Jan. 2026 and 22 February.
From 3-17 November and November 3-17, 2026.
Due 12/10 and 14/03.
The ratio is 16:9 or 3:1 or 1:25,000.
The score was 3:2.
It weighs 5 kg or 3.5kg or 1,5 kg.
Run 5 km at 60 mph or 100 km/h.
It's 20°C or 68°F or 20 °C.
The room is 120 m² and the tank is 3 m3.
A 5 m rope and a 5 M budget.
Measure 3 x 4 metres or 3 × 4 m.
It takes 10-20 mins.
The screen is 1920x1080 pixels.
I have 2 GB of RAM and a 1 TB drive at 3.5 GHz.
Take 500 mg twice a day.
It's 5ft 10in tall.
Use 2 tsp sugar and 1 tbsp oil.
A 9V battery and 60W bulb and 5 MW plant and 2 ha farm.
Update to version 3.12 or v2.3.1 or 1.2.3-4.
Install Python 3.11 and Node 20.10 on iOS 17.4.
Upgraded from 4.10 to 5.02.
Visit https://example.com/path?x=1&y=2 or www.github.com.
Email jane.doe@gmail.com or support@dex.example.org.
Open notes.txt and report_2026.pdf and index.html.
Run /usr/local/bin/python3 then ./build.sh.
See docs/design.md and src/server/voice/tiny-voca.ts.
The end.Then he left.
Dr. Smith lives on Main St. near St. Louis.
Mr Jones and Mrs. Brown met Prof. Green.
Use e.g. apples, i.e. fruit.
The U.S. and the U.K. and the E.U.
Meet at 10 a.m. sharp.
See No. 5 on p. 12.
Apples, oranges, etc. are fruit.
Lakers vs. Celtics.
It's approx. 5 miles.
Est. 1885. Est. arrival is noon.
The max. load is high.
He sat. She ran.
NASA and the FBI and the CIA.
THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.
IT IS AN AI ID FOR THE US.
I'M SO HAPPY RIGHT NOW!!!
The LED light and the SAT test.
a=10, b>a, x < 5, 67 > 66.
f(x) >= 0 and g(x) <= 1 and a != b.
For n > 4, any q > 0, an integer k ≥ 2.
See if b>a.
k = k + 1
mode = a set of notes
(a), f(a, b), f(b, a)
a) the first point
2^10 and 3 × 4 and 10 ÷ 2 and 5 ± 1.
10-3=7 and 10 - 3 = 7.
p<.05 and x<5 and File>Open.
<b>bold</b> and Vec<u64> and map<int, int> and <your name>.
x_{i} and {n} and {1, 2, 3} and \\frac{1}{2}.
Say {HH AH0 L OW1} to them.
Say tomato{t ə m ˈɑː t oʊ} please.
Say {h ə l ˈoʊ} and {XYZ}.
résumé, resumé, exposé, rosé, pâté, café, naïve, façade, jalapeño.
Straße, Æsir, œuvre, Øresund, Łódź, Đorđe.
"Quoted," she said. 'Single quoted.'
“Smart quotes” and ‘smart single’ and «guillemets».
Wait... what? Really?! No!!!
Well -- I think - maybe.
He said—quietly—that it was over.
(Parentheses) and [brackets] and {braces}.
Semi; colon: dash – em — ellipsis …
'em, 'tis, 'twas, 'til, 'cause, 'bout, 'round, rock 'n' roll.
It's the dog's bone and the dogs' bones.
James's car and Chris' hat.
w/o sugar, w/ milk, n/a.
and/or, either/or, he/she.
Section § 5, © 2026, ∞ loop, √ 2, π r².
~5 minutes and ≈ 10 seconds.
Hashtag #blessed and #1 and #A7.
XS-XL sizes.
The temperature is −5 degrees.
Bonjour, je m'appelle Marie et j'habite à Paris.
Hola, ¿cómo estás? Estoy bien, gracias.
Guten Tag! Wie geht's? Ich heiße Jürgen.
Привет, как дела?
Γεια σου κόσμε.
你好，世界。
こんにちは世界
مرحبا بالعالم
नमस्ते दुनिया
안녕하세요
שלום עולם
Merhaba dünya, nasılsın? Iğdır ılık.
Xin chào thế giới.
٣ تفاحات و ١٢٣ برتقالة
१२३ और ४५६
The year ٢٠٢٦ is here.
Ｆｕｌｌｗｉｄｔｈ ｔｅｘｔ ａｎｄ １２３
ﬁne ﬂour and ﬀ.
…
...
!!!
???
—
"
()
😂
:)
1
0
42
1000000000000000000000000
123456789012345678901234567890
3.14159265358979323846
""".strip("\n").split("\n")

WORDS = """the a an and or but if then so because when where while of to in on at by for from with about into over under
time person year way day thing man world life hand part child eye woman place work week case point government company
number group problem fact be have do say get make go know take see come think look want give use find tell ask work
seem feel try leave call good new first last long great little own other old right big high different small large next
early young important few public bad same able water river mountain forest city village garden kitchen window door
music song story letter phone computer screen keyboard model voice sound speech word sentence paragraph chapter book
quickly slowly happily really very quite rather almost always never sometimes often usually perhaps maybe probably
""".split()
NAMES = "Alice Bob Carol Dave Eve Frank Grace Heidi Ivan Judy Mallory Niaj Olivia Peggy Rupert Sybil Trent Victor Walter Zoe Okonkwo Nakamura Ferreira Kowalski Haddad Ivanova".split()
PLACES = "London Paris Tokyo Lagos Mumbai Sydney Toronto Berlin Nairobi Lima Oslo Seoul Cairo Dublin Austin".split()
UNITS = "km kg cm mm ml mg kb mb gb tb hz khz mhz ghz kw kwh lb lbs oz ft mi min mins hr hrs sec secs ms mph kph km/h °c °f m/s yd nm μm μg mcg mah hp tsp tbsp db kcal px rpm bpm fps mpg psi kbps mbps gbps yr yrs wk wks m g l L h V W MW p ha".split()
CHAT = "lol lmao rofl omg omfg wtf wth brb btw idk imo imho tbh smh fyi asap ttyl np thx ty pls plz gr8 b4 2day 2moro l8r k ok u r ur ya yep nope gonna wanna gotta".split()
HOMOGRAPHS = "read lead bass record present live wind tear object close use excuse minute wound bow does row sow content desert refuse invalid polish produce permit conduct dove separate estimate project increase rebel subject moped learned blessed convict insert contract export address suspect graduate alternate attribute combine perfect coordinate invite upset abuse advocate associate compound conflict contest contrast convert decrease defect delegate discount document duplicate elaborate entrance escort exploit expose extract frequent impact import incline insult intimate moderate permit progress protest recount refund reject resume transport".split()
EMOJI = ["😂", "👍", "🎉", "❤️", "🔥", "🙏🏽", "😅", "✅", "⭐", "🇫🇷", "👨‍👩‍👧"]
EMOTICONS = [":)", ":(", ";)", ":D", ":P", "<3", "xD", ":-)", "^_^", ":'("]
# Characters and fragments that test the edges: digits of other scripts, letters Python's rules treat specially,
# spaces and line breaks, signs.
ODD = ["٣", "١٢٣", "१२", "𝟏𝟐", "𞥑𞥒", "𐒡", "፩", "²", "³", "¹", "①", "ı", "İ", "ſ", "K", "µ", "Μ", "ß", "ẞ", "ǅ", "ﬁ", "Ⅻ", "𝐀𝐁",
       "𠀀", "😀", "\u00a0", "\u2009", "\u3000", "\u200b", "\ufeff", "\x85", "\x1c", "\u2028", "\t", "\n", "\r\n", "  ", "<", ">", "=",
       "+", "*", "/", "^", "(", ")", "[", "]", "{", "}", "$", "%", "&", "@", "#", "~", "-", "–", "—", "…", "'", "’", '"', "“", "”",
       ":", ";", ",", ".", "!", "?", "_", "|", "\\", "a", "A", "k", "u", "r", "I", "x", "Ss", "zz", "mm", "St", "Dr", "No", "est",
       "max", "vs", "etc", "e.g.", "U.S.", "p.m.", "AM", "PM", "IT", "US", "iOS", "eSIM", "McDonald", "O'Neil", "rock'n'roll", "≥",
       "≤", "≠", "≈", "×", "÷", "±", "°", "©", "§", "∞", "√", "π", "→", "½", "¾", "⅓", "−", "⁄", "¢", "€", "£", "¥", "₹", "x²", "m³",
       "km²", "10³", "www.door.org/፩", "\ua7f1", "\u1c89", "\U0002ebf0", "\U000116d1\U000116d2", "5\U000116d3", "\U000105c0"]
SYLLABLES = "ka lo mi zu re ta vin quor blee snar flim gax thro pud wex yil zon brak chim dros fen glo hul jix kroo lum nep ovo plin qua rix sul tev ump vosh wim xan yorb zeb".split()


def made_up(rng):
    return "".join(rng.choice(SYLLABLES) for _ in range(rng.randint(2, 4)))


def number(rng):
    kind = rng.randint(0, 12)
    if kind == 0:
        return str(rng.randint(0, 20))
    if kind == 1:
        return str(rng.randint(21, 999))
    if kind == 2:
        return f"{rng.randint(1000, 99999999):,}"
    if kind == 3:
        return f"{rng.uniform(0, 1000):.{rng.randint(1, 4)}f}"
    if kind == 4:
        return str(rng.randint(1000, 9999))
    if kind == 5:
        return str(rng.randint(10 ** 5, 10 ** 12))
    if kind == 6:
        return "-" + str(rng.randint(1, 500))
    if kind == 7:
        return f"{rng.randint(1, 99)}%"
    if kind == 8:
        n = rng.randint(1, 120)
        return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
    if kind == 9:
        return f"{rng.randint(1, 9)}/{rng.choice([2, 3, 4, 5, 8, 10, 12, 16, 100, 7])}"
    if kind == 10:
        return f"{rng.randint(1, 50)}-{rng.randint(51, 99)}"
    if kind == 11:
        return "0" + str(rng.randint(1, 9999))
    return str(rng.randint(1, 10 ** rng.randint(13, 30)))


def money(rng):
    amount = rng.choice([str(rng.randint(1, 999)), f"{rng.randint(1, 9999):,}", f"{rng.uniform(0, 500):.2f}", f"{rng.uniform(0, 9):.1f}"])
    form = rng.randint(0, 6)
    sign = rng.choice("$£€¥₹")
    if form == 0:
        return sign + amount
    if form == 1:
        return amount + " " + sign
    if form == 2:
        return rng.choice("USD EUR GBP JPY INR CHF CAD AUD CNY".split()) + " " + amount
    if form == 3:
        return sign + amount + rng.choice(["k", "m", "bn", " million", " billion", "K", "M"])
    if form == 4:
        return "-" + sign + amount
    if form == 5:
        return amount.replace(".", ",") + " €"
    return f"{rng.randint(1, 99)}¢"


def date(rng):
    month, day, year = rng.randint(1, 12), rng.randint(1, 31), rng.randint(1890, 2099)
    names = "January February March April May June July August September October November December".split()
    form = rng.randint(0, 9)
    if form == 0:
        return f"{names[month - 1]} {day}, {year}"
    if form == 1:
        return f"{day}/{month}/{year}"
    if form == 2:
        return f"{month}/{day}/{str(year)[2:]}"
    if form == 3:
        return f"{year}-{month:02d}-{day:02d}"
    if form == 4:
        return f"{day:02d}.{month:02d}.{year}"
    if form == 5:
        return f"{day} {names[month - 1][:3]}. {year}"
    if form == 6:
        return f"{names[month - 1]} {day}th"
    if form == 7:
        return f"{day}-{min(31, day + rng.randint(1, 9))} {names[month - 1]}"
    if form == 8:
        return f"{rng.choice(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])}-{rng.choice(['Fri', 'Sat', 'Sun'])}"
    return f"the {str(year)[:3]}0s"


def clock(rng):
    hour, minute = rng.randint(0, 23), rng.choice([0, 5, 15, 30, 45, rng.randint(0, 59)])
    form = rng.randint(0, 6)
    if form == 0:
        return f"{hour}:{minute:02d}"
    if form == 1:
        return f"{rng.randint(1, 12)}:{minute:02d} {rng.choice(['am', 'pm', 'a.m.', 'p.m.', 'AM', 'PM'])}"
    if form == 2:
        return f"{rng.randint(1, 12)}{rng.choice(['am', 'pm'])}"
    if form == 3:
        return f"{rng.randint(1, 12)}.{rng.choice(['00', '15', '30', '45'])} to {rng.randint(1, 12)}.{rng.choice(['00', '30'])}"
    if form == 4:
        return f"{hour}:{minute:02d}:{rng.randint(0, 59):02d}"
    if form == 5:
        return f"{rng.randint(1, 12)}:{minute:02d} {rng.choice(['EST', 'PST', 'GMT', 'UTC', 'CET'])}"
    return f"{rng.randint(25, 99)}:{rng.randint(0, 59):02d}"


def measure(rng):
    value = rng.choice([str(rng.randint(1, 500)), f"{rng.uniform(0, 100):.1f}", "1", f"{rng.randint(1, 9)},{rng.randint(1, 9)}"])
    return value + rng.choice(["", " "]) + rng.choice(UNITS)


def code(rng):
    letters = lambda n: "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(n))
    digits = lambda n: "".join(rng.choice("0123456789") for _ in range(n))
    return rng.choice([
        f"{letters(2)}-{digits(4)}-{letters(1)}", f"{letters(1)}-{digits(2)}", f"#{letters(1)}{digits(1)}-{digits(4)}",
        f"{letters(1)}{digits(rng.randint(1, 4))}", f"{digits(2)}{letters(1)}", f"{digits(3)}-{digits(3)}-{digits(4)}",
        f"+{digits(2)} {digits(2)} {digits(4)} {digits(4)}", f"order #{digits(5)}", f"PIN {digits(4)}",
        f"call {digits(3)}-{digits(4)}", f"v{digits(1)}.{digits(1)}.{digits(2)}", f"version {digits(1)}.{digits(2)}",
        f"{letters(3)} {digits(4)}", f"{digits(4)} {digits(4)} {digits(4)} {digits(4)}", f"ref {digits(8)}",
    ])


def address(rng):
    word = lambda: rng.choice(WORDS + [made_up(rng)])
    return rng.choice([
        f"https://{word()}.com/{word()}", f"www.{word()}.org", f"{word()}.{word()}@{word()}.net", f"{word()}_{rng.randint(1, 99)}.pdf",
        f"/home/{word()}/{word()}.txt", f"{word()}.{rng.choice(['json', 'md', 'py', 'ts', 'png', 'docx', 'xyz'])}",
        f"http://localhost:{rng.randint(1000, 9999)}/{word()}", f"{word()}.io",
    ])


def piece(rng):
    kind = rng.randint(0, 15)
    if kind <= 3:
        return " ".join(rng.choice(WORDS) for _ in range(rng.randint(1, 5)))
    return [lambda: number(rng), lambda: money(rng), lambda: date(rng), lambda: clock(rng), lambda: measure(rng), lambda: code(rng),
            lambda: address(rng), lambda: rng.choice(NAMES + PLACES), lambda: rng.choice(CHAT), lambda: rng.choice(HOMOGRAPHS),
            lambda: made_up(rng), lambda: rng.choice(EMOJI + EMOTICONS)][kind - 4]()


def sentence(rng):
    parts = [piece(rng) for _ in range(rng.randint(2, 8))]
    text = ""
    for part in parts:
        text += (rng.choice([" ", " ", " ", ", ", "; ", " - ", " (", ") ", ": ", " — ", "... ", " / ", " & "]) if text else "") + part
    text = text[0].upper() + text[1:] if rng.random() < 0.8 else text
    return text + rng.choice([".", ".", "?", "!", "", "...", "!!", "?!", '."', ")"])


def homograph_sentences(rng):
    frames = ["I {w} it.", "They {w} the {x}.", "The {w} was {x}.", "We will {w} that.", "Did you {w} the {x}?", "A {w} of {x}.",
              "She {w}s every day.", "The {w}s are here.", "To {w} or not to {w}.", "His {w} is {x}.", "It's a {w}-free {x}.",
              "Please {w} the {x} now.", "You can't {w} it.", "That {w} was a {x}."]
    return [rng.choice(frames).format(w=rng.choice(HOMOGRAPHS), x=rng.choice(WORDS)) for _ in range(500)]


def odd(rng):
    parts = []
    for _ in range(rng.randint(1, 10)):
        roll = rng.random()
        parts.append(piece(rng) if roll < 0.5 else rng.choice(ODD) if roll < 0.8 else str(rng.randint(0, 10 ** rng.randint(1, 8)))
                     if roll < 0.9 else rng.choice(HAND))
    return "".join(part + rng.choice(["", " ", " ", " ", ", ", ". ", "-", "/", ":"]) for part in parts)


def generated(rng):
    out = [sentence(rng) for _ in range(1800)]
    out += homograph_sentences(rng)
    out += [" ".join(made_up(rng) for _ in range(rng.randint(1, 4))) + "." for _ in range(300)]
    out += [f"{rng.choice(NAMES)} said {piece(rng)} to {rng.choice(NAMES)} in {rng.choice(PLACES)}." for _ in range(200)]
    out += [" ".join(sentence(rng) for _ in range(rng.randint(3, 6))) for _ in range(100)]
    out += [odd(rng) for _ in range(800)]
    return out


def main():
    checkout, card = Path(sys.argv[1]), Path(sys.argv[2])
    rng = random.Random(15112026)
    inputs = HAND + from_dizione_tests(checkout) + from_prose(card, checkout / "README.md", checkout / "docs" / "design.md") + generated(rng)
    seen, cases = set(), []
    for text in inputs:
        if text not in seen:
            seen.add(text)
            cases.append([text, result(text)])
    installed = Path(dizione.__file__).parent
    for path in sorted((checkout / "src" / "dizione").glob("*.py")) + sorted((checkout / "src" / "dizione" / "data").glob("*.txt")):
        if (installed / path.relative_to(checkout / "src" / "dizione")).read_bytes() != path.read_bytes():
            sys.exit(f"the installed dizione differs from the checkout in {path.name}")
    commit = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as file:
        file.write('{"dizione": ' + json.dumps(commit) + ', "cases": [\n' + ",\n".join(json.dumps(case, ensure_ascii=False) for case in cases) + "\n]}\n")
    print(f"{len(cases)} cases, {sum(case[1] is None for case in cases)} null, "
          f"{sum(isinstance(case[1], str) and case[1].startswith('!') for case in cases)} errors -> {OUTPUT}")


if __name__ == "__main__":
    main()
