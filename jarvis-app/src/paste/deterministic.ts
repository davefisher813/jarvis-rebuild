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
  // UP-MIND-08 (2026-09-05): two more deterministic lanes, on the fact
  // lane's own terms. "decision" lands in the Decisions log, "person"
  // updates a contact's card. Neither ever reaches the AI fallback.
  kind: "task" | "event" | "note" | "fact" | "decision" | "person";
  title: string;
  // Note body: the pasted text verbatim (never rewritten).
  body?: string;
  // Fact only: which part of the genome it belongs in. A guess, changeable
  // on the receipt like every other category.
  factCategory?: StrandCategory;
  // Person only: which card and which field the sentence named.
  person?: PersonLine;
  date?: string; // yyyy-mm-dd
  start?: string; // HH:MM 24h
  // True when the deterministic rules are sure. False = AI may improve it.
  confident: boolean;
  // UP-CORE-01 (2026-09-05): THE FOUR SHAPES THE APP ALREADY STORES AND
  // CAPTURE COULD NOT READ. Every one of these is a field TasksService has
  // taken since the day it was written (notes/types.ts:68-118); the front
  // door simply never filled them in, so "meds 9pm every day" landed as a 9
  // PM event and "$1,200 rent on the 1st" as a task with no money on it.
  // All optional, all additive: a line with none of these parses exactly as
  // it did before.
  recurrence?: Recurrence;
  reminder?: { time: string; days?: number[]; repeat?: RepeatRule; startDate?: string };
  bill?: { amount: number };
  // A payment already made ("Spent 30 on gas"): Money's transaction, never a
  // task and never a bill (a bill is owed; this is paid). Stated words only.
  expense?: { amountCents: number; merchant: string };
  personId?: string;
  // The contacts whose whole name (or alias) the line wrote. Never filed, only
  // offered (2026-10-27): the receipt shows them as chips and a tap attaches
  // one, a second tap takes it off. A first name alone is not offered.
  // personId stays on the type for a person the PERSON chose; no rule sets it.
  personChoices?: string[];
  projectId?: string;
  // THE LOGGING STANDARD, rule 3 (2026-10-17): how long, and which area, read
  // from the same words the task sheet's one line reads (tasks/quickWords.ts).
  // A task carries the length as its estimate; an event carries it as its end
  // (start plus the length). `category` is the id of the area a #tag named,
  // when exactly one area in ctx.categories answers to it; an unknown tag
  // stays in the title and nothing is guessed. Stated, never inferred.
  estimateMin?: number;
  end?: string; // HH:MM 24h
  category?: string;
  // Phase 0 D3 (PHASE0-DESIGN.md, 2026-10-10): THE FIELDS A RULE FILLED. The
  // rule: a field is inferred when nothing the person typed names its value
  // and a rule chose it. That is the id behind a name (personId: a first
  // name matched against the contacts list; projectId: a title found inside
  // the line) and a date no word of the line carries (a bare clock time is
  // read as today's). A date resolved from words the person wrote
  // ("tomorrow", "thursday", "aug 20", "on the 1st") is stated, not guessed,
  // and so is everything else here: a repeat needs "every", a bill needs an
  // amount, a reminder needs "remind me" or a daily clock. personChoices is
  // never inferred because nobody was filed. Empty when nothing was guessed.
  // smartPaste writes it onto the Source stamp (withInferred) behind
  // memory_v1, so the row can say which of its facts were a guess.
  inferred: string[];
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
import { decisionLine } from "./decisionLine";
import { personLine, type PersonLine } from "./personLine";
import type { StrandCategory } from "../brain/strands/types";
import type { Recurrence, RepeatRule } from "../notes/types";
import { normalizeSpoken, partOfDayTime } from "./spoken";
import { exactMentions } from "../people/mentions";
import { readDuration, readAreaTag, cutWords } from "../tasks/quickWords";
import { addMinutes } from "../schedule/calendar";

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

// WHAT ELSE THE LINE SAYS (UP-CORE-01, 2026-09-05).
//
// Everything below is read from the words the person actually typed and
// nothing is inferred beyond them: a repeat is only a repeat if they wrote
// "every" or "daily", a bill is only a bill if they wrote an amount, and a
// person is only filed when exactly one real contact answers to the line.

