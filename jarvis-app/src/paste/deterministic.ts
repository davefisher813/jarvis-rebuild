// Smart Paste, the deterministic layer (addendum item 1). Runs BEFORE any AI
// call (cost guard: deterministic parsing first, always). Classifies pasted
// text into task / event / note, resolves dates against today, splits
// multi-entity pastes only when the split is unambiguous (multiple non-empty
// lines), and falls back honestly: text it cannot read confidently is either
// handed to the AI fallback (when allowed) or saved as a note, never guessed
// into a scheduled thing.
//
// Titles are Title Cased per the casing convention (created titles only;
// copied text is NEVER rewritten, so note bodies keep the paste verbatim).

export interface ParsedEntity {
  // "fact" is Quick Add's lane (Brain handoff 5.0): a standing truth about
  // the user, filed into the Brain instead of onto a to-do list. It never
  // reaches the AI fallback and never becomes a CaptureResult; smartPaste
  // branches on it first. See selfFact.ts for why it is deterministic-only.
  kind: "task" | "event" | "note" | "fact";
  title: string;
  // Note body: the pasted text verbatim (never rewritten).
  body?: string;
  // Fact only: which part of the genome it belongs in. A guess, changeable
  // on the receipt like every other category.
  factCategory?: StrandCategory;
  date?: string; // yyyy-mm-dd
  start?: string; // HH:MM 24h
  // True when the deterministic rules are sure. False = AI may improve it.
  confident: boolean;
  // The line EXACTLY as it was pasted (2026-08-24). Every title on this
  // object has been through titleCase, which capitalises every meaningful
  // word, and rules/triggers.ts reads capitalisation to find a proper noun.
  // Run against a title, "Elite Squad practice" comes back as "Elite Squad
  // Practice" and the trigger becomes the entire title, which is the safe
  // and useless option the trigger heuristic explicitly rejects: nobody
  // pastes the same full sentence twice, so a rule needing two matches is
  // never born. The signal only survives in the original line.
  raw: string;
}

import { selfFact } from "./selfFact";
import type { StrandCategory } from "../brain/strands/types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Title Case is one implementation for the whole app; the number rule lives
// there too (Dave 2026-08-20). Re-exported so existing importers keep working.
import { titleCase } from "../shared/casing";
export { titleCase };

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// PLUMB-F-05 (2026-09-05): a day or a time match now carries the EXACT text it
// matched, because the title cleaner used to run its own second copy of these
// patterns. The two copies could disagree, and did: a line whose date was
// rejected still lost the words to the cleaner, so "separate 2 accounts"
// became a task called "Accounts". One match, one removal.
interface DayHit { iso: string; text: string }
interface TimeHit { hhmm: string; text: string }

// Month names, full and the standard abbreviation. This used to be
// `(jan|feb|...)[a-z]*`, which read "Nova 2" as November 2 and "September"
// out of "separate". A month is spelled one of these two ways or it is not a
// month.
const MONTHS: string[][] = [
  ["january", "jan"], ["february", "feb"], ["march", "mar"], ["april", "apr"],
  ["may"], ["june", "jun"], ["july", "jul"], ["august", "aug"],
  ["september", "sept", "sep"], ["october", "oct"], ["november", "nov"], ["december", "dec"],
];
const MONTH_RE = new RegExp(`\\b(${MONTHS.flat().join("|")})\\.?\\s+(\\d{1,2})\\b`);

// PLUMB-F-05: "email Jan 4 times" is a count, not January the 4th, and Jan is
// a person. A number that is doing the work of a quantity cannot also be a
// day of the month, so a month-day read is dropped when a counting noun
// follows the number.
const COUNTED = /^\s*(times?|more|people|others|items?|things?|weeks?|days?|hours?|minutes?|months?|years?)\b/;

function monthIndex(word: string): number {
  return MONTHS.findIndex((names) => names.includes(word));
}

