// "SCHEDULE SOMETHING HERE" (schedule audit 2026-10-01, item 7). A "30 Min
// Open" row used to open the Focus panel (on Today) or an empty New Event
// form (on the Schedule tab): an invitation to put something in the gap that
// then declined to say what. This is the what: the few open tasks that
// genuinely fit the room, in the order the Now card already deals them, each
// one tap from booked into the gap.
//
// The ranking is nowContext's gapFits, not a second one: due today, then
// overdue, then the rest, nearest due first. The only differences are the
// ones the sheet needs. It books a task INTO the gap, so the estimate must
// fit the gap exactly (no ten-minute buffer; the Now card keeps its buffer
// because it is a suggestion, this is a placement), and a task already on the
// day is not offered again.

import { gapFits } from "../today/nowContext";
import { minToHHMM } from "./calendar";

export interface GapOption {
  id: string;
  text: string;
  category: string;
  /** How long the booking runs: the task's own estimate, never more than the gap. */
  minutes: number;
}

export interface GapTaskIn {
  id: string;
  text: string;
  category: string;
  done: boolean;
  due?: string | null;
  bill?: unknown;
  reminder?: unknown;
  estimateMin?: number;
}

export const GAP_OPTION_LIMIT = 4;

export function gapOptions(
  tasks: GapTaskIn[],
  gapMin: number,
  today: string,
  estimateFor: (category: string) => number,
  opts: { paused?: ReadonlySet<string>; planned?: ReadonlySet<string>; limit?: number } = {},
): GapOption[] {
  const planned = opts.planned ?? new Set<string>();
  return gapFits(tasks.filter((t) => !planned.has(t.id)), gapMin, today, estimateFor, opts.paused, 0)
    .slice(0, opts.limit ?? GAP_OPTION_LIMIT)
    .map(({ t, est }) => ({ id: t.id, text: t.text, category: t.category, minutes: Math.min(est, gapMin) }));
}

/** The block a booking lands as: starts where the gap starts. */
export function gapBlock(start: string, minutes: number): { start: string; end: string } {
  const p = start.split(":");
  const s = Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
  return { start, end: minToHHMM(Math.min(s + minutes, 24 * 60 - 1)) };
}
