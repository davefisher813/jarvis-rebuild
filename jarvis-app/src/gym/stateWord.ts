import type { SetEntry } from "./types";

// THE SET ROW'S STATE VOCABULARY (Health Push B, H-17 / R9, Dave's picks
// 2026-09-12). Five words, one place, so the strip, the receipt and any
// later reader of a set agree on what a row is:
//
//   done     logged, the lime check
//   now      the working set the athlete is on, the cyan rule and Match
//   next     planned work still ahead, full ink, quiet kicker
//   warm     a ramp set, before or after it is logged
//   skipped  waved off on purpose
//
// Pure, and derived from the row's place in the strip: nothing is stored.

export type SetState = "done" | "now" | "next" | "warm" | "skipped";

/** The state of the row at strip position `idx`, where `currentIdx` is the
 *  position of the working set the athlete is on (the first planned working
 *  set not yet logged), or -1 when every working set is logged. */
export function setState(entry: Pick<SetEntry, "warmup" | "skipped">, idx: number, currentIdx: number): SetState {
  if (entry.skipped) return "skipped";
  if (entry.warmup) return "warm";
  if (currentIdx >= 0 && idx === currentIdx) return "now";
  if (currentIdx >= 0 && idx > currentIdx) return "next";
  return "done";
}

/** The kicker over the row's numbers. `n` is the working-set number; the
 *  harness draws the logged form as "Set 1 · Done" and a ramp set as
 *  "Warm-Up · Done" once it is behind the athlete. */
export function setKicker(state: SetState, n: number, logged = false): string {
  switch (state) {
    case "done": return `Set ${n} · Done`;
    case "now": return `Now · Set ${n}`;
    case "next": return `Up Next · Set ${n}`;
    case "warm": return logged ? "Warm-Up · Done" : "Warm-Up";
    case "skipped": return "Skipped";
  }
}
