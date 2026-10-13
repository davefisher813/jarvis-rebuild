// Auto-Sweep (addendum item 9, Group A). At the FIRST open of a new day,
// unfinished dated tasks move forward to today. Events never move. Bills
// never move (the same carve-out as swipe-snooze: behaviors that protect
// feelings on tasks hide rent on bills). The receipt banner states what
// moved with undo; a FAILED sweep renders the error-receipt form, louder
// than success, with tap-to-retry: silent automation may never fail silently.
//
// The third consecutive move of one task is a pattern, not a nag: the app
// states the fact once and offers Set Aside (the existing lifecycle), then
// never asks about that task again. Uses the existing slips counter.

import type { TasksService, TaskItem } from "./TasksService";
import { todayISO } from "./grouping";

export interface SweepMoved {
  id: string;
  prevDue: string;
  text: string;
  slips: number;
}

export interface SweepReceipt {
  date: string; // the day this sweep ran for
  moved: SweepMoved[];
  failed: boolean;
  // The tasks that still exist and did NOT move (issue 102). Failure is per
  // task: one task that cannot be written must not read as the whole sweep
  // failing, and Retry resumes exactly these. Absent on a receipt written by
  // an older build, and on a sweep that could not run at all (the list itself
  // failed); `failed` with no ids means "the whole sweep".
  failedIds?: string[];
}

const LAST_KEY = "jarvis.sweep.last.v1";
const RECEIPT_KEY = "jarvis.sweep.receipt.v1";
// v2: the offered list used to be a bare array of ids that never expired, so
// one dismissal muted a task forever (Law 2, below). Now each entry carries
// the day it was dismissed and ages out.
const OFFERED_KEY = "jarvis.sweep.offered.v2";
export const SET_ASIDE_AFTER = 3;
// LAW 2: A DISMISSAL EXPIRES. Three days is long enough that waving a card
// off actually buys quiet, and short enough that a task sliding for a week
// gets to speak again. Forever-silence and daily-nagging are both failures.
export const DISMISS_DAYS = 3;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function sweepAlreadyRan(today: string): boolean {
  const s = storage();
  if (!s) return true; // no storage, no sweep: never move things twice
  try { return s.getItem(LAST_KEY) === today; } catch { return true; }
}

function markRan(today: string): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(LAST_KEY, today); } catch { /* the next open retries */ }
}

export function readReceipt(today: string): SweepReceipt | null {
  const s = storage();
  if (!s) return null;
  try {
    const r = JSON.parse(s.getItem(RECEIPT_KEY) || "null") as SweepReceipt | null;
    return r && r.date === today ? r : null;
  } catch {
    return null;
  }
}

function writeReceipt(r: SweepReceipt): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(RECEIPT_KEY, JSON.stringify(r)); } catch { /* receipt is display */ }
}

export function clearReceipt(): void {
  const s = storage();
  if (!s) return;
  try { s.removeItem(RECEIPT_KEY); } catch { /* gone */ }
}

// Which tasks a sweep touches: dated before today, not done, not a bill,
// not set aside (asideFrom implies due was cleared, so due catches it).
// 2026-09-11: not recurring either, as Set Aside and Fresh Start already
// rule: a recurring task keeps its weekday/month-day anchor (LIFE-F-03), and
// moving it re-dated a monthly task and counted slips against a habit.
export function sweepable(items: TaskItem[], today: string): TaskItem[] {
  return items.filter((t) => !t.data.done && !t.data.bill && !t.data.recurrence && !!t.data.due && t.data.due < today);
}