// What the capture can be told about, so the person and project reads have
// something bounded to match against. Absent means those two lanes are
// closed and the rest still works, which is what every existing caller gets.
export interface CaptureContext {
  // Phase 0 D11 (2026-10-10): aliases are the other names the person calls
  // this contact ("Mom" for Linda Fisher, People handoff 2026-09-16), matched
  // under the same narrow rules as the name (mentions.ts namePatterns).
  people?: { id: string; name: string; aliases?: string[] }[];
  projects?: { id: string; title: string }[];
  // Phase 0.5 (PHASE05-DESIGN.md): the unanchored follow up opener named in
  // Phase 0 D11. Passed by smartPaste behind memory_v1; absent, the anchored
  // openers alone decide, byte for byte as before.
  followUp?: boolean;
  // The Logging Standard, rule 3 (2026-10-17): the areas a #tag can name.
  // Absent, no tag is read and "#Work" stays in the title as typed.
  categories?: { id: string; name: string }[];
  // The person's own "morning" (tasks/quickReminder morningTime), for "remind me tomorrow morning". Absent means 08:00.
  morning?: string;
}

const REPEAT_RE = new RegExp(
  "\\b(?:every\\s+(day|morning|night|weekday|weekdays|week|month|" + WEEKDAYS.join("|") + ")|(daily|nightly|weekly|monthly))\\b",
);

interface RepeatHit { recurrence: Recurrence; days?: number[]; text: string }

/** The repeat a line names, for the reminder sheet's quick read. */
export function resolveRepeat(lower: string): { recurrence: Recurrence; days?: number[]; text: string } | null {
  return matchRepeat(lower);
}

function matchRepeat(lower: string): RepeatHit | null {
  const m = lower.match(REPEAT_RE);
  if (!m) return null;
  const word = (m[1] ?? m[2] ?? "").toLowerCase();
  if (word === "day" || word === "morning" || word === "night" || word === "daily" || word === "nightly") {
    return { recurrence: "daily", text: m[0] };
  }
  if (word === "weekday" || word === "weekdays") return { recurrence: "weekdays", text: m[0] };
  if (word === "week" || word === "weekly") return { recurrence: "weekly", text: m[0] };
  if (word === "month" || word === "monthly") return { recurrence: "monthly", text: m[0] };
  const idx = WEEKDAYS.indexOf(word);
  if (idx >= 0) return { recurrence: "weekly", days: [idx], text: m[0] };
  return null;
}

// "$1,200", "$45.50". A bare number is never money: "call 3 people" would be
// a bill for three dollars, which is exactly the guessing this refuses.
const MONEY_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/;

