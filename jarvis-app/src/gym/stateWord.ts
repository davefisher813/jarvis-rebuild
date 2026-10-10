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

export type SetState = "done" | "now" | "next" | "warm" | "skipped" | "drop";

/** The state of the row at strip position `idx`, where `currentIdx` is the
 *  position of the working set the athlete is on (the first planned working
 *  set not yet logged), or -1 when every working set is logged. */
export function setState(entry: Pick<SetEntry, "warmup" | "skipped" | "drop">, idx: number, currentIdx: number): SetState {
  if (entry.skipped) return "skipped";
  if (entry.warmup) return "warm";
  // Part 3 wave 2: a drop segment is its own word, in the load hue, so it is
  // never read as the working set it hangs off.
  if (entry.drop) return "drop";
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
    // A PLANNED ROW SAYS ONLY ITS NAME (Dave 2026-10-09, pass-off item 9:
    // "UP NEXT · SET 3" beside "0 of 3 Sets" read as a contradiction). Every
    // row after the Now row said Up Next, so Set 3 claimed to be next while
    // Set 1 was still to do. Only the Now row carries a state word.
    case "next": return `Set ${n}`;
    case "warm": return logged ? "Warm-Up · Done" : "Warm-Up";
    case "skipped": return "Skipped";
    case "drop": return logged ? "Drop · Done" : "Drop";
  }
}

// ONE COUNT, EVERY READER (Dave 2026-10-09, pass-off item 9). The strip's
// kickers, the head's "N of M Sets", the session header's meter and the Set
// sheet's title used to count the same sets four ways: the head counted a
// skipped set as logged, the header did not, and the Now row's number counted
// the warm-up it was standing on as Set 1, so the plan's own Set 1 vanished
// and the rows after it read Set 2 and Set 3 under "0 of 3 Sets". They all read
// these two now.
//
// The rules, once:
//   - a working set is one that is not a warm-up and not a drop;
//   - a skipped working set is settled but not done: it takes its place in
//     the plan (the Now row moves past it) and comes off the target, so the
//     count never says a set was lifted that was not;
//   - a working set's number counts only the working sets before it that
//     were not skipped, so the Now row is always Set (done + 1) and the head
//     always reads done of target.

type Countable = Pick<SetEntry, "warmup" | "drop" | "skipped">;
const isWork = (s: Countable) => !s.warmup && !s.drop;

export interface SetCount {
  /** Working sets logged, not skipped. */
  done: number;
  /** Working sets waved off. */
  skipped: number;
  /** The plan less what was skipped: what "of N" says. */
  target: number;
  /** The Now row's set number. */
  nowNo: number;
  /** Nothing left in the plan: every planned working set is done or
   *  skipped, or, with no plan at all, at least one set has landed. */
  complete: boolean;
}

export function setCount(logged: Countable[], planned: number): SetCount {
  const done = logged.filter((s) => isWork(s) && !s.skipped).length;
  const skipped = logged.filter((s) => isWork(s) && s.skipped).length;
  return {
    done,
    skipped,
    target: Math.max(0, planned - skipped),
    nowNo: done + 1,
    complete: planned > 0 ? done + skipped >= planned : logged.length > 0,
  };
}

/** The working-set number of every row of a strip, logged rows first. A row
 *  is numbered by the working sets before it that were not skipped, so a
 *  warm-up, a drop and a skipped set never push the work's numbers on.
 *  `warmAt` is a row standing in for a warm-up that is not flagged yet (the
 *  Now card on its Warm-Up side), which numbers like one. */
export function workNumbers(rows: Countable[], warmAt = -1): number[] {
  const out: number[] = [];
  let n = 0;
  rows.forEach((s, i) => {
    out.push(n + 1);
    if (i !== warmAt && isWork(s) && !s.skipped) n++;
  });
  return out;
}
