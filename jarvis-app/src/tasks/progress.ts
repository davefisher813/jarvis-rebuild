import type { TaskData, TaskStep, WorkedOn } from "../notes/types";

// The pure arithmetic and wording behind "where this stands". Counts are of
// the task's own steps and nothing else: no percentage, no score, no
// comparison with any other task or day.

export interface StepCounts { done: number; total: number }

/** Blank lines are not steps (TasksService drops them on write too). */
export function stepCounts(steps: readonly TaskStep[] | undefined): StepCounts {
  const real = (steps ?? []).filter((s) => s.text.trim().length > 0);
  return { done: real.filter((s) => s.done).length, total: real.length };
}

export const WORKED_CAP = 30;
/** The same note logged again inside this window is the same tap arriving
 *  twice (a double tap, a retry), not a second piece of work. */
export const WORKED_DUPLICATE_MS = 30_000;

/** Add one entry, or report that it was a repeat. Pure, so the service and
 *  the tests share one rule. */
export function addWorked(
  list: readonly WorkedOn[] | undefined,
  note: string | undefined,
  now: Date,
): { list: WorkedOn[]; changed: boolean } {
  const prior = list ?? [];
  const clean = note?.trim() ? note.trim().slice(0, 200) : undefined;
  const last = prior[prior.length - 1];
  if (last && (last.note ?? undefined) === clean && now.getTime() - Date.parse(last.at) < WORKED_DUPLICATE_MS) {
    return { list: [...prior], changed: false };
  }
  const entry: WorkedOn = clean ? { at: now.toISOString(), note: clean } : { at: now.toISOString() };
  return { list: [...prior, entry].slice(-WORKED_CAP), changed: true };
}

export function lastWorked(data: TaskData | undefined): WorkedOn | null {
  const w = data?.worked;
  return w && w.length ? w[w.length - 1]! : null;
}

const DAY_MS = 86_400_000;

/** "Today", "Yesterday", "3 Days Ago": a plain fact about when, with no
 *  suggestion that more time should have passed or less. `today` is the local
 *  date as YYYY-MM-DD. */
export function whenWorked(at: string, today: string): string {
  const day = at.slice(0, 10);
  const a = Date.parse(day + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "Recently";
  const n = Math.round((b - a) / DAY_MS);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  return `${n} Days Ago`;
}
