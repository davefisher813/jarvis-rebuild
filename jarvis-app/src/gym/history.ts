import type { Workout, SetLog, MeasureKind } from "./types";
import { beats, formatSet, scoreOf } from "./measures";
import { daysBetween } from "../upnext/upnext";

// The history page (gym session 2): per-exercise numbers over time, derived
// and dated. "Bench: 115 lb × 8 -> 135 lb × 8 over 8 weeks" lands harder than
// any badge because nobody typed it. Gaps are just gaps: no gap math, no
// "you've lost progress", ever.

export interface HistoryRow {
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  sessions: number;
  first: { set: SetLog; date: string };
  best: { set: SetLog; date: string };
  last: { set: SetLog; date: string };
  entries: { date: string; text: string }[]; // newest first, per session best
}

/** Best real entry of one exercise within one workout. */
function bestOf(kind: MeasureKind, sets: SetLog[]): SetLog | null {
  let best: SetLog | null = null;
  for (const s of sets) {
    if (s.skipped || !scoreOf(kind, s)) continue;
    if (!best || beats(kind, s, best)) best = s;
  }
  return best;
}

/** One row per exercise name+kind, most recently trained first. */
export function exerciseHistory(workouts: Workout[]): HistoryRow[] {
  const rows = new Map<string, HistoryRow>();
  const sorted = [...workouts].sort((a, b) => a.data.date.localeCompare(b.data.date));
  for (const w of sorted) {
    for (const ex of w.data.exercises) {
      const sessionBest = bestOf(ex.kind, ex.sets);
      if (!sessionBest) continue; // Done-only and skipped work leaves no numbers
      const key = ex.name + "\u0000" + ex.kind;
      const entry = { date: w.data.date, text: formatSet(ex, sessionBest) };
      const row = rows.get(key);
      if (!row) {
        rows.set(key, {
          name: ex.name, kind: ex.kind, unit: ex.unit, timeUnit: ex.timeUnit,
          sessions: 1,
          first: { set: sessionBest, date: w.data.date },
          best: { set: sessionBest, date: w.data.date },
          last: { set: sessionBest, date: w.data.date },
          entries: [entry],
        });
      } else {
        row.sessions++;
        row.last = { set: sessionBest, date: w.data.date };
        if (beats(ex.kind, sessionBest, row.best.set)) row.best = { set: sessionBest, date: w.data.date };
        row.entries.push(entry);
      }
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.entries.reverse(); // newest first for the receipts list
  out.sort((a, b) => b.last.date.localeCompare(a.last.date));
  return out;
}

/**
 * The trend line. One session: just the numbers. More: "first -> latest",
 * with the honest span when it covers real time. Never a percentage, never a
 * decline framing: the numbers ARE the story, whichever way they moved.
 */
export function trendLine(row: HistoryRow): string {
  const ex = { kind: row.kind, unit: row.unit, timeUnit: row.timeUnit };
  if (row.sessions === 1) return formatSet(ex, row.last.set);
  const span = daysBetween(row.first.date, row.last.date);
  const weeks = Math.round(span / 7);
  const arrow = `${formatSet(ex, row.first.set)} → ${formatSet(ex, row.last.set)}`;
  return weeks >= 2 ? `${arrow} over ${weeks} weeks` : arrow;
}

/**
 * THE `done` BLIND SPOT FIX (catalog §4.8): "you've done this 14 times" for
 * work that produces no numbers at all. A COUNT of things that happened --
 * never a streak (no "in a row"), never red, never a target to hit.
 * exerciseHistory skips done-kind work entirely (scoreOf(done) is null, so it
 * has no best to rank), so this counts it separately by name.
 */
export function doneCount(workouts: Workout[], name: string): number {
  let n = 0;
  for (const w of workouts) {
    for (const ex of w.data.exercises) {
      if (ex.kind !== "done" || ex.name !== name || ex.skipped) continue;
      if (ex.sets.some((s) => s.done && !s.skipped)) n++;
    }
  }
  return n;
}

/**
 * HOW IT MOVED, as a fact (catalog §4.5). Counts observable events already
 * logged against an exercise -- never a prescription, never a percentage,
 * never phrased as decline. Null when nothing has ever been marked, so a
 * screen that reads null renders nothing rather than "0 grinds".
 */
export function movedFact(workouts: Workout[], name: string): string | null {
  let grind = 0, missed = 0, total = 0;
  for (const w of workouts) {
    for (const ex of w.data.exercises) {
      if (ex.name !== name || ex.skipped) continue;
      for (const s of ex.sets) {
        if (s.skipped || !s.moved) continue;
        total++;
        if (s.moved === "grind") grind++;
        else if (s.moved === "missed") missed++;
      }
    }
  }
  if (total === 0) return null;
  const bits: string[] = [];
  if (grind > 0) bits.push(`a grind ${grind} of the last ${total} sets`);
  if (missed > 0) bits.push(`missed ${missed} of ${total}`);
  if (bits.length === 0) return `All clean across the last ${total} marked sets`;
  return bits.map((b, i) => (i === 0 ? b.charAt(0).toUpperCase() + b.slice(1) : b)).join(", ");
}
