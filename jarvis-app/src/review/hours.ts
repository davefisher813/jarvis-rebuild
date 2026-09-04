import type { EventItem } from "../schedule/types";
import { occursOn, minutesBetween } from "../schedule/calendar";

// WHERE THE HOURS WENT (Brain build handoff item 13; Dave took option A on
// 2026-09-04: "in the monthly report you already get, as one more section").
//
// Calendar-mined time per area, held against what the user said mattered.
// Fully passive: it asks for nothing, it adds no field to any record, and it
// reads only events that were already on the calendar.
//
// WHY IT IS A MONTHLY FACT AND NOT A DASHBOARD. The item was approved for the
// monthly report specifically, and the shape follows the surface: a month is
// long enough that the number means something and rare enough that it cannot
// become a thing to check. A live "hours this week" panel would be a scoreboard
// for time, and this app does not keep score.
//
// FOUR REFUSALS, and they are the whole design:
//
//   NO TARGET AND NO IDEAL SPLIT. The report says where the hours went. It
//   never says where they should have gone. There is no recommended balance
//   to fall short of.
//
//   NO JUDGMENT WORD. Not "too much", not "neglected", not "only". The gap
//   between the hours and the goals is stated as two facts side by side and
//   the reader draws their own conclusion, which is the whole point of
//   holding them against each other rather than scoring them.
//
//   AN EMPTY CALENDAR SAYS NOTHING. A month with almost nothing scheduled is
//   not a month with no life in it; it is a month the calendar was not used.
//   Below the floor this returns nothing at all rather than a misleading
//   picture built from four events.
//
//   IDS, NEVER TITLES. Like every other field on the seal, what is stored is
//   category ids and minutes. Event titles are the user's own words about
//   their own life and they do not belong in a durable record that later
//   feeds a prompt.

/** An event shorter than this is treated as having no measurable length: a
 *  start time with no end, or a typo. Counting it as zero is honest; guessing
 *  an hour for it is not. */
const MIN_EVENT_MINUTES = 5;

/** An event longer than this is almost certainly an all-day marker rather
 *  than time a person spent, and letting one swallow the month would make
 *  every other number meaningless. */
const MAX_EVENT_MINUTES = 12 * 60;

/** Below this many scheduled hours in the month, the section says nothing.
 *  Ten hours is roughly "the calendar was actually used"; under it, the split
 *  is an artefact of which few things happened to get typed in. */
export const HOURS_MIN_TOTAL = 600;

/** How many areas the report names. Beyond this it is a list, not a picture. */
export const HOURS_TOP_N = 5;

/** Every local ISO day in a "YYYY-MM" month. Built with setDate so a
 *  daylight-saving boundary inside the month cannot skip or repeat a day. */
export function daysOfMonth(month: string): string[] {
  const first = new Date(month + "-01T00:00:00");
  if (Number.isNaN(first.getTime())) return [];
  const out: string[] = [];
  const d = new Date(first);
  while (`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === month) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
    if (out.length > 31) break;
  }
  return out;
}

/** The length of one occurrence in minutes, or 0 when it cannot be known. */
export function eventMinutes(e: EventItem): number {
  const end = e.data.end;
  if (!end) return 0;
  const m = minutesBetween(e.data.start, end);
  if (!Number.isFinite(m) || m < MIN_EVENT_MINUTES) return 0;
  return Math.min(m, MAX_EVENT_MINUTES);
}

/**
 * Scheduled minutes per category id across one month, recurring series
 * expanded occurrence by occurrence.
 *
 * An event with no category lands under "" and is kept rather than dropped:
 * uncategorised time is a real answer to "where did the hours go", and
 * silently excluding it would make the named areas add up to more of the
 * month than they deserve.
 */
export function minutesByCategory(month: string, events: EventItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  const days = daysOfMonth(month);
  if (days.length === 0) return out;
  for (const e of events) {
    const mins = eventMinutes(e);
    if (mins <= 0) continue;
    const key = e.data.category ?? "";
    for (const day of days) {
      if (!occursOn(e.data, day)) continue;
      out[key] = (out[key] ?? 0) + mins;
    }
  }
  return out;
}

export interface HoursRow {
  /** Category id, or "" for time on the calendar with no area on it. */
  category: string;
  minutes: number;
  /** Share of the month's scheduled minutes, 0 to 100, rounded. */
  pct: number;
}

/**
 * The report's rows: the biggest areas first, capped, with the rest folded
 * into one remainder row so the percentages still add up.
 *
 * Returns an empty list below the floor. That is the honest answer to "where
 * did the hours go" for a month whose calendar was barely used, and it is the
 * same silence-over-guessing rule the derivations keep.
 */
export function hoursRows(byCategory: Record<string, number>): HoursRow[] {
  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  if (total < HOURS_MIN_TOTAL) return [];
  const sorted = Object.entries(byCategory)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, HOURS_TOP_N);
  const rest = sorted.slice(HOURS_TOP_N).reduce((a, [, m]) => a + m, 0);
  const rows: HoursRow[] = top.map(([category, minutes]) => ({
    category, minutes, pct: Math.round((minutes / total) * 100),
  }));
  if (rest > 0) rows.push({ category: "", minutes: rest, pct: Math.round((rest / total) * 100) });
  return rows;
}

/** "18h", "18h 30m", "45m". Never a decimal hour: nobody thinks in 18.5h. */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The areas a user's live goals reach into that got no scheduled time at all.
 *
 * This is the "held against what you said mattered" half, and it is stated as
 * an absence, never as a failing: the report names the area and the fact that
 * nothing was on the calendar for it. Whether that is a problem is the
 * reader's call. An area with even one scheduled event is not listed, because
 * "you did a bit less than you might have" is a judgment and this is not.
 */
export function unscheduledGoalAreas(byCategory: Record<string, number>, goalCategoryIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of goalCategoryIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if ((byCategory[id] ?? 0) === 0) out.push(id);
  }
  return out;
}
