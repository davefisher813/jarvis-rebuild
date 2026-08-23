// WHAT YOU ACTUALLY CLEARED TODAY (E12, 2026-08-23)
//
// The app had three receipts and none of them was this one. `netted` counts
// emails turned into tasks. `weeklyClose` marks a week. The deck's dead
// screen counts one run and forgets it the moment you leave. Nothing
// answered "what did I get through today", which is the only number worth
// showing at the bottom of a list you have just finished.
//
// Two rules:
//
//   1. It is a real count of real actions, incremented where the archive
//      actually happens. There is no estimate and no derived guess.
//   2. It resets on the date, not on a rolling window. "Today" means today.
//
// A zero is never dressed up. If nothing was cleared, the close-out says
// what is in the inbox and stops talking.

import { capAfterNumber } from "../shared/casing";

const KEY = "jarvis.mail.cleared.v1";

export interface Cleared {
  date: string; // YYYY-MM-DD
  n: number;
}

function read(): Cleared | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Cleared>;
    if (typeof v?.date !== "string" || typeof v?.n !== "number") return null;
    if (!Number.isFinite(v.n) || v.n < 0) return null;
    return { date: v.date, n: Math.floor(v.n) };
  } catch {
    return null;
  }
}

// A stored count from yesterday is not today's count, so it reads as zero
// rather than as a number that quietly carried over.
export function clearedToday(todayISO: string): number {
  const v = read();
  return v && v.date === todayISO ? v.n : 0;
}

export function bumpCleared(todayISO: string, by = 1): number {
  if (!Number.isFinite(by) || by <= 0) return clearedToday(todayISO);
  const next = clearedToday(todayISO) + Math.floor(by);
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: todayISO, n: next } satisfies Cleared));
  } catch { /* a full disk is not worth a broken archive */ }
  return next;
}

// The close-out line. `left` is what is still in the inbox, `pressing` is
// what still needs the user. Both are counts the list already has, so this
// invents nothing.
//
// Order matters: the achievement goes first when there is one, and when
// there is not, the line opens with the state of the inbox instead of with a
// zero.
export function closeOut(cleared: number, left: number, pressing: number): { title: string; sub: string } {
  const title = cleared > 0
    ? cleared + " Cleared Today"
    : "Nothing Needs You";
  const inbox = left === 0 ? "Inbox empty" : left + " in the inbox";
  const owed = pressing === 1 ? "1 still needs you" : pressing + " still need you";
  const sub = capAfterNumber(inbox + " · " + (pressing > 0 ? owed : "Nothing urgent"));
  return { title, sub };
}
