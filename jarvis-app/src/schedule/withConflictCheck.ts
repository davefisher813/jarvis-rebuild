import {
  findConflicts, nextFreeSlot, conflictLine, clockText, hasRealConflict, hhmmToMin, minToHhmm,
  type Conflict, type DayItem,
} from "./conflicts";

// WARN, THEN ALLOW (2026-10-01). The one wrapper every commit point goes
// through, so "does this land on something" is asked the same way, and
// answered with the same three choices, wherever a time is about to be
// written. It never blocks: Book Anyway always writes.
//
//   withConflictCheck({ items, start, end }, ask, (slot) => svc.createEvent(...))
//
// `ask` shows the prompt and resolves with the person's choice. A caller with
// no way to ask (a test, a background path) passes undefined and the commit
// goes through exactly as it did before this existed, with the conflicts
// returned so the caller can still mention them.

export type ConflictChoice = "book" | "alt" | "cancel";

export interface ConflictAsk {
  /** "Overlaps Breakfast 9:30 to 10:00 AM". */
  line: string;
  /** Real conflicts read as a warning, soft ones as a heads-up. */
  tone: "conflict" | "soft";
  /** The nearest free slot's label for the button, e.g. "10:00 AM", or null. */
  altLabel: string | null;
  conflicts: Conflict[];
}
export type AskFn = (a: ConflictAsk) => Promise<ConflictChoice>;

export interface CheckInput {
  items: DayItem[];
  start: string;
  /** Absent means the usual hour. */
  end?: string;
  ignoreId?: string;
  forTask?: boolean;
  /** Where "Use ..." searches from. Defaults to the proposed end, so the offer is AFTER the clash. */
  searchFrom?: number;
}

export interface CheckResult<T> {
  status: "booked" | "moved" | "cancelled";
  /** What commit returned. Absent when cancelled. */
  value?: T;
  /** The conflicts of the ORIGINAL proposal (empty when it was clear). */
  conflicts: Conflict[];
  /** The slot that was committed, or the one proposed when cancelled. */
  start: string;
  end: string | undefined;
}

/** The proposal's length in minutes, with the same "no end means an hour" the calendar uses. */
function lengthOf(start: string, end: string | undefined): number {
  return end ? Math.max(5, hhmmToMin(end) - hhmmToMin(start)) : 60;
}

/** What the prompt needs to know, or null when the proposal is clear. */
export function askFor(input: CheckInput): { ask: ConflictAsk; altStart: number | null } | null {
  const s = hhmmToMin(input.start);
  const len = lengthOf(input.start, input.end);
  const conflicts = findConflicts(input.items, { start: s, end: s + len, ignoreId: input.ignoreId, forTask: input.forTask });
  if (conflicts.length === 0) return null;
  const altStart = nextFreeSlot(input.items, len, input.searchFrom ?? s, { ignoreId: input.ignoreId, forTask: input.forTask });
  return {
    altStart,
    ask: {
      line: conflictLine(conflicts),
      tone: hasRealConflict(conflicts) ? "conflict" : "soft",
      altLabel: altStart === null ? null : clockText(altStart),
      conflicts,
    },
  };
}

export async function withConflictCheck<T>(
  input: CheckInput,
  ask: AskFn | undefined,
  commit: (slot: { start: string; end: string | undefined }) => Promise<T>,
): Promise<CheckResult<T>> {
  const found = askFor(input);
  const asIs = { start: input.start, end: input.end };
  if (!found) return { status: "booked", value: await commit(asIs), conflicts: [], ...asIs };
  if (!ask) return { status: "booked", value: await commit(asIs), conflicts: found.ask.conflicts, ...asIs };
  const choice = await ask(found.ask);
  if (choice === "cancel") return { status: "cancelled", conflicts: found.ask.conflicts, ...asIs };
  if (choice === "alt" && found.altStart !== null) {
    const len = lengthOf(input.start, input.end);
    const slot = { start: minToHhmm(found.altStart), end: input.end ? minToHhmm(found.altStart + len) : undefined };
    return { status: "moved", value: await commit(slot), conflicts: found.ask.conflicts, ...slot };
  }
  return { status: "booked", value: await commit(asIs), conflicts: found.ask.conflicts, ...asIs };
}
