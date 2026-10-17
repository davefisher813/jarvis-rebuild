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
import { readDuration, readAreaTag, cutWords } from "./quickWords";

// The length and area readers are shared with Smart Paste's classifier
// (paste/deterministic.ts); they live in quickWords.ts so the import runs one
// way, and are re-exported here so this stays the door for a task's words.
export { readDuration, readAreaTag, cutWords } from "./quickWords";

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

/** `opts.time` false leaves a clock time in the title: the caller has nowhere
 *  to put a reminder, and a read that is then dropped on Save is worse than
 *  the words staying where he typed them. */
export function readQuickTask(text: string, today: string, categories: { id: string; name: string }[] = [], opts: { time?: boolean } = {}): QuickTaskRead {
  const base = readQuick(text, today, opts);
  let title = base.title;
  const matched = [...base.matched];

  const dur = readDuration(title);
  if (dur) { matched.push(dur.text.trim()); title = cutWords(title, dur.text); }

  let categoryId: string | null = null;
  const area = readAreaTag(title, categories);
  if (area) {
    categoryId = area.id;
    matched.push(area.text.trim());
    title = cutWords(title, area.text);
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
