import type { TaskItem } from "./TasksService";
import type { TaskData, Recurrence } from "../notes/types";
import { daysBetween } from "../upnext/upnext";

// Lifecycle policy (ADHD strategy Phase 1): tasks age with dignity. Set Aside
// clears the ancient-overdue graveyard, First Step targets the task that keeps
// sliding, Back On Track welcomes a streak home. Pure functions; callers own
// storage and UI.

// --- Set Aside ---

// A task qualifies for Set Aside when it has been sitting overdue for more
// than 14 days: at that point the red wall is shame, not information. It is
// moved (due cleared), never deleted, and the previous due survives for Undo.
// BILLS ARE EXCLUDED (Money v1): sweeping overdue rent out of view to protect
// feelings is how a late fee becomes an eviction notice. An overdue bill is
// information, and it stays.
export const SET_ASIDE_AFTER_DAYS = 14;

export function setAsideCandidates(tasks: TaskItem[], today: string): TaskItem[] {
  return tasks.filter(
    (t) =>
      !t.data.done &&
      !t.data.bill &&
      !t.data.recurrence &&
      !!t.data.due &&
      daysBetween(t.data.due, today) > SET_ASIDE_AFTER_DAYS,
  );
}

// --- First Step ---

// The task that keeps sliding: open, non-recurring, overdue 5+ days (or pushed
// back 3+ times), oldest first. One offer at a time, ever.
// BILLS ARE EXCLUDED (Money v1): "break Pay Rent into a smaller step" is
// nonsense; the bill's own pay link is the money version of a first step.
export const FIRST_STEP_OVERDUE_DAYS = 5;
export const FIRST_STEP_SLIPS = 3;

export function firstStepCandidate(tasks: TaskItem[], today: string, pausedCats?: ReadonlySet<string>): TaskItem | null {
  const slipping = tasks
    .filter((t) => !t.data.done && !t.data.recurrence && !t.data.bill)
    // Season pause (org categories): a paused category gets no offers.
    .filter((t) => !pausedCats?.has(t.data.category ?? ""))
    .filter((t) => {
      const byAge = !!t.data.due && daysBetween(t.data.due, today) >= FIRST_STEP_OVERDUE_DAYS;
      const byPushes = (t.data.slips ?? 0) >= FIRST_STEP_SLIPS;
      return byAge || byPushes;
    })
    .sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"));
  return slipping[0] ?? null;
}

// Dismissal memory (same shape as pattern dismissals): a dismissed First Step
// offer stays gone for 7 days per task.
const FS_DISMISS_KEY = "jarvis.firststep.dismissed";

export function isFirstStepDismissed(taskId: string, todayIso: string): boolean {
  try {
    const d = JSON.parse(localStorage.getItem(FS_DISMISS_KEY) || "{}") as Record<string, string>;
    const when = d[taskId];
    if (!when) return false;
    return daysBetween(when, todayIso) < 7;
  } catch {
    return false;
  }
}

export function dismissFirstStep(taskId: string, todayIso: string): void {
  try {
    const d = JSON.parse(localStorage.getItem(FS_DISMISS_KEY) || "{}") as Record<string, string>;
    d[taskId] = todayIso;
    localStorage.setItem(FS_DISMISS_KEY, JSON.stringify(d));
  } catch {
    /* private mode */
  }
}

// --- Back On Track (streaks that pause, never die) ---

// Completion interval per recurrence, in days, with slack: a weekly task done
// 8 days later is still "on the run". Anything within slack keeps the run.
function intervalDays(rec: Recurrence): number {
  if (rec === "daily") return 1;
  if (rec === "weekly") return 7;
  if (rec === "monthly") return 31;
  return 3; // weekdays: a weekend gap is normal
}

// Next streak state after completing a recurring task today. Contiguous
// completions extend the run; a gap starts a fresh run at 1 but remembers the
// best. Rest days inside the slack window never break anything.
export function nextStreak(data: TaskData, today: string): { lastDone: string; runLen: number; bestRun: number } {
  const rec = data.recurrence;
  const last = data.lastDone;
  const prevLen = data.runLen ?? 0;
  const best = data.bestRun ?? 0;
  if (!rec || !last) return { lastDone: today, runLen: 1, bestRun: Math.max(best, 1) };
  const gap = daysBetween(last, today);
  const contiguous = gap <= intervalDays(rec) + 1; // +1 slack: one slow day is not a break
  const runLen = contiguous ? prevLen + 1 : 1;
  return { lastDone: today, runLen, bestRun: Math.max(best, runLen, prevLen) };
}

// Whether a run is still alive TODAY: the same contiguity window nextStreak
// uses to extend it. runLen only changes on completion, so a run that stopped
// in March still says 12 forever; without this gate a page would show it as
// current. A dead run is not shamed anywhere, it just stops being presented
// as live (bestRun still remembers it).
export function streakAlive(data: TaskData, today: string): boolean {
  const rec = data.recurrence;
  const last = data.lastDone;
  if (!rec || !last || (data.runLen ?? 0) < 1) return false;
  return daysBetween(last, today) <= intervalDays(rec) + 1;
}

// The Back On Track moment: completing a recurring task after a real gap, when
// the run it pauses was worth naming. Returns the toast line or null.
export function backOnTrackMessage(data: TaskData, today: string): string | null {
  const rec = data.recurrence;
  const last = data.lastDone;
  const prevLen = data.runLen ?? 0;
  if (!rec || !last || data.done) return null;
  const gap = daysBetween(last, today);
  if (gap <= intervalDays(rec) + 1) return null; // no gap, no ceremony
  if (prevLen < 3) return null; // a short run does not need a comeback story
  return `Back on track · ${prevLen}-day run still counts`;
}
