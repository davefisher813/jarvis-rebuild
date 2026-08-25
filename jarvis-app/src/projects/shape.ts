import type { ProjectData } from "./types";
import { daysBetween } from "../upnext/upnext";
import { capAfterNumber } from "../shared/casing";

// ---------------------------------------------------------------------------
// THE SHAPE OF A PROJECT (Dave's picks 20 and 22, built 2026-08-24).
//
// A project row said one of three words: Active, On hold, Done. None of them
// answered the only two questions a reader actually has when deciding what to
// open: how big is this, and when does the hold end.
//
// Both are derived. Size comes from the same learned per-category durations
// Plan My Day places blocks with, so a project's estimate and its calendar
// footprint can never disagree. The hold end is the one date the user types,
// because nothing in the data can know when he means to come back.
// ---------------------------------------------------------------------------

// --- PICK 20: A HOLD WITH AN END ------------------------------------------
//
// "On hold" with no date is a project that disappeared. Four of his seven
// projects were unstarted and the hold state gave the app no way to tell an
// unstarted project from a deliberately parked one, so both sat in the list
// looking equally dead. A hold with a date is a decision; a hold without one
// is just avoidance with a label on it.

/** True when the hold has a date and that date has arrived or passed. */
export function holdExpired(d: ProjectData, today: string): boolean {
  return d.status === "on_hold" && !!d.holdUntil && daysBetween(today, d.holdUntil) <= 0;
}

/**
 * The one line under a held project, or null when it is not held. A hold with
 * no date says exactly that, rather than pretending to be a plan.
 */
export function holdLine(d: ProjectData, today: string): string | null {
  if (d.status !== "on_hold") return null;
  if (!d.holdUntil) return "On hold · No date set";
  const days = daysBetween(today, d.holdUntil);
  if (days < 0) return capAfterNumber(`Hold ended ${-days} ${days === -1 ? "day" : "days"} ago`);
  if (days === 0) return "The hold ends today";
  if (days === 1) return "On hold until tomorrow";
  if (days <= 14) return capAfterNumber(`On hold ${days} more days`);
  return "On hold until " + monthDay(d.holdUntil);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthDay(iso: string): string {
  const p = iso.split("-");
  const m = MONTHS[Number(p[1]) - 1];
  return m ? `${m} ${Number(p[2])}` : iso;
}

// --- PICK 22: HOW BIG IS THIS -----------------------------------------------
//
// Not a size someone types (that decays like every other self-report) and not
// a task count on its own, because four ten-minute tasks and four half-day
// tasks are not the same project. The estimate is per CATEGORY, learned from
// what he has actually committed, which is the same number the planner uses.

export interface Size {
  open: number;
  minutes: number;
}

export interface SizedTask { done: boolean; category?: string }

/** Null when nothing is open: a finished project has no size, it has an end. */
export function sizeOf(tasks: SizedTask[], estimateFor: (category: string) => number): Size | null {
  const open = tasks.filter((t) => !t.done);
  if (open.length === 0) return null;
  const minutes = open.reduce((sum, t) => sum + estimateFor(t.category ?? ""), 0);
  return { open: open.length, minutes };
}

/** "45m" / "3h" / "3h 20m". Fused units, per the quiet-line law. */
export function spanLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${m}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/**
 * "4 open · About 3h". The word About is doing real work: these are learned
 * averages, not commitments, and a bare "3h" would read as a promise the app
 * has no business making.
 */
export function sizeLine(s: Size | null): string | null {
  if (!s) return null;
  return capAfterNumber(`${s.open} open · About ${spanLabel(s.minutes)}`);
}