// Move each target to today, one task at a time. A failure is per task and
// never throws out of the loop (issue 102, "moving yesterday's tasks fails
// daily"): the old code kept ONE boolean, so a single stuck task failed the
// whole sweep and Retry, which re-attempted the same task, failed again,
// every day.
//
// A setDue that answers false means the row is not there to move (or the
// write was refused). If the task is gone, it no longer needs moving: that is
// not a failure Retry could ever clear, so it is dropped silently. If the task
// is still there and did not move, or the write threw, it is a real failure
// and its id is kept so Retry can resume it.
async function moveTargets(svc: TasksService, targets: TaskItem[], today: string): Promise<{ moved: SweepMoved[]; failedIds: string[] }> {
  const moved: SweepMoved[] = [];
  const failedIds: string[] = [];
  for (const t of targets) {
    try {
      // UP-CORE-05 (2026-09-05): the sweep says so on the task itself, not
      // only in its own receipt. The receipt is one card on Today that can
      // be waved off; the row is where he meets the task again next week.
      const ok = await svc.setDue(t.id, today, "sweep");
      if (ok) moved.push({ id: t.id, prevDue: t.data.due!, text: t.data.text, slips: (t.data.slips ?? 0) + 1 });
      else if (await svc.task(t.id)) failedIds.push(t.id);
    } catch {
      failedIds.push(t.id);
    }
  }
  return { moved, failedIds };
}

// Run the sweep once for today. Returns the receipt (also persisted for the
// banner). A partial failure still reports what moved and names the tasks that
// did not (failedIds), so the notice can say so and Retry re-attempts only
// those (the per-task setDue is idempotent against today).
export async function runAutoSweep(svc: TasksService, today: string): Promise<SweepReceipt | null> {
  if (sweepAlreadyRan(today)) return readReceipt(today);
  const items = await svc.listTasks();
  const targets = sweepable(items, today);
  markRan(today); // even a zero-target day counts as ran
  if (targets.length === 0) return null;
  const { moved, failedIds } = await moveTargets(svc, targets, today);
  const receipt: SweepReceipt = { date: today, moved, failed: failedIds.length > 0, failedIds };
  writeReceipt(receipt);
  return receipt;
}

// Retry a failed sweep. When the receipt names the tasks that did not move,
// only those are re-attempted and the result is MERGED into the earlier
// receipt: the first run's moves stay on it (Undo and the "N Moved to Today"
// card read them), and the receipt is always rewritten so a stale failed one
// cannot come back on the next mount. A receipt with no ids (an older build,
// or a sweep whose list failed) falls back to a whole sweep again.
export async function retrySweep(svc: TasksService, today: string): Promise<SweepReceipt | null> {
  const prev = readReceipt(today);
  if (prev && prev.failedIds && prev.failedIds.length > 0) {
    const again = new Set(prev.failedIds);
    const items = await svc.listTasks();
    // A failed id that is no longer sweepable resolved itself (done, deleted,
    // re-dated): it is not retried and not a failure.
    const targets = sweepable(items, today).filter((t) => again.has(t.id));
    const { moved, failedIds } = await moveTargets(svc, targets, today);
    const merged: SweepReceipt = { date: today, moved: [...prev.moved, ...moved], failed: failedIds.length > 0, failedIds };
    writeReceipt(merged);
    return merged;
  }
  const s = storage();
  try { s?.removeItem(LAST_KEY); } catch { /* retry proceeds anyway */ }
  const fresh = await runAutoSweep(svc, today);
  // Whatever the earlier (failed, id-less) receipt had moved is still history.
  const carried = prev?.moved ?? [];
  if (!fresh) {
    // Nothing left to move: a stale failed receipt must not outlive that.
    if (carried.length === 0) { clearReceipt(); return null; }
    const done: SweepReceipt = { date: today, moved: carried, failed: false, failedIds: [] };
    writeReceipt(done);
    return done;
  }
  if (carried.length === 0) return fresh;
  const seen = new Set(fresh.moved.map((m) => m.id));
  const merged: SweepReceipt = { ...fresh, moved: [...carried.filter((m) => !seen.has(m.id)), ...fresh.moved] };
  writeReceipt(merged);
  return merged;
}

// Undo the whole sweep: every task back to its prior date. The receipt goes
// with it (undone means nothing to report). Only ever reached from a control
// LABELLED as an undo -- see the note on Dismiss in TodayFlow.
export async function undoSweep(svc: TasksService, receipt: SweepReceipt): Promise<void> {
  for (const m of receipt.moved) await svc.setDue(m.id, m.prevDue);
  clearReceipt();
}

