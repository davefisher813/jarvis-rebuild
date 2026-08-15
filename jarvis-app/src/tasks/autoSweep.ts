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
}

const LAST_KEY = "jarvis.sweep.last.v1";
const RECEIPT_KEY = "jarvis.sweep.receipt.v1";
const OFFERED_KEY = "jarvis.sweep.offered.v1";
export const SET_ASIDE_AFTER = 3;

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
export function sweepable(items: TaskItem[], today: string): TaskItem[] {
  return items.filter((t) => !t.data.done && !t.data.bill && !!t.data.due && t.data.due < today);
}

// Run the sweep once for today. Returns the receipt (also persisted for the
// banner). A partial failure still reports what moved and marks failed so
// the error form renders; retry only re-attempts what did not move (the
// per-task setDue is idempotent against today).
export async function runAutoSweep(svc: TasksService, today: string): Promise<SweepReceipt | null> {
  if (sweepAlreadyRan(today)) return readReceipt(today);
  const items = await svc.listTasks();
  const targets = sweepable(items, today);
  markRan(today); // even a zero-target day counts as ran
  if (targets.length === 0) return null;
  const moved: SweepMoved[] = [];
  let failed = false;
  for (const t of targets) {
    try {
      const ok = await svc.setDue(t.id, today);
      if (ok) moved.push({ id: t.id, prevDue: t.data.due!, text: t.data.text, slips: (t.data.slips ?? 0) + 1 });
      else failed = true;
    } catch {
      failed = true;
    }
  }
  const receipt: SweepReceipt = { date: today, moved, failed };
  writeReceipt(receipt);
  return receipt;
}

// Retry a failed sweep: clear the ran-marker and go again.
export async function retrySweep(svc: TasksService, today: string): Promise<SweepReceipt | null> {
  const s = storage();
  try { s?.removeItem(LAST_KEY); } catch { /* retry proceeds anyway */ }
  return runAutoSweep(svc, today);
}

// Undo the whole sweep: every task back to its prior date. The receipt goes
// with it (undone means nothing to report).
export async function undoSweep(svc: TasksService, receipt: SweepReceipt): Promise<void> {
  for (const m of receipt.moved) await svc.setDue(m.id, m.prevDue);
  clearReceipt();
}

// The third-move fact + Set Aside offer, once per task ever.
export function setAsideCandidate(receipt: SweepReceipt): SweepMoved | null {
  const s = storage();
  let offered: string[] = [];
  try { offered = JSON.parse(s?.getItem(OFFERED_KEY) || "[]") as string[]; } catch { /* fresh list */ }
  return receipt.moved.find((m) => m.slips >= SET_ASIDE_AFTER && !offered.includes(m.id)) ?? null;
}

export function markOffered(id: string): void {
  const s = storage();
  if (!s) return;
  try {
    const offered = JSON.parse(s.getItem(OFFERED_KEY) || "[]") as string[];
    if (!offered.includes(id)) offered.push(id);
    s.setItem(OFFERED_KEY, JSON.stringify(offered));
  } catch { /* asked-once is best effort */ }
}
