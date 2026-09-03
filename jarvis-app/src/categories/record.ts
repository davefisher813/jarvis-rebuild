import type { CompletionSample } from "../shared/timeSense";
import { weekStartISO } from "./receipts";
import { shortDate } from "../shared/dateFormat";

// The Record (2026-08-10, Dave: "we should have records and insight...
// tracking what someone has done is important"). The This Week line was a
// bare count that hard-reset every Monday; this keeps the actual history:
// WHAT got done, WHEN, how this week compares to last, and the pattern the
// data shows. All derived from the Time Sense samples completions already
// write, joined to live tasks for names. Nothing new is collected.

export interface RecordEntry {
  key: string; // stable render key (task id + timestamp)
  text: string;
  when: string; // "Today" / "Yesterday" / "Thursday" / "Aug 2"
}

export interface CategoryRecord {
  recent: RecordEntry[]; // newest first, only completions we can still name
  thisWeek: number;
  lastWeek: number;
  insight: string | null; // "Most gets done on Tuesdays", or null
}

const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// Local calendar date of an epoch-ms instant, matching how samples were
// stamped (local getHours/getDay at completion time).
function isoOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function whenLabel(ms: number, todayIso: string): string {
  const iso = isoOf(ms);
  if (iso === todayIso) return "Today";
  const noon = (i: string) => Date.parse(i + "T12:00:00");
  const days = Math.round((noon(todayIso) - noon(iso)) / 86400000);
  if (days === 1) return "Yesterday";
  const d = new Date(iso + "T12:00:00");
  if (days > 1 && days < 7) return DOW_FULL[d.getDay()]!;
  return shortDate(iso);
}

// Enough history to call something a pattern, and a single clear winner.
const INSIGHT_MIN_SAMPLES = 8;
const INSIGHT_MIN_PEAK = 3;

export function categoryRecord(
  categoryId: string,
  samples: CompletionSample[],
  tasks: { id: string; data: { text: string } }[],
  todayIso: string,
  cap = 5,
): CategoryRecord {
  const mine = samples.filter((s) => s.cat === categoryId);
  const startMs = new Date(weekStartISO(todayIso) + "T00:00:00").getTime();
  const lastStartMs = startMs - 7 * 86400000;
  const thisWeek = mine.filter((s) => s.t >= startMs).length;
  const lastWeek = mine.filter((s) => s.t >= lastStartMs && s.t < startMs).length;

  const textOf = new Map(tasks.map((t) => [t.id, t.data.text] as const));
  const recent: RecordEntry[] = [];
  // Samples append chronologically; walk backwards for newest first. A sample
  // whose task is gone (deleted, or pre-id-era) has no honest name: skip it
  // rather than invent one. It still counts in the week numbers above.
  for (let i = mine.length - 1; i >= 0 && recent.length < cap; i--) {
    const s = mine[i]!;
    const text = s.id ? textOf.get(s.id) : undefined;
    if (!text) continue;
    recent.push({ key: `${s.id}:${s.t}`, text, when: whenLabel(s.t, todayIso) });
  }

  let insight: string | null = null;
  if (mine.length >= INSIGHT_MIN_SAMPLES) {
    const byDow = [0, 0, 0, 0, 0, 0, 0];
    for (const s of mine) byDow[s.dow] = (byDow[s.dow] ?? 0) + 1;
    const max = Math.max(...byDow);
    const winners = byDow.filter((n) => n === max).length;
    if (winners === 1 && max >= INSIGHT_MIN_PEAK) {
      insight = `Most gets done on ${DOW_PLURAL[byDow.indexOf(max)]}`;
    }
  }

  return { recent, thisWeek, lastWeek, insight };
}
