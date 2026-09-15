// QUICK CREATION (the reminders rebuild, 2026-09-15, brief section 3).
//
// The words a person types into the reminder field are read the way Smart
// Paste reads a line: deterministic first, the same resolvers, nothing
// invented. "Call the pharmacy tomorrow at 10am every weekday" gives a day, a
// time and a rhythm as chips the person can change before Save; the words
// that named them leave the title. A word this cannot resolve ("later") is
// left in the title and no time is guessed for it.

import { resolveDay, resolveTime, resolveRepeat } from "../paste/deterministic";
import type { RepeatRule } from "../notes/types";
import { WEEKDAYS } from "./reminders";

export interface QuickRead {
  title: string;
  day: string | null;
  time: string | null;
  repeat: RepeatRule | null;
  /** The words that were read, in the order they were found. */
  matched: string[];
}

const LEAD_RE = /^\s*(?:remind me( to)?|reminder( to)?|remember to)\s+/i;
const TIME_RE = /\b(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i;
const DAY_RE = /\b(?:on\s+)?(?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;
const REPEAT_RE = /\b(?:every\s+(?:day|morning|night|weekday|weekdays|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|nightly|weekly|monthly)\b/i;

function ruleOf(rep: { recurrence: string; days?: number[] }): RepeatRule {
  switch (rep.recurrence) {
    case "daily": return { kind: "daily" };
    case "weekdays": return { kind: "weekdays", days: WEEKDAYS };
    case "weekly": return rep.days && rep.days.length ? { kind: "weekdays", days: rep.days } : { kind: "weekly" };
    case "monthly": return { kind: "monthly" };
    default: return { kind: "daily" };
  }
}

export function readQuick(text: string, today: string): QuickRead {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let title = text.replace(LEAD_RE, "");
  const time = resolveTime(lower);
  const day = resolveDay(lower, today, !!time);
  const rep = resolveRepeat(lower);
  if (rep) { matched.push(rep.text); title = title.replace(REPEAT_RE, " "); }
  if (time) { const m = title.match(TIME_RE); if (m) { matched.push(m[0].trim()); title = title.replace(TIME_RE, " "); } }
  if (day) { const m = title.match(DAY_RE); if (m) { matched.push(m[0].trim()); title = title.replace(DAY_RE, " "); } }
  title = title.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "",
    day: day ?? null,
    time: time ?? null,
    repeat: rep ? ruleOf(rep) : null,
    matched,
  };
}

// "Morning" is one setting for the whole app (decision 4 of the brief,
// drafted as one global value): whatever the person calls morning, every
// "Tomorrow Morning" shortcut means it.
const MORNING_KEY = "jarvis.reminders.morning.v1";
// Read through window on purpose: Node itself now carries a localStorage
// global that is not a working store, and a bare reference would find it
// before the page has one.
const store = (): Storage | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };
export function morningTime(): string {
  try {
    const v = store()?.getItem(MORNING_KEY);
    return v && /^\d{2}:\d{2}$/.test(v) ? v : "08:00";
  } catch { return "08:00"; }
}
export function setMorningTime(hhmm: string): void {
  try { store()?.setItem(MORNING_KEY, hhmm); } catch { /* private mode */ }
}

// The clock times the shortcuts mean, from a moment.
export function inMinutes(nowMs: number, mins: number): { day: string; time: string } {
  const d = new Date(nowMs + mins * 60_000);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { day, time };
}
