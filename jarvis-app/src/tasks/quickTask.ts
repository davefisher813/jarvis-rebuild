// ONE FIELD, NATURAL LANGUAGE (the Logging Standard, rule 3, 2026-10-17:
// "Quick add parses dates, times, projects, and durations inline from one
// line"). The task sheet's name field reads the way the reminder field already
// does (quickReminder.ts, the same deterministic resolvers Smart Paste uses,
// nothing invented), and adds the two things a task carries that a reminder
// does not: how long it takes and which area it is for.
//
//   "Call Nadia tomorrow 3pm 30 min #Work"
//     -> title Call Nadia, due tomorrow, a 3:00 PM reminder that day, 30 Min,
//        the Work area
//
// Every read is shown as a chip the person can turn off before Save, and the
// words that named it leave the title. A word this cannot resolve stays in the
// title and nothing is guessed for it: "#Garage" with no Garage area is left
// exactly as typed.

import { readQuick } from "./quickReminder";
import type { RepeatRule } from "../notes/types";

export interface QuickTaskRead {
  title: string;
  day: string | null;
  time: string | null;
  repeat: RepeatRule | null;
  estimateMin: number | null;
  /** The id of the area a #tag named, when exactly one area answers to it. */
  categoryId: string | null;
  /** The words that were read, in the order they were found. */
  matched: string[];
}

// "1h", "1 hr", "1.5 hours", "1h30", "1h 30m", "1 hour 15 min", "30 min",
// "30 mins", "45 minutes", "45m". The minutes after an hour need their own
// unit unless they are glued to it ("1h30"), so "1h 2 people" reads one hour
// and leaves the two people alone.
const HOURS_RE = /\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:(\d{1,2})\b|\s+(\d{1,2})\s*(?:m|min|mins|minute|minutes)\b)?/i;
const HOURS_GLUED_RE = /\b(\d+)h(\d{2})\b/i;
const MINUTES_RE = /\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/i;
const TAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9_-]*)/i;

function readDuration(title: string): { minutes: number; text: string } | null {
  const glued = title.match(HOURS_GLUED_RE);
  if (glued) {
    const minutes = parseInt(glued[1]!, 10) * 60 + parseInt(glued[2]!, 10);
    return minutes > 0 ? { minutes, text: glued[0] } : null;
  }
  const h = title.match(HOURS_RE);
  if (h) {
    const minutes = Math.round(parseFloat(h[1]!) * 60) + parseInt(h[2] ?? h[3] ?? "0", 10);
    return minutes > 0 ? { minutes, text: h[0] } : null;
  }
  const m = title.match(MINUTES_RE);
  if (m) {
    const minutes = parseInt(m[1]!, 10);
    return minutes > 0 ? { minutes, text: m[0] } : null;
  }
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function cut(title: string, text: string): string {
  return title.replace(text, " ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
}

/** `opts.time` false leaves a clock time in the title: the caller has nowhere
 *  to put a reminder, and a read that is then dropped on Save is worse than
 *  the words staying where he typed them. */
export function readQuickTask(text: string, today: string, categories: { id: string; name: string }[] = [], opts: { time?: boolean } = {}): QuickTaskRead {
  const base = readQuick(text, today, opts);
  let title = base.title;
  const matched = [...base.matched];

  const dur = readDuration(title);
  if (dur) { matched.push(dur.text.trim()); title = cut(title, dur.text); }

  let categoryId: string | null = null;
  const tag = title.match(TAG_RE);
  if (tag) {
    const want = squash(tag[1]!);
    const hits = categories.filter((c) => squash(c.name) === want);
    if (hits.length === 1) {
      categoryId = hits[0]!.id;
      matched.push("#" + tag[1]!);
      title = cut(title, tag[0]);
    }
  }

  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "",
    day: base.day,
    time: base.time,
    repeat: base.repeat,
    estimateMin: dur ? dur.minutes : null,
    categoryId,
    matched,
  };
}
