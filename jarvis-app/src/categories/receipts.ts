import type { CompletionSample } from "../shared/timeSense";
import { capAfterNumber } from "../shared/casing";
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
  const done = samples.filter((s) => s.cat === categoryId && s.t >= startMs).length;
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
  return parts.length ? capAfterNumber(parts.join(" · ")) : null;
}

/** The after-hours sub-line; null unless work hours are on and it happened. */
export function afterHoursLine(r: WeekReceipt): string | null {
  if (r.afterHours <= 0) return null;
  return capAfterNumber(`${r.afterHours} ${r.afterHours === 1 ? "event" : "events"} after work hours`);
}