// Resolve a day mention against today. Named weekdays mean the NEXT such day.
// `hasTime` licenses the three-letter weekday abbreviations: "sat", "sun",
// "mon" and "wed" are ordinary English words ("I sat with Dave", "Mark 5 items
// done"), so on their own they are not a day. Next to a clock time they are.
export function resolveDay(lower: string, today: string, hasTime = false): string | null {
  return matchDay(lower, today, hasTime)?.iso ?? null;
}

function matchDay(lower: string, today: string, hasTime: boolean): DayHit | null {
  const base = new Date(today + "T00:00:00");
  const tom = lower.match(/\btomorrow\b/);
  if (tom) { base.setDate(base.getDate() + 1); return { iso: iso(base), text: tom[0] }; }
  const tod = lower.match(/\btoday\b|\btonight\b/);
  if (tod) return { iso: iso(base), text: tod[0] };
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const w = WEEKDAYS[i]!;
    const pattern = hasTime ? `\\b(${w}|${w.slice(0, 3)})\\b` : `\\b(${w})\\b`;
    const hit = lower.match(new RegExp(pattern));
    if (hit) {
      const diff = (i - base.getDay() + 7) % 7 || 7;
      base.setDate(base.getDate() + diff);
      return { iso: iso(base), text: hit[0] };
    }
  }
  // "aug 20", "august 20", "8/20"
  const mn = lower.match(MONTH_RE);
  if (mn && !COUNTED.test(lower.slice(mn.index! + mn[0].length))) {
    const d = new Date(base.getFullYear(), monthIndex(mn[1]!), parseInt(mn[2]!, 10));
    if (d.getTime() < base.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1);
    return { iso: iso(d), text: mn[0] };
  }
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + parseInt(slash[3], 10) : parseInt(slash[3], 10)) : base.getFullYear();
    const d = new Date(y, parseInt(slash[1]!, 10) - 1, parseInt(slash[2]!, 10));
    if (!slash[3] && d.getTime() < base.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1);
    return { iso: iso(d), text: slash[0] };
  }
  return null;
}

export function resolveTime(lower: string): string | null {
  return matchTime(lower)?.hhmm ?? null;
}

function matchTime(lower: string): TimeHit | null {
  const ap = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ap) {
    let h = parseInt(ap[1]!, 10);
    const m = ap[2] ? parseInt(ap[2], 10) : 0;
    if (ap[3] === "pm" && h < 12) h += 12;
    if (ap[3] === "am" && h === 12) h = 0;
    return { hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, text: ap[0] };
  }
  const noon = lower.match(/\b(noon|midnight)\b/);
  if (noon) return { hhmm: noon[1] === "noon" ? "12:00" : "00:00", text: noon[0] };
  const colon = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colon) return { hhmm: `${colon[1]!.padStart(2, "0")}:${colon[2]}`, text: colon[0] };
  return null;
}

// The imperative openers that make a line read as a to-do.
const TASK_OPENERS = /^(call|email|text|send|pay|buy|book|schedule|renew|cancel|fix|finish|check|review|remember to|pick up|drop off|order|sign|submit|follow up|confirm)\b/i;

