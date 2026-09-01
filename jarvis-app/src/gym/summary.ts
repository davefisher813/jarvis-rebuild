import type { Workout, WorkoutExercise } from "./types";
import { receiptFor } from "./prs";
import { exerciseHistory, trendLine } from "./history";
import { beats } from "./measures";
import { daysBetween } from "../upnext/upnext";

// The Health page's read of the gym (2026-08-25). Pure functions over the
// workout list; the page shows training without opening the gym. Everything
// here CALLS the existing gym modules rather than re-deriving: receiptFor
// owns what a PR is, trendLine owns how a climb is worded. Derive once.

/** A PR or a trend older than this is history, not news. */
export const FRESH_DAYS = 14;

export interface TrainingSummary {
  sessionsThisWeek: number;
  /** Mon..Sun of the week holding `today`; true = trained that day. */
  weekDots: boolean[];
  last: { dayName: string; date: string; minutes: number; exercises: number } | null;
  pr: { name: string; text: string; date: string } | null;
  trending: { name: string; line: string } | null;
}

/** Monday of the week holding the local day, as ISO. Weeks run Mon to Sun,
 *  the same convention the goal cadence window uses. */
export function mondayOf(today: string): string {
  const d = new Date(today + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loggedExercises(exs: WorkoutExercise[]): number {
  return exs.filter((ex) => !ex.skipped && ex.sets.some((s) => !s.skipped)).length;
}

export function trainingSummary(workouts: Workout[], today: string): TrainingSummary {
  const sorted = [...workouts].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.startedAt - a.data.startedAt);

  // The week strip: dots for the Monday-to-Sunday week holding today.
  const mon = mondayOf(today);
  const dots = new Array<boolean>(7).fill(false);
  let sessions = 0;
  for (const w of workouts) {
    const off = daysBetween(mon, w.data.date);
    if (w.data.date >= mon && off <= 6) {
      dots[off] = true;
      sessions++;
    }
  }

  const newest = sorted[0] ?? null;
  const last = newest
    ? {
        dayName: newest.data.dayName,
        date: newest.data.date,
        minutes: Math.max(1, Math.round((newest.data.endedAt - newest.data.startedAt) / 60000)),
        exercises: loggedExercises(newest.data.exercises),
      }
    : null;

  // Freshest PR inside the window, judged exactly the way the receipt judged
  // it the day it happened: against only the workouts that came before.
  let pr: TrainingSummary["pr"] = null;
  for (const w of sorted) {
    if (daysBetween(w.data.date, today) > FRESH_DAYS) break;
    const before = workouts.filter((x) => x.data.startedAt < w.data.startedAt);
    const hit = receiptFor(w.data.exercises, before, w.data.startedAt, w.data.endedAt).prs[0];
    if (hit) { pr = { name: hit.name, text: hit.text, date: w.data.date }; break; }
  }

  // One climbing exercise: 3+ sessions, trained recently, last beats first.
  // The PR already owns its exercise for the fortnight; trending shows the
  // next story, not the same one twice.
  let trending: TrainingSummary["trending"] = null;
  for (const row of exerciseHistory(workouts)) {
    if (row.sessions < 3) continue;
    if (daysBetween(row.last.date, today) > FRESH_DAYS) continue;
    if (!beats(row.kind, row.last.set, row.first.set)) continue;
    if (pr && row.name === pr.name) continue;
    trending = { name: row.name, line: trendLine(row) };
    break;
  }

  return { sessionsThisWeek: sessions, weekDots: dots, last, pr, trending };
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Past-tense day phrase: Today, Yesterday, a weekday inside the week, then
 *  "Aug 3". dayPhrase() looks forward (dues); this looks back (sessions). */
export function agoPhrase(iso: string, today: string): string {
  const gap = daysBetween(iso, today);
  if (gap <= 0) return "Today";
  if (gap === 1) return "Yesterday";
  const d = new Date(iso + "T12:00:00");
  if (gap <= 6) return WD[d.getDay()]!;
  return `${MO[d.getMonth()]} ${d.getDate()}`;
}

/** agoPhrase shaped for mid-sentence use ("Last trained today"): the
 *  relative words drop their caps; weekday and month forms keep theirs. */
export function agoPhraseLower(iso: string, today: string): string {
  const p = agoPhrase(iso, today);
  return p === "Today" || p === "Yesterday" ? p.toLowerCase() : p;
}
