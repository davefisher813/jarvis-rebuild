import type { StrandCategory, StrandType } from "../brain/strands/types";
import { decisionLine } from "./decisionLine";

// THE THREE PREFIXES (C-49, Astra, 2026-09-12). Quick Capture and the chat
// capture lane read these BEFORE the ordinary paste reads, because each one
// is the person saying where the line goes, and a stated destination beats
// a guessed one:
//
//   Remember ...         a strand, told-rank. The category is guessed from
//                        the words (a person's name: people; a time word:
//                        routine; else values) and the type from the shape
//                        (a person plus a preference verb: relationship;
//                        else fact). The receipt shows both as facts, and
//                        tapping it opens the strand to correct either.
//   Decision: ...        a decision record, the same path C-52 takes from
//   ... instead of ...   Chat. "instead of" carries the option ruled out.
//   Never ... / Always   a strand with strength rule: routine when a time
//                        word is present, else values.
//
// Deterministic, never the model. Every receipt has Undo. The bar tap is
// the tap.

export type Prefix =
  | { kind: "remember"; text: string; category: StrandCategory; type: StrandType }
  | { kind: "rule"; text: string; category: StrandCategory }
  | { kind: "decision"; decision: string; ruledOut?: string[] };

const TIME_WORDS = /\b(morning|mornings|night|nights|evening|evenings|afternoon|afternoons|noon|midnight|before|after|until|weekday|weekdays|weekend|weekends|daily|every day|first thing|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;
const PREFERENCE_VERB = /\b(hates?|loves?|prefers?|likes?|dislikes?|wants?|needs?|avoids?|refuses?|enjoys?|can'?t stand)\b/i;
// A capitalised word that is not the first word and not a day or month:
// the cheapest honest read of "somebody's name" without a contact list.
const NOT_NAMES = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|i|jarvis)$/i;

// Ordinary sentence starters that happen to be capitalised.
const STARTERS = /^(the|a|an|i|my|our|we|it|this|that|if|when|do|don't|never|always|he|she|they|you|our|his|her)$/i;

function namesSomeone(text: string): boolean {
  const words = text.split(/\s+/).map((w) => w.replace(/[.,!?;:'"]+$/, "").replace(/'s$/, ""));
  return words.some((w, i) => /^[A-Z][a-z]+$/.test(w) && !NOT_NAMES.test(w) && (i > 0 || !STARTERS.test(w)));
}

export function readPrefix(line: string): Prefix | null {
  const t = (line ?? "").trim();
  if (!t || t.length > 200 || /\n/.test(t)) return null;

  const rem = t.match(/^remember\s*[:,]?\s+(.+?)[.!]?$/i);
  if (rem) {
    const text = rem[1]!.trim();
    if (!text) return null;
    const person = namesSomeone(text);
    const category: StrandCategory = person ? "people" : TIME_WORDS.test(text) ? "routine" : "values";
    const type: StrandType = person && PREFERENCE_VERB.test(text) ? "relationship" : "fact";
    return { kind: "remember", text, category, type };
  }

  if (/^(never|always)\s+\S/i.test(t) && !/\?\s*$/.test(t)) {
    return { kind: "rule", text: t.replace(/[.!]+$/, ""), category: TIME_WORDS.test(t) ? "routine" : "values" };
  }

  const dec = t.match(/^decision\s*:\s*(.+)$/i);
  if (dec) {
    const d = decisionLine("Decision: " + dec[1]!);
    return d ? { kind: "decision", decision: d.decision } : null;
  }
  const instead = t.match(/^(.+?)\s+instead of\s+(.+?)[.!]?$/i);
  if (instead && !/\?\s*$/.test(t)) {
    return { kind: "decision", decision: t.replace(/[.!]+$/, ""), ruledOut: [instead[2]!.trim()] };
  }
  return null;
}
