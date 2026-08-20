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

const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

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
      if (!isEdge && SMALL.has(lower)) return lower;
      return capFirst(w);
    })
    .join(" ");
}
