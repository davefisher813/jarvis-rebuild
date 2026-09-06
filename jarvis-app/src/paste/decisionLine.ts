// QUICK ADD, THE DECISION LANE (UP-MIND-08, Brain 5.0).
//
// Type "we're going with Ridgeline" into the bar today and it becomes a TASK
// called "We're Going With Ridgeline", sitting on a list waiting to be
// ticked. It is not a to-do. It is the thing the Decisions log exists for,
// and the log is the one record that stops the same question being reopened
// in three weeks.
//
// The same three laws the fact lane lives under (selfFact.ts), for the same
// reasons:
//
//   1. DETERMINISTIC, NEVER THE MODEL. A model does not get to decide it
//      heard a decision. This file matches stated shapes or returns null.
//   2. A DATE MEANS IT IS NOT A DECISION. "Decide on the vendor Thursday" is
//      a task with a deadline; classifyLine consults this only after the
//      date and time reads have failed.
//   3. THE SENTENCE IS KEPT VERBATIM. A decision record is the user's own
//      words about what they settled, and rewriting it is how a record stops
//      being evidence.
//
// It also never infers WHY. The why is the most valuable field on a decision
// record and the easiest to invent; the record is created with the decision
// only, and the why is added on the card by the person who has it.

export interface DecisionLine {
  /** The sentence, exactly as typed. */
  decision: string;
}

// The stated shapes. Each one is somebody reporting a settled call, in the
// first person, about something they control. "They decided to close early"
// is news about someone else and matches nothing here.
const SHAPES: RegExp[] = [
  /^(?:we|i)(?:'ve| have)?\s+decided\s+(?:to|on|against)\b/i,
  /^(?:we|i)(?:'re| are)\s+going\s+with\b/i,
  /^(?:we|i)(?:'ll| will)\s+(?:use|go\s+with)\b/i,
  /^(?:we|i)\s+picked\b/i,
  /^(?:we|i)\s+chose\b/i,
  /^decided\s*:/i,
  /^decision\s*:/i,
];

// Long enough to be a sentence, short enough to be one decision. A paragraph
// pasted in is a note, and the note lane is where it belongs.
const MAX = 200;

// A question is not a decision, however it opens. "Should we go with
// Ridgeline?" is the opposite of a settled call.
const QUESTION = /\?\s*$/;

export function decisionLine(raw: string): DecisionLine | null {
  const t = (raw ?? "").trim();
  if (!t || t.length > MAX) return null;
  if (QUESTION.test(t)) return null;
  if (!SHAPES.some((re) => re.test(t))) return null;
  // "Decided:" and "Decision:" are labels, not part of the sentence.
  const decision = t.replace(/^(?:decided|decision)\s*:\s*/i, "").trim();
  return decision ? { decision } : null;
}
