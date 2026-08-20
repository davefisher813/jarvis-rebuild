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
  kind: "task" | "event" | "note";
  title: string;
  // Note body: the pasted text verbatim (never rewritten).
  body?: string;
  date?: string; // yyyy-mm-dd
  start?: string; // HH:MM 24h
  // True when the deterministic rules are sure. False = AI may improve it.
  confident: boolean;
}

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

// Resolve a day mention against today. Named weekdays mean the NEXT such day.
export function resolveDay(lower: string, today: string): string | null {
  const base = new Date(today + "T00:00:00");
  if (/\btomorrow\b/.test(lower)) { base.setDate(base.getDate() + 1); return iso(base); }
  if (/\btoday\b|\btonight\b/.test(lower)) return iso(base);
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const w = WEEKDAYS[i]!;
    if (new RegExp(`\\b(${w}|${w.slice(0, 3)})\\b`).test(lower)) {
      const diff = (i - base.getDay() + 7) % 7 || 7;
      base.setDate(base.getDate() + diff);
      return iso(base);
    }
  }
  // "aug 20", "august 20", "8/20"
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mn = lower.match(new RegExp(`\\b(${monthNames.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`));
  if (mn) {
    const d = new Date(base.getFullYear(), monthNames.indexOf(mn[1]!), parseInt(mn[2]!, 10));
    if (d.getTime() < base.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1);
    return iso(d);
  }
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + parseInt(slash[3], 10) : parseInt(slash[3], 10)) : base.getFullYear();
    const d = new Date(y, parseInt(slash[1]!, 10) - 1, parseInt(slash[2]!, 10));
    if (!slash[3] && d.getTime() < base.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1);
    return iso(d);
  }
  return null;
}

export function resolveTime(lower: string): string | null {
  const ap = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ap) {
    let h = parseInt(ap[1]!, 10);
    const m = ap[2] ? parseInt(ap[2], 10) : 0;
    if (ap[3] === "pm" && h < 12) h += 12;
    if (ap[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const noon = lower.match(/\b(noon|midnight)\b/);
  if (noon) return noon[1] === "noon" ? "12:00" : "00:00";
  const colon = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colon) return `${colon[1]!.padStart(2, "0")}:${colon[2]}`;
  return null;
}

// The imperative openers that make a line read as a to-do.
const TASK_OPENERS = /^(call|email|text|send|pay|buy|book|schedule|renew|cancel|fix|finish|check|review|remember to|pick up|drop off|order|sign|submit|follow up|confirm)\b/i;

// One line, one verdict.
export function classifyLine(line: string, today: string): ParsedEntity {
  const t = line.trim();
  const lower = t.toLowerCase();
  const date = resolveDay(lower, today);
  const time = resolveTime(lower);

  // A time plus a day (or just a time with "tonight"-style words caught by
  // resolveDay) is an event, confidently.
  if (time && date) {
    return { kind: "event", title: titleCase(stripDateWords(t)), date, start: time, confident: true };
  }
  // A date without a time on a to-do-looking line: a task due that day.
  if (TASK_OPENERS.test(t)) {
    return { kind: "task", title: titleCase(stripDateWords(t)), ...(date ? { date } : {}), confident: true };
  }
  // A date, no time, not imperative: an all-day-ish event is a guess; a task
  // due that day is the safe, reversible read.
  if (date) {
    return { kind: "task", title: titleCase(stripDateWords(t)), date, confident: false };
  }
  // Long prose, URLs, confirmation codes: keep it, verbatim, as a note.
  if (t.length > 160 || /https?:\/\//.test(t) || t.split(/[.!?]\s/).length > 2) {
    return { kind: "note", title: titleCase(t.split(/\s+/).slice(0, 6).join(" ")), body: t, confident: true };
  }
  // Short, no signal: a task is the cheapest honest read, but the AI
  // fallback may know better.
  return { kind: "task", title: titleCase(t), confident: false };
}

// Remove the date/time words from a created TITLE only (the receipt shows the
// resolved date instead, so "dinner thursday 7pm" does not become a title
// that repeats what the date field already says). Copied text in note bodies
// is never touched by this.
function stripDateWords(t: string): string {
  let out = t
    .replace(/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b/gi, "")
    .replace(/\b(today|tonight|tomorrow)\b/gi, "")
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/gi, "")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi, "")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "")
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
      entities: [{ kind: "note", title: titleCase(lines[0]!.split(/\s+/).slice(0, 6).join(" ")), body: text.trim(), confident: true }],
      confident: true,
    };
  }
  return { entities: parsed, confident: parsed.every((p) => p.confident) };
}
