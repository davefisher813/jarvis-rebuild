import { clockLabel } from "../shared/duration";
// The drain: "give me N minutes", and N is the USER'S number, always.
//
// Dave's explicit requirement: he sets the timer. Presets exist because
// picking from three is faster than typing, not because the app knows better.
// The last choice is remembered, so the common case is one tap.
//
// It stops dead at zero and reports what got done. It never mentions what is
// left. That silence is the feature.

const KEY = "jarvis.mail.drain.v1";
export const PRESETS = [2, 5, 10];
const MIN = 1;
const MAX = 60;

export function loadMinutes(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) || "", 10);
    return clampMinutes(isNaN(n) ? 5 : n);
  } catch {
    return 5;
  }
}

export function saveMinutes(n: number): number {
  const v = clampMinutes(n);
  try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ }
  return v;
}

export function clampMinutes(n: number): number {
  if (!isFinite(n)) return 5;
  return Math.min(MAX, Math.max(MIN, Math.round(n)));
}

// m:ss, counting down, and h:mm:ss past an hour (the one running clock,
// shared/duration; casing sweep 3, 2026-09-27). Never negative: at zero the
// deck is already closing. Ceil, not round: a clock that shows 0:00 while a
// fraction of a second is still left has lied about the finish.
export function fmtClock(msLeft: number): string {
  return clockLabel(Math.max(0, Math.ceil(msLeft / 1000)));
}

// EMAIL-F-29 (2026-09-05): drainReceipt had no caller. The deck writes its
// own end-of-drain line from the counts it holds.