// A PAYMENT ALREADY MADE (rule 5, 2026-10-18; widened 2026-10-19 after the live audit: "I already paid $1 for ..." and
// "Paid $1 ... already paid" filed a Bill). The word is past tense, "paid" or "spent", anywhere in the line, with an
// amount he wrote. The imperative "Pay" is never matched, and a line that says it is NOT done (not, never, need to, when,
// until, if, ...) is not either. The amount is a $ figure anywhere, or a bare number straight after the verb when a
// preposition follows ("spent 30 on gas"), so "spent 30 minutes on the report" stays time.
const PAID_WORD = /\b(?:paid|spent)\b/i;
const NOT_DONE = /\b(?:not|never|haven'?t|hasn'?t|didn'?t|don'?t|won'?t|unpaid|yet to|need to|needs to|have to|has to|must|should|gonna|going to|when|until|before|once|if)\b/i;
const DOLLAR_AMOUNT = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/;
const BARE_AMOUNT = /\b(?:paid|spent)\s+(\d[\d,]*(?:\.\d{1,2})?)(?=\s+(?:on|at|for|to)\b)/i;

/** The payment a line reports as already made, or null. `spans` are the day and time words already read, cut from the payee. */
export function readExpense(t: string, spans: string[]): { amountCents: number; merchant: string } | null {
  if (!PAID_WORD.test(t) || NOT_DONE.test(t)) return null;
  const dollar = DOLLAR_AMOUNT.exec(t);
  const bare = dollar ? null : BARE_AMOUNT.exec(t);
  const m = dollar ?? bare;
  if (!m) return null;
  const amount = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // The payee is what is left once the amount, the "I already paid" words and the day words are out.
  let rest = t.replace(dollar ? DOLLAR_AMOUNT : /\b(\d[\d,]*(?:\.\d{1,2})?)(?=\s+(?:on|at|for|to)\b)/, " ");
  for (const sp of spans) rest = rest.replace(new RegExp("(?:\\b(?:at|on|from)\\s+)?" + sp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  rest = rest
    .replace(/\b(?:i|we|i've|we've|already|just|have|had)\b/gi, " ")
    .replace(/\b(?:paid|spent)\b/gi, " ")
    .replace(/[.\u2026]{2,}/g, " ");
  // Glue words at either end are not the payee.
  for (let i = 0; i < 6; i++) {
    const next = rest.replace(/^[\s,.:;!-]+|[\s,.:;!-]+$/g, "").replace(/^(?:on|at|for|to|via|with|the|a|an|my|our)\s+/i, "").replace(/\s+(?:already|today|ok|okay)$/i, "");
    if (next === rest) break;
    rest = next;
  }
  rest = rest.replace(/\s{2,}/g, " ").trim();
  return { amountCents: Math.round(amount * 100), merchant: rest || "Payment" };
}

function matchAmount(lower: string): { amount: number; text: string } | null {
  const m = lower.match(MONEY_RE);
  if (!m) return null;
  const amount = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, text: m[0] };
}

// "on the 1st", "on the 15th": a day of the month, resolved to its next
// occurrence. Rent is written this way and no other date pattern reads it.
function matchMonthDay(lower: string, today: string): DayHit | null {
  const m = lower.match(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/);
  if (!m) return null;
  const day = parseInt(m[1]!, 10);
  if (day < 1 || day > 31) return null;
  const base = new Date(today + "T00:00:00");
  const d = new Date(base.getFullYear(), base.getMonth(), day);
  if (d.getTime() < base.getTime()) d.setMonth(d.getMonth() + 1);
  // A month that has no such day (February the 30th) rolls, which would
  // silently pick a different date than the one written. Refuse instead.
  if (d.getDate() !== day) return null;
  return { iso: iso(d), text: m[0] };
}

// "remind me", the one phrase that says outright which lane this belongs in.
const REMIND_RE = /\bremind me\b(?:\s+to\b)?/i;

// The contacts whose WHOLE name (or alias) is written in this line. Never a
// first name, never a best guess (Dave, 2026-10-27: "Text Josh Rudd" was filed
// under "Josh (Bucknell)"). What this returns is only ever OFFERED, as chips on
// the receipt; nobody is attached until the person taps one.
function matchPeople(raw: string, people: NonNullable<CaptureContext["people"]>): string[] {
  return people.filter((p) => exactMentions(raw, p.name, p.aliases ?? [])).map((p) => p.id);
}

// "for Kitchen remodel": the project by its own title, whole and
// case-insensitive. Never a fuzzy match: filing work into the wrong project
// is worse than filing it into none.
function matchProject(raw: string, projects: { id: string; title: string }[]): string | undefined {
  const lower = raw.toLowerCase();
  const hit = projects
    .filter((p) => p.title.trim().length >= 3 && lower.includes(p.title.toLowerCase()))
    .sort((a, b) => b.title.length - a.title.length)[0];
  return hit?.id;
}

// The imperative openers that make a line read as a to-do.
const TASK_OPENERS = /^(call|email|text|send|pay|buy|book|schedule|renew|cancel|fix|finish|check|review|remember to|pick up|drop off|order|sign|submit|follow up|confirm)\b/i;
// Phase 0.5: "Need to follow up with Mike" puts the to-do mid line. Only these
// four phrases (follow up spelt open, hyphenated or closed), and only with
// "with" after them, so the line names someone.
export const FOLLOW_UP_WITH = /\b(follow[\s-]?up|check in|reach out|circle back) with\b/i;
// Phase 0.5 review: the opener claims only his own to-do. What comes before
// the phrase (date words aside) is nothing, or a first person or to-do lead
// in ("Need to", "I should", "I'll", "Remember to", "Let's"). "Mike will
// follow up with me" and "Mike said he'd check in with the league" are about
// someone else's doing: they stay unconfident, so the model may still read
// them, and AI off they are the same unconfident task they were in Phase 0.
const FOLLOW_UP_LEAD = new RegExp(
  "^(?:" + [
    "(?:i|we)(?:\\s+(?:really|still|also|just))?(?:'ll|\\s+will|\\s+should|\\s+must|\\s+need\\s+to|\\s+have\\s+to|\\s+want\\s+to|\\s+got\\s+to|\\s+gotta|\\s+ought\\s+to|'m\\s+going\\s+to|'re\\s+going\\s+to|\\s+(?:am|are)\\s+going\\s+to)",
    "(?:really\\s+|still\\s+|also\\s+|just\\s+)?(?:need\\s+to|needs\\s+to|have\\s+to|got\\s+to|gotta|should|must|want\\s+to|going\\s+to|ought\\s+to|remember\\s+to|don'?t\\s+forget\\s+to)",
    "please", "pls", "let'?s", "to\\s?do", "reminder", "note to self",
  ].join("|") + ")?$",
  "i",
);
function followUpOpener(t: string, spans: string[]): boolean {
  // Curly apostrophes are what a phone keyboard types ("I\u2019ll").
  const s = stripDateWords(t, spans).replace(/[\u2018\u2019]/g, "'");
  const m = FOLLOW_UP_WITH.exec(s);
  if (!m) return false;
  return FOLLOW_UP_LEAD.test(s.slice(0, m.index).replace(/[\s:;,.-]+$/, "").trim());
}

// One line, one verdict.
export function classifyLine(line: string, today: string, ctx: CaptureContext = {}): ParsedEntity {
  // THE WORDS AS SPOKEN, READ AS WRITTEN (the speech box, 2026-10-31). "7 p.m." and "42 dollars" are how transcription spells
  // "7pm" and "$42"; the reads below see the second spelling. `orig` is what he wrote or said, kept verbatim in `raw` and in a
  // note's body (copied text is never rewritten).
  const orig = line.trim();
  const t = normalizeSpoken(orig);
  const lower = t.toLowerCase();
  const remindLead = REMIND_RE.test(t);
  // A reminder needs a clock, and "remind me tomorrow morning" names one: the part of the day, read only on this lane.
  const timeHit = matchTime(lower) ?? (remindLead ? partOfDayTime(lower, ctx.morning) : null);
  const dayHit = matchDay(lower, today, timeHit !== null) ?? matchMonthDay(lower, today);
  const date = dayHit?.iso ?? null;
  const time = timeHit?.hhmm ?? null;
  const repeat = matchRepeat(lower);
  const money = matchAmount(lower);
  const remindMe = remindLead ? REMIND_RE.exec(t) : null;
  const spans = [dayHit?.text, timeHit?.text, repeat?.text, money?.text, remindMe?.[0]].filter(Boolean) as string[];

  // WHO AND WHICH PROJECT. Attached to whatever the line turns out to be,
  // because "call Marco about the Kitchen remodel invoice" is one line with
  // three facts in it, and the kind is only the first of them.
  const peopleHits = matchPeople(t, ctx.people ?? []);
  const projectId = matchProject(t, ctx.projects ?? []);
  const who: Pick<ParsedEntity, "personId" | "personChoices" | "projectId" | "inferred"> = {
    // A name in a title never attaches a person on its own. An exact name is
    // offered on the receipt and the person decides (2026-10-27).
    ...(peopleHits.length > 0 ? { personChoices: peopleHits } : {}),
    ...(projectId ? { projectId } : {}),
    // The ids a rule chose (see ParsedEntity.inferred); the date joins below
    // on the one branch that assumes a day.
    inferred: [...(projectId ? ["projectId"] : [])],
  };

  // HOW LONG, AND WHICH AREA (the Logging Standard, rule 3, 2026-10-17): the
  // same two reads the task sheet's one line makes, on what is left once the
  // day and time words are out. A task carries the length as its estimate, an
  // event as its end; the area is the id of the one it named. A line that is
  // nothing but a length and a tag keeps its words and reads nothing, so no
  // title goes empty. Neither read moves a line between lanes: a day plus a
  // time is an event with or without them.
  const dated = stripDateWords(t, spans);
  let dur = readDuration(dated);
  let rest = dur ? cutWords(dated, dur.text) : dated;
  let area = readAreaTag(rest, ctx.categories ?? []);
  if (area) rest = cutWords(rest, area.text);
  if (!rest) { dur = null; area = null; rest = dated; }
  const words = rest;
  const taskExtra = { ...(dur ? { estimateMin: dur.minutes } : {}), ...(area ? { category: area.id } : {}) };
  const eventExtra = (start: string) => ({ ...(dur ? { end: addMinutes(start, dur.minutes) } : {}), ...(area ? { category: area.id } : {}) });

  // A PAYMENT ALREADY MADE IS A TRANSACTION, NOT A NOTE (the research standard,
  // rule 5, 2026-10-18). Past tense and an amount and who it went to: "Spent
  // 30 on gas", "Paid $1,200 for rent". The imperative "Pay $50 rent" is
  // still a bill (owed), and a line without all three words is read as it
  // always was. The day is only the one he named; none means today.
  const spent = readExpense(t, [dayHit?.text, timeHit?.text].filter(Boolean) as string[]);
  if (spent) {
    const merchant = titleCase(spent.merchant);
    return {
      kind: "task",
      title: merchant,
      expense: { amountCents: spent.amountCents, merchant },
      date: date ?? today,
      confident: true,
      raw: orig,
      ...who,
      inferred: date ? who.inferred : [...who.inferred, "date"],
    };
  }

  // "REMIND ME" ON A DAY IS A REMINDER THAT RUNS ONCE (the speech box, 2026-10-31). "Remind me to email the landlord tomorrow
  // morning" was filed for today, repeating every day: a reminder could not run once when this lane was written, so a dated
  // "remind me" was sent to the event branch instead and the model filled the gap. A reminder runs once on its start date now
  // (repeat "once"), so the words he said land as they read: that day, that time, once. Weekly and daily words still win.
  if (remindMe && time && date && !repeat) {
    return {
      kind: "task",
      title: titleCase(words),
      reminder: { time, repeat: { kind: "once" }, startDate: date },
      ...taskExtra,
      confident: true,
      raw: orig,
      ...who,
    };
  }
  // A time plus a day (or just a time with "tonight"-style words caught by
  // resolveDay) is an event, confidently.
  if (time && date) {
    return { kind: "event", title: titleCase(words), date, start: time, ...eventExtra(time), ...(repeat ? { recurrence: repeat.recurrence } : {}), confident: true, raw: orig, ...who };
  }
  // QUICK ADD (handoff 5.0): a standing fact about the user, before the
  // to-do reads. It sits here and not lower because "I never work out on
  // Sundays" carries a weekday, and the date branch below would file the
  // sentence a person most wants remembered as a task due next Sunday.
  // A dated appointment still wins (the branch above), per selfFact's own
  // law 2. The sentence is kept verbatim: it is the user's words about
  // themselves, and titleCase does not touch it.
  // UP-MIND-08 (2026-09-05): a settled call and a fact about a person, both
  // read here for the same reason the fact lane is read here: they carry no
  // date, and the to-do reads below would file the sentence a person most
  // wants recorded as something to tick off. Decision first: "we're going
  // with Ridgeline" names a thing, not a person.
  const decided = decisionLine(t);
  if (decided) {
    return { kind: "decision", title: decided.decision, confident: true, raw: orig, inferred: [] };
  }
  // `who` above is already the person and project this line is ABOUT
  // (UP-CORE-01); this is the person the line is a FACT about, which is a
  // different question with a different answer.
  const about = personLine(t);
  if (about) {
    return { kind: "person", title: t, person: about, confident: true, raw: orig, inferred: [] };
  }
  const fact = selfFact(t);
  if (fact) {
    return { kind: "fact", title: fact.text, factCategory: fact.category, confident: true, raw: orig, inferred: [] };
  }
  // A REMINDER, NOT A NINE PM EVENT (UP-CORE-01, 2026-09-05). Two ways in:
  //
  //   1. "remind me to take the meds at 9pm" says outright which lane it is.
  //   2. A clock time repeating EVERY day (or every weekday) with no weekday
  //      named. Something that happens at the same time every single day is
  //      a habit, and habits are what the reminder lane was built for (meds,
  //      vitamins, the evening walk). A repeat on a NAMED weekday is a
  //      commitment, not a habit, so "practice every Tuesday at 5" is caught
  //      by the dated-event branch above and stays the event it is.
  //
  // A reminder needs a time (ReminderInfo.time is not optional), so a line
  // without one never lands here however it is worded. It also sits BELOW
  // the dated read on purpose: a reminder has no date, only a time and the
  // days it runs, so "remind me tomorrow at 9" must stay a dated thing
  // rather than become a ping that repeats every morning forever.
  const remindable = !!remindMe || (!!repeat && (repeat.recurrence === "daily" || repeat.recurrence === "weekdays"));
  if (time && remindable) {
    const days = repeat?.recurrence === "weekdays" ? [1, 2, 3, 4, 5] : repeat?.days;
    return {
      kind: "task",
      title: titleCase(words),
      reminder: { time, ...(days ? { days } : {}) },
      ...taskExtra,
      confident: true,
      raw: orig,
      ...who,
    };
  }

  // A LINE WITH AN AMOUNT READS AS A BILL, AND A BILL IS MONEY'S (Money
  // ledger, hard rule 1). This only READS it: the candidate keeps kind "task"
  // because the parse has no other word for it, and applyCapture files any
  // task-kind result that carries `bill` in the ledger, never as a task (and
  // TasksService.createTask would refuse it if anything tried). An amount he
  // wrote is the one switch: no amount, no bill. The date is only the day he
  // named, and the repeat rides along only when he wrote one ("$1,200 rent on
  // the 1st" is not a claim that rent is monthly, however obvious that is;
  // "every month" is).
  if (money) {
    return {
      kind: "task",
      title: titleCase(stripDateWords(t, spans)),
      bill: { amount: money.amount },
      ...(date ? { date } : {}),
      ...(repeat ? { recurrence: repeat.recurrence } : {}),
      confident: true,
      raw: orig,
      ...who,
    };
  }

  // PLUMB-F-05 (2026-09-05): a clock time with no day used to fall through to
  // the task branch, which has nowhere to put a time, so "call Marcus 10am"
  // became a task called "Call Marcus" and the 10am was gone. A thing with a
  // clock time is an appointment; with no day named, it is today's, which is
  // what the AI-less fallback in ai/capture.ts has always assumed. It sits
  // below the fact read so "I don't do anything before 7am" is still a fact.
  if (time) {
    return { kind: "event", title: titleCase(words), date: today, start: time, ...eventExtra(time), ...(repeat ? { recurrence: repeat.recurrence } : {}), confident: true, raw: orig, ...who, inferred: [...who.inferred, "date"] };
  }
  // Long prose, URLs, confirmation codes: kept verbatim as a note (below).
  const prose = t.length > 160 || /https?:\/\//.test(t) || t.split(/[.!?]\s/).length > 2;
  // A date without a time on a to-do-looking line: a task due that day.
  // Phase 0.5: the follow up opener never claims prose (a pasted message is
  // copied text, kept verbatim), a question (the model may know better), or
  // someone else's doing (followUpOpener above).
  if (TASK_OPENERS.test(t) || (ctx.followUp && !prose && !/\?\s*$/.test(t) && followUpOpener(t, spans))) {
    return { kind: "task", title: titleCase(words), ...(date ? { date } : {}), ...(repeat ? { recurrence: repeat.recurrence } : {}), ...taskExtra, confident: true, raw: orig, ...who };
  }
  // A REPEAT WITH NO CLOCK ("water the plants every week"): the repeat is the
  // whole signal, and a repeating thing is a task the app already knows how
  // to roll forward. Confident, because he wrote the word "every".
  if (repeat) {
    return { kind: "task", title: titleCase(words), ...(date ? { date } : {}), recurrence: repeat.recurrence, ...taskExtra, confident: true, raw: orig, ...who };
  }
  // A date, no time, not imperative: an all-day-ish event is a guess; a task
  // due that day is the safe, reversible read.
  if (date) {
    return { kind: "task", title: titleCase(words), date, ...taskExtra, confident: false, raw: orig, ...who };
  }
  // Long prose, URLs, confirmation codes: keep it, verbatim, as a note.
  if (prose) {
    return { kind: "note", title: titleCase(orig.split(/\s+/).slice(0, 6).join(" ")), body: orig, confident: true, raw: orig, inferred: [] };
  }
  // Short, no signal: a task is the cheapest honest read, but the AI
  // fallback may know better.
  return { kind: "task", title: titleCase(words), ...taskExtra, confident: false, raw: orig, ...who };
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
export function parsePaste(text: string, today: string, ctx: CaptureContext = {}): ParseOutcome {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { entities: [], confident: true };
  if (lines.length === 1) {
    const one = classifyLine(lines[0]!, today, ctx);
    return { entities: [one], confident: one.confident };
  }
  const parsed = lines.map((l) => classifyLine(l, today, ctx));
  const noteish = parsed.filter((p) => p.kind === "note").length;
  if (noteish > parsed.length / 2) {
    // Mostly prose: one note, paste kept verbatim.
    return {
      entities: [{ kind: "note", title: titleCase(lines[0]!.split(/\s+/).slice(0, 6).join(" ")), body: text.trim(), confident: true, raw: text.trim(), inferred: [] }],
      confident: true,
    };
  }
  return { entities: parsed, confident: parsed.every((p) => p.confident) };
}