// LAW 1: A NOTICE MUST PROVE ITSELF BEFORE IT RENDERS (Dave 2026-08-29,
// "notifications show up on things that are already done").
//
// The receipt records what the sweep DID at first open this morning. That is
// history, and it has to stay whole -- Undo reads every entry, including the
// ones already handled. But it is NOT an answer to "what still needs me",
// and the cards were reading it as though it were: finish all six moved
// tasks and "6 Moved to Today" still said six, because nothing between the
// receipt and the card ever looked at a task again.
//
// So every display read goes through here, against the live list. A moved
// task that has since been completed, deleted, set aside, or given some
// other date is no longer part of what these cards are reporting. The
// receipt is a hint about what to check; the tasks are the truth.
export function liveMoved(receipt: SweepReceipt | null, items: TaskItem[], today: string): SweepMoved[] {
  if (!receipt) return [];
  const byId = new Map(items.map((t) => [t.id, t] as const));
  return receipt.moved.filter((m) => {
    const t = byId.get(m.id);
    if (!t) return false;                 // deleted since the sweep
    if (t.data.done) return false;        // THE bug Dave photographed
    return t.data.due === today;          // re-dated or set aside: not today's news
  });
}

// The same proof for the failure notice (issue 102): the persisted failed
// receipt is history, not status. It said "these did not move"; the tasks say
// whether that is still true. A task since done, deleted, set aside or given
// a date from today on no longer needs moving, so a stale failed receipt can
// never bring the notice back. Returns the ids still stuck, or null when the
// receipt carries no ids (the whole sweep could not run, or an older build
// wrote it): then there is nothing to check against and the notice stands
// until a retry settles it.
export function liveFailed(receipt: SweepReceipt | null, items: TaskItem[], today: string): string[] | null {
  if (!receipt || !receipt.failed) return [];
  if (!receipt.failedIds) return null;
  const byId = new Map(items.map((t) => [t.id, t] as const));
  return receipt.failedIds.filter((id) => {
    const t = byId.get(id);
    return !!t && !t.data.done && !!t.data.due && t.data.due < today;
  });
}

// The "N Moved to Today" card, waved off for the day. Same day-keyed shape
// as every other dismissal here: tomorrow's sweep is a new fact and gets to
// speak. Separate from undoSweep, which is a real edit under its own label.
const SWEEP_DISMISSED_KEY = "jarvis.sweep.dismissed.v1";

export function dismissSweepCard(today: string): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(SWEEP_DISMISSED_KEY, today); } catch { /* the card stays; harmless */ }
}

export function sweepCardDismissed(today: string): boolean {
  const s = storage();
  if (!s) return false;
  try { return s.getItem(SWEEP_DISMISSED_KEY) === today; } catch { return false; }
}

type Offer = { id: string; day: string };

function readOffered(today: string): Offer[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(OFFERED_KEY) || "[]") as Offer[];
    const cutoff = dayShift(today, -DISMISS_DAYS);
    return raw.filter((o) => o && typeof o.id === "string" && o.day > cutoff);
  } catch {
    return [];
  }
}

// today minus n days, as an ISO date. Local-noon arithmetic so a DST shift
// cannot round the date backwards.
//
// LIFE-F-20 (2026-09-05): the result was read through toISOString(), the
// UTC day, and beyond UTC+12 (Auckland in summer, Apia, Tongatapu) local
// noon is still yesterday in UTC, so the cutoff sat a day off and the
// three-day quiet after a dismissal was four. todayISO formats from local
// getters.
function dayShift(today: string, days: number): string {
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

// The third-move fact + Set Aside offer. Takes the LIVE-filtered moved list
// (see liveMoved) rather than the raw receipt, so it can never nominate a
// task that is already done. A dismissal quiets it for DISMISS_DAYS.
export function setAsideCandidate(moved: SweepMoved[], today: string): SweepMoved | null {
  const offered = readOffered(today);
  return moved.find((m) => m.slips >= SET_ASIDE_AFTER && !offered.some((o) => o.id === m.id)) ?? null;
}

export function markOffered(id: string, today: string): void {
  const s = storage();
  if (!s) return;
  try {
    const offered = readOffered(today).filter((o) => o.id !== id);
    offered.push({ id, day: today });
    s.setItem(OFFERED_KEY, JSON.stringify(offered));
  } catch { /* asked-once is best effort */ }
}
