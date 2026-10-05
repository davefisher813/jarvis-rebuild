import type { CompletionSample } from "../shared/timeSense";
import { lineCase } from "../shared/casing";
import { addDays } from "../schedule/calendar";

// The This Week receipt (2026-08-03): the category page reports what actually
// HAPPENED, derived from real completions (Time Sense samples) and real
// scheduled events. Nothing honest to say => nothing renders (the caller skips
// the section). Weeks start Monday and hard-reset: last week is not held
// against anyone.

export interface WeekEvent { date: string; start: string; category?: string }

/** Monday of the week containing the given local date. */
// SHELL-F-07 (2026-09-05): this read the shifted date back through
// toISOString(), which is the UTC date. Beyond UTC+12 local noon is still
// yesterday in UTC, so in Auckland's summer the week started on Sunday and
// this-week/last-week counts moved with it. addDays formats from local
// getters.
export function weekStartISO(todayIso: string): string {
  const d = new Date(todayIso + "T12:00:00");
  const shift = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  return addDays(todayIso, -shift);
}

// ONE TASK, ONE COMPLETION A DAY (Dave 2026-10-05, the perfect bar; the round-2 review: "180 done next to a 5-row list" and
// the same two rows listed twice). A tick, an un-tick and a tick again stamps a sample EACH time it lands (the log is
// append-only and an un-tick takes nothing back), so every number and list drawn from the raw samples inflated with each
// toggle. A completion is a task on a day: the same task ticked twice in one local day is one completion. Samples with no
// task id (older ones) cannot be matched, so each stands for itself.
function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function uniqueCompletions(samples: CompletionSample[]): CompletionSample[] {
  const seen = new Set<string>();
  return samples.filter((s) => {
    if (!s.id) return true;
    const key = s.id + "@" + localDay(s.t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface WeekReceipt {
  done: number;
  events: number;
  afterHours: number;
}

export function weekReceipt(
  categoryId: string,
  samples: CompletionSample[],
  events: WeekEvent[],
  todayIso: string,
  work?: { startMin: number; endMin: number } | null,
): WeekReceipt {
  const start = weekStartISO(todayIso);
  const startMs = new Date(start + "T00:00:00").getTime();
  const done = uniqueCompletions(samples).filter((s) => s.cat === categoryId && s.t >= startMs).length;
  const weekEvents = events.filter((e) => e.category === categoryId && e.date >= start && e.date <= todayIso);
  const afterHours = work
    ? weekEvents.filter((e) => toMin(e.start) < work.startMin || toMin(e.start) >= work.endMin).length
    : 0;
  return { done, events: weekEvents.length, afterHours };
}

/** "5 things done · 3 events", omitting zero parts. Null when nothing happened. */
export function receiptLine(r: WeekReceipt): string | null {
  const parts: string[] = [];
  if (r.done > 0) parts.push(`${r.done} ${r.done === 1 ? "thing" : "things"} done`);
  if (r.events > 0) parts.push(`${r.events} ${r.events === 1 ? "event" : "events"}`);
  return parts.length ? lineCase(parts.join(" · ")) : null;
}

/** The after-hours sub-line; null unless work hours are on and it happened. */
export function afterHoursLine(r: WeekReceipt): string | null {
  if (r.afterHours <= 0) return null;
  return lineCase(`${r.afterHours} ${r.afterHours === 1 ? "event" : "events"} after work hours`);
}
