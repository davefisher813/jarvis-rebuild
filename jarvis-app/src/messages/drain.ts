// The drain: "give me N minutes", and N is the USER'S number, always.
import { capAfterNumber } from "../shared/casing";
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

// mm:ss, counting down. Never negative: at zero the deck is already closing.
export function fmtClock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// What got handled, and nothing else. No remainder, no percentage, no "but".
export function drainReceipt(handled: number, minutes: number): string {
  const what = capAfterNumber(handled === 1 ? "1 handled" : handled + " handled");
  return what + " in " + minutes + (minutes === 1 ? " minute" : " minutes");
}
