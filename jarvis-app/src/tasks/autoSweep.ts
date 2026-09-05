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
