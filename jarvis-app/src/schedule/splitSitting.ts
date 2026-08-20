import { capAfterNumber } from "../shared/casing";

// SPLIT A LONG ONE (P13, Dave 2026-08-20).
//
// A three-hour task is not a three-hour sitting. Scheduling it as one block
// is how a plan becomes a lie by 2pm: the block is still there, still
// unstarted, and now the whole afternoon is behind.
//
// Anything past the threshold is offered as two or three sittings with real
// breaks. Offered, never forced: some work genuinely wants a long run at it.

export const SITTING_MAX = 120;  // past this, one block stops being realistic
export const SITTING_MIN = 30;   // a chunk under this is a fragment, not a sitting

// Even chunks, rounded to the 15 everything else in the planner snaps to, so
// a 3h task becomes 2 x 90 rather than 2 x 88 and a stray minute.
export function splitSittings(minutes: number, max = SITTING_MAX): number[] {
  if (minutes <= max) return [minutes];
  const parts = Math.ceil(minutes / max);
  // FLOOR, not round: rounding up makes the chunks overshoot and the
  // remainder goes negative, which hands the SHORT sitting to the start of
  // the day. Flooring leaves a positive remainder for the first block.
  const even = Math.floor(minutes / parts / 15) * 15;
  if (even < SITTING_MIN) return [minutes];
  const chunks = Array.from({ length: parts }, () => even);
  // Give the remainder to the FIRST sitting: energy is highest at the start,
  // and a long tail block is the one that gets abandoned.
  const drift = minutes - even * parts;
  chunks[0] = (chunks[0] ?? even) + drift;
  return chunks.filter((c) => c > 0);
}

export function splitLine(chunks: number[]): string {
  if (chunks.length < 2) return "";
  const same = chunks.every((c) => c === chunks[0]);
  const each = same ? `${chunks[0]}m each` : chunks.map((c) => `${c}m`).join(" + ");
  return capAfterNumber(`${chunks.length} sittings · ${each}`);
}
