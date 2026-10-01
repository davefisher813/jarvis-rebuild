import { useCallback, useRef } from "react";
import type { EventItem } from "./types";
import { protectedRangesFor, type RoutineData } from "../routine/types";
import { dayItemsFor, conflictLine, findConflicts, moveNote, type DayItem } from "./conflicts";
import { withConflictCheck, checkBatch, type CheckResult } from "./withConflictCheck";
import { useConflictAsk } from "./screens/ConflictSheet";

// THE ONE GUARD EVERY FLOW HOLDS (2026-10-01). Schedule, Today and Tasks each
// own their events and their routine, and each needs the same thing at a
// commit point: the day's occupied time, the prompt, and the wrapper. This
// bundles them so a flow adds one hook call and one `{conflictSheet}`, and a
// commit point adds one `guard(...)`. Reads through refs, so a commit that
// runs after a reload sees the day as it is now, not as it was at render.
//
//   const { guard, guardBatch, moveToast, conflictSheet } = useConflictGuard(allEvents, routineData);
//   const r = await guard({ date, start, end, forTask: true }, (slot) => svc.createEvent(...));
//   if (r.status === "cancelled") return;
//
// A later commit point (the time picker's commitRetime) hooks in the same way.

export function dowOf(date: string): number {
  const p = date.split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}

export function useConflictGuard(events: EventItem[], routine: RoutineData) {
  const { ask, sheet } = useConflictAsk();
  const eventsRef = useRef(events);
  const routineRef = useRef(routine);
  eventsRef.current = events;
  routineRef.current = routine;

  const itemsFor = useCallback((date: string, withEvents?: EventItem[]): DayItem[] =>
    dayItemsFor(withEvents ?? eventsRef.current, date, protectedRangesFor(routineRef.current, dowOf(date))), []);

  /** Ask before a single write. Resolves "cancelled" without calling commit when backed out of. */
  const guard = useCallback(<T,>(
    p: { date: string; start: string; end?: string; ignoreId?: string; forTask?: boolean; events?: EventItem[] },
    commit: (slot: { start: string; end: string | undefined }) => Promise<T>,
  ): Promise<CheckResult<T>> =>
    withConflictCheck({ items: itemsFor(p.date, p.events), start: p.start, end: p.end, ignoreId: p.ignoreId, forTask: p.forTask }, ask, commit),
  [ask, itemsFor]);

  /** Ask once before a plan of several blocks is written. True to go ahead. */
  const guardBatch = useCallback(async (
    date: string,
    blocks: { taskId: string; text?: string; start: string; end: string }[],
    replacing?: ReadonlySet<string>,
  ): Promise<boolean> => (await checkBatch(itemsFor(date), blocks, ask, replacing)).go, [ask, itemsFor]);

  /** The clause a nudge's toast carries, or "" when the move lands on nothing new. */
  const moveToast = useCallback((
    date: string,
    moved: { id: string; start: string; end?: string; forTask?: boolean },
    toStart: string,
  ): string => moveNote(itemsFor(date), moved, toStart), [itemsFor]);

  /** The live fact for a sheet being edited: the line, or null when the time is clear. */
  const lineFor = useCallback((date: string, start: string, end: string, ignoreId?: string): string | null => {
    if (!date || !start) return null;
    const s = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
    const e = end ? Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) : s + 60;
    const cs = findConflicts(itemsFor(date), { start: s, end: e, ignoreId });
    return cs.length ? conflictLine(cs) : null;
  }, [itemsFor]);

  return { guard, guardBatch, moveToast, lineFor, itemsFor, conflictSheet: sheet };
}