// One line, one verdict.
export function classifyLine(line: string, today: string): ParsedEntity {
  const t = line.trim();
  const lower = t.toLowerCase();
  const timeHit = matchTime(lower);
  const dayHit = matchDay(lower, today, timeHit !== null);
  const date = dayHit?.iso ?? null;
  const time = timeHit?.hhmm ?? null;
  const spans = [dayHit?.text, timeHit?.text].filter(Boolean) as string[];

  // A time plus a day (or just a time with "tonight"-style words caught by
  // resolveDay) is an event, confidently.
  if (time && date) {
    return { kind: "event", title: titleCase(stripDateWords(t, spans)), date, start: time, confident: true, raw: t };
  }
  // QUICK ADD (handoff 5.0): a standing fact about the user, before the
  // to-do reads. It sits here and not lower because "I never work out on
  // Sundays" carries a weekday, and the date branch below would file the
  // sentence a person most wants remembered as a task due next Sunday.
  // A dated appointment still wins (the branch above), per selfFact's own
  // law 2. The sentence is kept verbatim: it is the user's words about
  // themselves, and titleCase does not touch it.
  const fact = selfFact(t);
  if (fact) {
    return { kind: "fact", title: fact.text, factCategory: fact.category, confident: true, raw: t };
  }
  // PLUMB-F-05 (2026-09-05): a clock time with no day used to fall through to
  // the task branch, which has nowhere to put a time, so "call Marcus 10am"
  // became a task called "Call Marcus" and the 10am was gone. A thing with a
  // clock time is an appointment; with no day named, it is today's, which is
  // what the AI-less fallback in ai/capture.ts has always assumed. It sits
  // below the fact read so "I don't do anything before 7am" is still a fact.
  if (time) {
    return { kind: "event", title: titleCase(stripDateWords(t, spans)), date: today, start: time, confident: true, raw: t };
  }
  // A date without a time on a to-do-looking line: a task due that day.
  if (TASK_OPENERS.test(t)) {
    return { kind: "task", title: titleCase(stripDateWords(t, spans)), ...(date ? { date } : {}), confident: true, raw: t };
  }
  // A date, no time, not imperative: an all-day-ish event is a guess; a task
  // due that day is the safe, reversible read.
  if (date) {
    return { kind: "task", title: titleCase(stripDateWords(t, spans)), date, confident: false, raw: t };
  }
  // Long prose, URLs, confirmation codes: keep it, verbatim, as a note.
  if (t.length > 160 || /https?:\/\//.test(t) || t.split(/[.!?]\s/).length > 2) {
    return { kind: "note", title: titleCase(t.split(/\s+/).slice(0, 6).join(" ")), body: t, confident: true, raw: t };
  }
  // Short, no signal: a task is the cheapest honest read, but the AI
  // fallback may know better.
  return { kind: "task", title: titleCase(t), confident: false, raw: t };
}

// Remove the date/time words from a created TITLE only (the receipt shows the
// resolved date instead, so "dinner thursday 7pm" does not become a title
// that repeats what the date field already says). Copied text in note bodies
// is never touched by this.
// PLUMB-F-05 (2026-09-05): this used to re-run its own looser copies of the
// date patterns over the whole line, so it deleted words the resolver had
// already refused ("separate 2 accounts" lost "sep 2" and became "Accounts").
// It now removes ONLY the spans the resolver actually matched, together with
// the preposition leading into them, and nothing else.
function stripDateWords(t: string, spans: string[]): string {
  let out = t;
  for (const span of spans) {
    const esc = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?:\\b(?:at|on|from)\\s+)?${esc}\\.?`, "i"), " ");
  }
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim()
    .replace(/[,.\s]+$/, "")
    .replace(/^\s*(at|on)\s+/i, "");
  if (!out) out = t.trim();
  return out;
}

export interface ParseOutcome {
  entities: ParsedEntity[];
  // True when every entity is confident: no AI call needed at all.
  confident: boolean;
}

// The whole paste. Multi-entity ONLY on the unambiguous split: two or more
// non-empty lines, each read on its own. Anything single-line is one entity.
// A paste of many long lines that all read as notes collapses to ONE note
// holding the paste verbatim (splitting an article into 14 notes helps nobody).
export function parsePaste(text: string, today: string): ParseOutcome {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { entities: [], confident: true };
  if (lines.length === 1) {
    const one = classifyLine(lines[0]!, today);
    return { entities: [one], confident: one.confident };
  }
  const parsed = lines.map((l) => classifyLine(l, today));
  const noteish = parsed.filter((p) => p.kind === "note").length;
  if (noteish > parsed.length / 2) {
    // Mostly prose: one note, paste kept verbatim.
    return {
      entities: [{ kind: "note", title: titleCase(lines[0]!.split(/\s+/).slice(0, 6).join(" ")), body: text.trim(), confident: true, raw: text.trim() }],
      confident: true,
    };
  }
  return { entities: parsed, confident: parsed.every((p) => p.confident) };
}
