// CASING, the number rule (Dave 2026-08-20: "If a number leads a line the
// first letter after should be capitalized").
//
// A number cannot be capitalized, so when one leads a line it hands its edge
// slot to the word behind it. "14 emails need you" read as a fragment someone
// forgot to finish; "14 Emails Need You" reads as a heading, which is what it
// is. The same applies after a middle-dot break, since the catalog already
// treats each dot segment as its own line.
//
// This is deliberately NOT applied at render time. Magic in the stylesheet or
// in a wrapper component cannot be tested and drifts the moment someone
// renders the same string somewhere else. The string builders own their own
// casing, and the law test scans for literals that break the rule.

const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "per", "the", "to", "with"]);

// A "number word": 14, 1st, $500, 3x, 55. Leading punctuation counts as part
// of it so "$500 of $2,000 saved" is treated as number-led too.
const NUMBER_WORD = /^[^A-Za-z]*\d[\d.,:/$%x-]*$/;

function capFirst(w: string): string {
  const i = w.search(/[A-Za-z]/);
  return i < 0 ? w : w.slice(0, i) + w[i]!.toUpperCase() + w.slice(i + 1);
}

// Capitalize the word that follows a leading number, in every dot segment.
//
// One exception, and it is the only one: a small connecting word sitting
// BETWEEN two numbers is part of a compound quantity, not a sentence start.
// "2 of 5 done" is one measurement and reads as "2 of 5 Done"; "88 at the
// peak" is a line and reads as "88 At the peak".
//
// Everything else is left exactly as the caller wrote it: this rule adds a
// capital, it never lowercases and never re-cases mid-sentence words.
export function capAfterNumber(text: string): string {
  return text
    .split("\u00b7")
    .map((seg) => {
      const m = seg.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!m) return seg;
      const [, pre, body, post] = m;
      const words = (body ?? "").split(/\s+/);
      if (words.length < 2 || !NUMBER_WORD.test(words[0] ?? "")) return seg;
      for (let i = 1; i < words.length; i++) {
        const w = words[i] ?? "";
        if (NUMBER_WORD.test(w)) continue; // still inside the quantity
        const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
        // A small word joining two numbers ("2 of 5") is part of the
        // quantity; a small word followed by anything else starts the line.
        if (bare && SMALL.has(bare) && NUMBER_WORD.test(words[i + 1] ?? "")) continue;
        words[i] = capFirst(w);
        break;
      }
      return (pre ?? "") + words.join(" ") + (post ?? "");
    })
    .join("\u00b7");
}

// Title Case per the app convention, number-aware: small words stay lowercase
// mid-title, first and last word always capitalized, and a leading number
// passes its edge to the next word. Existing capitals inside a word are kept
// (AA1187 stays AA1187, JARVIS stays JARVIS).
export function titleCase(text: string): string {
  const words = text.trim().split(/\s+/);
  const firstWord = NUMBER_WORD.test(words[0] ?? "") && words.length > 1 ? 1 : 0;
  return words
    .map((w, i) => {
      const isEdge = i === firstWord || i === 0 || i === words.length - 1;
      const lower = w.toLowerCase();
      if (!isEdge && (SMALL.has(lower) || SMALL_FORMS.has(lower))) return lower;
      if (ownSpelling(w)) return w;
      return capFirst(w);
    })
    .join(" ");
}

// A WORKOUT'S OWN NAME, AS THE APP PRINTS IT (Dave 2026-09-17, photographing
// a program whose days read "Push Day 1", "Leg Day", "Pull day 2": "all
// workout titles should be title cased as well").
//
// These names are typed by hand, in a hurry, usually on a phone at the gym,
// so they arrive in whatever case the keyboard felt like. The app's own
// labels have been Title Case since catalog V3.1, which meant one row in a
// list of six looked like a mistake next to its neighbours.
//
// It runs in TWO places on purpose:
//
//   - at the WRITE DOOR, so the store converges on the cased spelling and
//     anything reading the raw name later agrees with the screen;
//   - at the READ, so a name typed months before this shipped reads right
//     today instead of waiting to be edited.
//
// titleCase is idempotent, so running both is not a bug, and it keeps
// capitals that are already inside a word (RDLs stays RDLs, AMRAP stays
// AMRAP) rather than flattening an acronym on the way past.
export function workoutTitle(name: string): string {
  return titleCase(name);
}

