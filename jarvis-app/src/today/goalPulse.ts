import type { TaskItem } from "../tasks/TasksService";
import type { Goal } from "../life/types";
import type { GoalIndex, GoalReach } from "../bigger/reach";
import { goalIdsForTask } from "../bigger/reach";
import { distinctiveTokens } from "../bigger/related";
import { daysBetween } from "../upnext/upnext";
import { capAfterNumber } from "../shared/casing";

// ---------------------------------------------------------------------------
// THE HOME PAGE LOOKS UP (Dave 2026-08-22, picks 1, 2, 3, 4, 5, 31).
//
// Dave: "it's the mother of tasks so why does it feel [absent] at all?" The
// answer was that Today never once mentioned a goal. Every number on the home
// screen counted work by SHAPE (events, due, overdue) and never by what the
// work was for, so the most important thing in the app lived two taps away on
// a page he had no reason to open.
//
// Everything here is pure and derived from the same upward index the Bigger
// Picture uses, so the home page and the goal page can never disagree.
// ---------------------------------------------------------------------------

// --- PICK 31: LINEAGE ONLY WHEN IT MATTERS ---------------------------------
//
// "Moves Ship the App Store Launch" under a task called "Ship the App Store
// Launch" is furniture. It costs a line, it survives truncation better than
// the task title does, and it says nothing the reader did not just read. The
// line earns its place only when the goal names something the task does not.

/**
 * The lineage line for a task, or null when it would only repeat the task.
 * Null when every distinctive word in the goal already appears in the task.
 */
export function movesLine(goalTitle: string | null | undefined, taskText: string): string | null {
  const title = (goalTitle ?? "").trim();
  if (!title) return null;
  const goalWords = distinctiveTokens(title);
  if (goalWords.size > 0) {
    const taskWords = distinctiveTokens(taskText);
    let shared = 0;
    for (const w of goalWords) if (taskWords.has(w)) shared++;
    if (shared === goalWords.size) return null; // the task already said it
  }
  return "Moves " + title;
}

// --- PICK 5: THE HERO COUNTS WHAT MATTERS, NOT ONLY WHAT IS DUE -------------

/** How many of today's tasks move something the user is working toward. */
export function movesCount(idx: GoalIndex, tasks: TaskItem[]): number {
  if (idx.size === 0) return 0;
  return tasks.filter((t) => !t.data.done && goalIdsForTask(idx, t).length > 0).length;
}

/** "moves a goal" / "move a goal". A count of one is still one task. */
export function movesPillLabel(n: number): string {
  return n === 1 ? "moves a goal" : "move a goal";
}

// --- PICK 4: THE END OF THE DAY SAYS WHAT MOVED -----------------------------
//
// Time Sense samples are DEVICE-LOCAL, so absence of evidence is not evidence
// of absence: this speaks only about completions it actually saw, and says
// nothing at all when it saw none. It never claims a goal did not move.

/** Distinct goal titles moved by tasks completed today, in index order. */
export function goalsMovedToday(
  idx: GoalIndex,
  tasks: TaskItem[],
  samples: { id?: string; t: number }[],
  dayStart: number,
  dayEnd: number,
): string[] {
  if (idx.size === 0) return [];
  const doneIds = new Set(
    samples.filter((s) => s.id && s.t >= dayStart && s.t < dayEnd).map((s) => s.id!),
  );
  if (doneIds.size === 0) return [];
  const out: string[] = [];
  for (const t of tasks) {
    if (!doneIds.has(t.id)) continue;
    for (const gid of goalIdsForTask(idx, t)) {
      const title = idx.titleOf.get(gid);
      if (title && !out.includes(title)) out.push(title);
    }
  }
  return out;
}

/** The evening segment, or null when nothing was seen to move. */
export function movedLine(titles: string[]): string | null {
  if (titles.length === 0) return null;
  if (titles.length === 1) return "Moved " + titles[0];
  return capAfterNumber(`Moved ${titles.length} goals`);
}

// --- PICK 3: A GOAL NOTHING TODAY TOUCHES -----------------------------------
//
// Not "stalled" in the Time Sense way, which needs weeks of silence to speak.
// This is the question a home page should ask every single morning: you said
// you want this, it has open work, and nothing on today's plate moves it.
// One at a time, the most invested one first, dismissible for the day.

export interface DismissStore { read(): string | null; write(v: string): void }

const KEY = "jarvis.goalnudge.dismissed.v1";
const QUIET_DAYS = 3;

function localStore(): DismissStore {
  return {
    read: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    write: (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
  };
}

export function isGoalNudgeDismissed(goalId: string, todayIso: string, store: DismissStore = localStore()): boolean {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    const when = d[goalId];
    return !!when && daysBetween(when, todayIso) < QUIET_DAYS;
  } catch {
    return false;
  }
}

export function dismissGoalNudge(goalId: string, todayIso: string, store: DismissStore = localStore()): void {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    d[goalId] = todayIso;
    store.write(JSON.stringify(d));
  } catch { /* private mode */ }
}

/** Open work a goal still has, both routes. */
export function openWorkOf(r: GoalReach): number {
  const filedOpen = r.progress ? r.progress.total - r.progress.done : 0;
  return filedOpen + r.openTagged;
}

/**
 * The one goal to interrupt about: live, has open work, and NOTHING on
 * today's plate points at it. Most open work leads, because that is the one
 * with the most already invested in it. Null when today already covers
 * every goal, which is the normal and quiet case.
 */
export function untouchedGoal(
  idx: GoalIndex,
  goals: Goal[],
  reachOf: (id: string) => GoalReach,
  todaysTasks: TaskItem[],
  todayIso: string,
  store: DismissStore = localStore(),
): Goal | null {
  if (idx.size === 0) return null;
  const covered = new Set<string>();
  for (const t of todaysTasks) {
    if (t.data.done) continue;
    for (const gid of goalIdsForTask(idx, t)) covered.add(gid);
  }
  return (
    goals
      .filter((g) => g.data.state !== "achieved")
      .filter((g) => !covered.has(g.id))
      .filter((g) => !isGoalNudgeDismissed(g.id, todayIso, store))
      .map((g) => ({ g, open: openWorkOf(reachOf(g.id)) }))
      .filter((x) => x.open > 0)
      .sort((a, b) => b.open - a.open)
      .map((x) => x.g)[0] ?? null
  );
}

/** The nudge's evidence line. Counts, never a scolding. */
export function untouchedLine(open: number): string {
  return capAfterNumber(`${open} open · Nothing today moves it`);
}
