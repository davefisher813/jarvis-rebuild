import type { TaskItem } from "../tasks/TasksService";

// Up Next: the one-card engine (ADHD strategy Phase 1). Pure and deterministic:
// given the task list and "today", produce the single best next task, the
// Quick Wins run, and the Fresh Start split. No AI, no clock reads in here;
// callers pass time in so every rule is testable.

const DAY = 86400000;
const atMidnight = (iso: string) => new Date(iso + "T00:00:00");

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((atMidnight(toISO).getTime() - atMidnight(fromISO).getTime()) / DAY);
}

// Open tasks ranked: overdue first (oldest due leads), then due today, then
// upcoming soonest, then no-date. This is the deck order for Next mode.
export function rankOpen(tasks: TaskItem[], today: string): TaskItem[] {
  // Weeklies and monthlies surface on their day only (roadmap v2): a recurring
  // task due later never enters the deck early. It has a day; it will come.
  const open = tasks.filter(
    // Reminders never enter the deck (2026-08-19): "take your meds" is not a
    // candidate for what to work on next, and Up Next is a work queue.
    (t) => !t.data.done && !t.data.reminder
      && !(t.data.recurrence && t.data.due && daysBetween(today, t.data.due) > 0),
  );
  const key = (t: TaskItem): string => {
    const due = t.data.due;
    if (!due) return "3~";
    const diff = daysBetween(today, due);
    if (diff < 0) return "0~" + due; // overdue: oldest first
    if (diff === 0) return "1~";
    return "2~" + due; // upcoming: soonest first
  };
  return [...open].sort((a, b) => key(a).localeCompare(key(b)));
}

// The single next card, honoring skips (skipped ids go to the back of the
// deck, they never disappear).
export function pickNext(tasks: TaskItem[], today: string, skipped: string[] = []): TaskItem | null {
  const ranked = rankOpen(tasks, today);
  if (ranked.length === 0) return null;
  const fresh = ranked.filter((t) => !skipped.includes(t.id));
  return fresh[0] ?? ranked[0] ?? null;
}

// The one-line "why this card" (design law: every automatic pick is explained).
// No shame vocabulary: an overdue task has been "waiting", it is never "OVERDUE".
export function reasonFor(t: TaskItem, today: string, inPeak: boolean): string {
  const parts: string[] = [];
  const due = t.data.due;
  if (due) {
    const diff = daysBetween(today, due);
    if (diff < 0) parts.push(diff === -1 ? "Waiting since yesterday" : `Waiting ${-diff} days`);
    else if (diff === 0) parts.push("Due today");
    else if (diff === 1) parts.push("Due tomorrow");
    else parts.push(`Due in ${diff} days`);
  } else {
    parts.push("No deadline");
  }
  if (inPeak) parts.push("your focus peak");
  return parts.join(" · ");
}

// Quick Wins: a short run off the top of the deck. Same honest ranking, capped;
// we make no duration claims we cannot verify.
export const QUICK_WINS_COUNT = 5;
export function quickWins(tasks: TaskItem[], today: string): TaskItem[] {
  return rankOpen(tasks, today).slice(0, QUICK_WINS_COUNT);
}

// --- Fresh Start ---

export interface FreshStartPlan {
  keep: TaskItem[]; // stays today (top of the deck, capped)
  move: TaskItem[]; // due moves to tomorrow
}

export const FRESH_KEEP = 3;

// A day is "off track" when it is afternoon, at least 3 due-or-overdue tasks
// are still open, and under a third of today's load is done. All three, so the
// banner is rare and honest, never a daily fixture.
export function isOffTrack(tasks: TaskItem[], today: string, nowMin: number): boolean {
  if (nowMin < 13 * 60) return false;
  const dueish = tasks.filter((t) => t.data.due && daysBetween(today, t.data.due) <= 0);
  const open = dueish.filter((t) => !t.data.done);
  if (open.length < 3) return false;
  const done = dueish.length - open.length;
  return done / Math.max(1, dueish.length) < 0.34;
}

// The split: keep the top FRESH_KEEP of the deck (due-or-overdue only), move
// the rest of today's open load to tomorrow. Recurring tasks roll on their own
// schedule and are never moved.
export function freshStartPlan(tasks: TaskItem[], today: string): FreshStartPlan {
  const openDue = rankOpen(tasks, today).filter(
    (t) => t.data.due && daysBetween(today, t.data.due) <= 0 && !t.data.recurrence,
  );
  return { keep: openDue.slice(0, FRESH_KEEP), move: openDue.slice(FRESH_KEEP) };
}

export function tomorrowOf(today: string): string {
  const d = atMidnight(today);
  d.setDate(d.getDate() + 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}
