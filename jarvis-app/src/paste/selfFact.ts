import type { StrandCategory } from "../brain/strands/types";

// QUICK ADD, THE FACT LANE (Brain build handoff 5.0, Dave 2026-08-31: manual
// entry "isn't going away, and there's no downside to it - make it the
// easiest, quickest, most user-friendly it can possibly be, everywhere in
// the app").
//
// The failure this fixes, exactly: type "I never work out on Sundays" into
// Quick Capture today and it becomes a TASK called "I Never Work Out On
// Sundays", sitting on a list waiting to be ticked. The one sentence a person
// is most likely to want the app to REMEMBER was the one shape capture could
// not hold.
//
// Three laws, all of them refusals:
//
//   1. DETERMINISTIC, NEVER THE MODEL. A standing fact about a person is not
//      something a language model gets to decide it heard. This file matches
//      stated shapes or returns null; the AI fallback never sees a fact and
//      can never promote a line into one.
//   2. A DATE MEANS IT IS NOT A FACT. "Dinner with Marco Thursday" is an
//      event no matter how it is phrased. classifyLine consults this only
//      after the date and time reads have failed, and this file refuses
//      anything carrying a weekday-plus-time shape on its own as well.
//   3. THE CATEGORY IS A GUESS, AND IT SAYS SO. The receipt renders the
//      category with chips to change it, same as every other capture. A
//      wrong bucket is one tap from right; a wrong KIND is the expensive
//      mistake, and that is the part this file is strict about.
//
// The text is kept VERBATIM. Titles get titleCase elsewhere in this pipeline;
// a fact is the user's own sentence about themselves and is never rewritten,
// which is the same law note bodies already live under.

export interface SelfFact {
  /** The sentence, exactly as typed. */
  text: string;
  /** Best-guess strand category. Always changeable on the receipt. */
  category: StrandCategory;
}

// The stated shapes. Every one of these is a person saying something that is
// true across days, which is what separates a fact from a to-do.
const SHAPES: RegExp[] = [
  // "I never work out on Sundays", "I always read at night", "I don't do
  // mornings", "I can't focus after 9", "I won't take calls before noon"
  /^i\s+(never|always|usually|generally|tend to|prefer|hate|love|don't|do not|can't|cannot|won't|will not|avoid|refuse to)\b/i,
  // "my best hours are the morning", "my rule is one big thing a day"
  /^my\s+\w+(\s+\w+)?\s+(is|are|works|work)\b/i,
  // "family dinner is non-negotiable", "Sundays are off limits"
  /\b(is|are)\s+(non-negotiable|nonnegotiable|off limits|off-limits|sacred|a hard line|a rule)\b/i,
  // "never schedule anything before 10" - an imperative-looking standing rule
  /^never\s+\w+/i,
  // "I work best in the morning", "I think better after a run"
  /^i\s+\w+\s+(best|better|worst)\b/i,
];

// Category guesses, in priority order. First match wins; nothing matching
// lands in values, because a sentence a person volunteers about themselves
// with no other signal is a stated preference, which is what values holds.
const BUCKETS: { category: StrandCategory; rx: RegExp }[] = [
  { category: "energy", rx: /\b(morning|mornings|night|nights|evening|evenings|afternoon|tired|energy|awake|focus|foggy|sharp|crash)\b/i },
  // The weekdays carry an optional plural on purpose: "I never work out on
  // SundayS" is the handoff's own example sentence, and \bsunday\b does not
  // match it. That one missing letter is the difference between this landing
  // in Routine and landing in whatever bucket happens to match next.
  { category: "routine", rx: /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekend|weekday)s?\b|\b(daily|every day|before bed|first thing|schedule|calendar)\b/i },
  { category: "people", rx: /\b(family|wife|husband|kid|kids|son|daughter|mom|dad|friend|friends|team|client|clients|boss|people)\b/i },
  { category: "writing", rx: /\b(write|writing|email|emails|reply|replies|tone|wording|draft)\b/i },
  { category: "work_style", rx: /\b(work|working|task|tasks|meeting|meetings|deep work|multitask|deadline|plan|planning|batch)\b/i },
];

/**
 * Read one line as a standing fact about the user, or refuse.
 *
 * Returns null for anything that is not clearly a stated self-fact, which is
 * most lines. Refusing is the common case and the correct one: a capture that
 * lands as a task is one chip from being a fact, but a to-do silently filed
 * as a permanent belief about the person is the failure worth avoiding.
 */
export function selfFact(line: string): SelfFact | null {
  const t = line.trim();
  if (!t) return null;
  // A fact is one sentence. Prose is a note; that read already happens in
  // classifyLine, and this bound keeps a pasted paragraph out of the genome.
  if (t.length > 140) return null;
  if (!SHAPES.some((rx) => rx.test(t))) return null;
  const bucket = BUCKETS.find((b) => b.rx.test(t));
  return { text: t, category: bucket?.category ?? "values" };
}
