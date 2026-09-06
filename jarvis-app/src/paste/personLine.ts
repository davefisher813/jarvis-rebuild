// QUICK ADD, THE PERSON LANE (UP-MIND-08, Brain 5.0).
//
// "Marco is my dentist" is a fact about a PERSON, and it belongs on their
// card, where the app can use it: the drafting stack reads relationship, the
// Brain ranks by it, Call Prep shows it. Typed into the bar today it became
// a task called "Marco Is My Dentist".
//
// Same refusals as the fact and decision lanes: shapes or nothing, never the
// model, and a date means it is not one of these. Two more of its own:
//
//   - IT NEVER INFERS A LABEL. It reports what the sentence SAID. "Marco is
//     my dentist" carries the label in the user's own words; nothing here
//     guesses one from behaviour, which is UP-MIND-16's job and needs a tap.
//   - THE NAME IS WHAT WAS TYPED. Matching it to a contact happens at save
//     time, where the People list is, and an ambiguous name asks rather
//     than picking.

export type PersonField = "relationship" | "phone" | "email" | "note";

export interface PersonLine {
  /** The name exactly as typed, for the caller to resolve against Contacts. */
  name: string;
  field: PersonField;
  /** What to write into that field, in the user's own words. */
  value: string;
}

const NAME = "([A-Z][\\w.'-]*(?:\\s+[A-Z][\\w.'-]*)?)";

// Ordered: the most specific shape wins. Each capture is (name, value).
const SHAPES: { re: RegExp; field: PersonField }[] = [
  // "Sarah's number is 555 0134" / "Marco's phone is ..."
  { re: new RegExp("^" + NAME + "(?:'s|s')\\s+(?:phone|number|cell|mobile)\\s+is\\s+(.+)$"), field: "phone" },
  // "Marco's email is marco@example.com"
  { re: new RegExp("^" + NAME + "(?:'s|s')\\s+email\\s+is\\s+(.+)$"), field: "email" },
  // "Marco is my dentist" / "Nadia is our accountant"
  { re: new RegExp("^" + NAME + "\\s+is\\s+(?:my|our)\\s+(.+)$"), field: "relationship" },
  // "Mike moved to Acme" / "Mike works at Acme"
  { re: new RegExp("^" + NAME + "\\s+(?:moved\\s+to|works\\s+at|is\\s+now\\s+at)\\s+(.+)$"), field: "note" },
];

const MAX = 160;
const QUESTION = /\?\s*$/;

export function personLine(raw: string): PersonLine | null {
  const t = (raw ?? "").trim();
  if (!t || t.length > MAX) return null;
  if (QUESTION.test(t)) return null;
  for (const s of SHAPES) {
    const m = t.match(s.re);
    if (!m) continue;
    const name = (m[1] ?? "").trim();
    const value = (m[2] ?? "").trim().replace(/[.]+$/, "");
    // A single letter is not a name, and an empty value is not a fact.
    if (name.length < 2 || !value) continue;
    return { name, field: s.field, value };
  }
  return null;
}

/** How the receipt says what happened. Sentence case: the receipt talks. */
export function personReceipt(p: PersonLine): string {
  if (p.field === "relationship") return `${p.name} is your ${p.value}`;
  if (p.field === "phone") return `Saved ${p.name}'s number`;
  if (p.field === "email") return `Saved ${p.name}'s email`;
  return `Noted on ${p.name}'s card`;
}