// AN EXERCISE'S OWN NAME, AS THE APP PRINTS IT (Dave 2026-09-17, on a library
// reading "Bulgarian split squats / Calf raise machine / Glute kickbacks":
// "Case those too").
//
// This one is deliberately separate from workoutTitle, because it carries a
// risk that one does not. An exercise's name is its IDENTITY: a lift with no
// exerciseKey is matched by `fallbackKey(name, kind)`, the plan/log pairing in
// identity.ts compares two names, and the lift detail screen finds its record
// by name. All of those lowercase or compare record-to-record, so casing what
// is DRAWN is safe -- but casing a name on its way INTO a comparison is not,
// and it would fail silently, as a screen that simply never finds its match.
//
// So this runs in exactly two kinds of place:
//
//   - on rendered text and aria labels, never on a value handed to a handler,
//     to state, or to a lookup;
//   - at the write doors that mint or rewrite a name (the create sheet, the
//     rename sheet, the exercise editor), where the whole record set is being
//     rewritten anyway and the store converges on the cased spelling.
//
// Capitals already inside a word survive, so RDLs stays RDLs.
export function liftTitle(name: string): string {
  return titleCase(name);
}

// THE WHOLE RULE (Dave 2026-09-26, the pass-off: "After dots and numbers is
// always title casing", "Make sure all cases are addressed (ex: 45 min v
// 45 Min)").
//
// Every word the app writes is Title Case: the start of a line, the part
// after every middle dot, and the word after every number. This is the
// formatter for a grey sub line or a facts line, where capAfterNumber only
// ever capitalized the one word after a leading number and left "saves ~8
// min" and "not a tested max" as they were. Small connecting words stay
// lowercase mid-phrase ("Sep 14 · Food and Beverage Store", "2 of 5 Lifts");
// the first and last word of every dot segment are always capitalized
// ("45 Min", "Due in 12 Days"). A compact clock or count keeps its own shape
// ("3h 30m", "10x", "1:32:05"): the letters ride on the digits and are not a
// word. Capitals already inside a word survive (RDLs, AMRAP, JARVIS), so an
// acronym is never flattened on the way past, and a hyphenated pair takes a
// capital on both halves ("One-Rep").
//
// Like titleCase, it never lowercases a capital the caller wrote, so a proper
// noun typed correctly is never wrong. Conversation (chat, notes' bodies,
// onboarding, a field note that is a whole sentence) does not go through it.
const COMPACT = /^[^A-Za-z]*\d[\d.,:/$%x-]*[a-z]{0,2}$/;

// A word that already carries a capital past its first letter (iPhone, eBay,
// RDLs, JARVIS) is spelled the way its owner spells it; Title Case never
// touches it (Dave 2026-09-26, on his typed titles: "iPhone" must not become
// "IPhone").
function ownSpelling(w: string): boolean {
  return /[A-Z]/.test(w.slice(1).replace(/[^A-Za-z]/g, ""));
}

function capWord(w: string): string {
  if (ownSpelling(w)) return w;
  return w.split("-").map(capFirst).join("-");
}

// Short forms that read as small words in a typed title: "w/" (with), "vs",
// "via" (2026-09-26, the pass-off).
const SMALL_FORMS = new Set(["w/", "vs", "vs.", "via"]);

export function lineCase(text: string): string {
  return text
    .split("\u00b7")
    .map((seg) => {
      const m = seg.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!m) return seg;
      const [, pre, body, post] = m;
      if (!body) return seg;
      const words = body.split(/\s+/);
      const last = words.length - 1;
      const out = words.map((w, i) => {
        if (COMPACT.test(w)) return w;
        const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
        if (i > 0 && i < last && ((bare && SMALL.has(bare)) || SMALL_FORMS.has(w.toLowerCase()))) return w;
        return capWord(w);
      });
      return (pre ?? "") + out.join(" ") + (post ?? "");
    })
    .join("\u00b7");
}
