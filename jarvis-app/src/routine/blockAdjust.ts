// THE SAME QUICK ADJUSTMENTS, FOR A PROTECTED BLOCK (2026-08-28).
//
// eventAdjust.ts did this for events: shift, retime, resize, as pure
// functions the row wires directly instead of forcing a trip to a full
// editor. Dave wanted the identical thing for protected time ("edit ALL
// schedule items THE FUCKING SAME"), and a protected block is simpler to
// adjust than an event - no repeating-series split, no exdates. It is one
// entry inside routine.protectedBlocks, and the whole RoutineData record is
// one write, so every function here reads the block, returns the WHOLE
// routine with that one block patched, and the caller saves it.
//
// Minutes-from-midnight throughout, because that is what ProtectedBlock
// already stores - no HH:MM parsing needed, unlike eventAdjust.ts.

import type { RoutineData, ProtectedBlock, BlockException } from "./types";
import { blockForDate, exceptionOn } from "./types";
import { todayISO, addDays } from "../schedule/calendar";

function withBlock(routine: RoutineData, id: string, patch: (b: ProtectedBlock) => ProtectedBlock): RoutineData | null {
  const blocks = routine.protectedBlocks ?? [];
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const next = [...blocks];
  next[idx] = patch(next[idx]!);
  return { ...routine, protectedBlocks: next };
}

// Clamp to one day, the same floor/ceiling the routine editor's own time
// inputs already enforce (toHHMM in RoutineFlow.tsx), so a swipe near
// midnight cannot push a block into an invalid or wrapped time.
const clamp = (min: number) => Math.max(0, Math.min(24 * 60 - 1, min));

// SCHED-F-18 (2026-09-05): would the block still fit in the day after a shift
// of `mins`? Clamping both ends is what collapsed a late block to zero
// length, so a shift that runs out of day is refused instead. Exported so the
// surfaces that offer the swipe can say why nothing moved.
export function blockShiftFits(startMin: number, endMin: number, mins: number): boolean {
  const s = startMin + mins;
  return s >= 0 && s + (endMin - startMin) <= 24 * 60 - 1;
}

// Shift the whole block by a relative amount (the swipe actions): both
// ends move together, so the block keeps its length.
export function shiftBlock(routine: RoutineData, id: string, mins: number): RoutineData | null {
  const cur = (routine.protectedBlocks ?? []).find((b) => b.id === id);
  // SCHED-F-18: refuse rather than clamp. A "move" that quietly shortens the
  // block is a bug wearing a nudge's clothes, the same reason the event
  // sheet's chips refuse the move instead of clamping it.
  if (!cur || !blockShiftFits(cur.startMin, cur.endMin, mins)) return null;
  return withBlock(routine, id, (b) => {
    const dur = b.endMin - b.startMin;
    const startMin = b.startMin + mins;
    return { ...b, startMin, endMin: startMin + dur };
  });
}

// Retime to an exact start (the time tap): length is preserved, same as an
// event's move-to-exact-time.
export function retimeBlock(routine: RoutineData, id: string, startMin: number): RoutineData | null {
  return withBlock(routine, id, (b) => {
    const dur = b.endMin - b.startMin;
    const s = clamp(startMin);
    return { ...b, startMin: s, endMin: clamp(s + dur) };
  });
}

// Resize (the "Until" tap): only the end moves.
export function resizeBlock(routine: RoutineData, id: string, endMin: number): RoutineData | null {
  return withBlock(routine, id, (b) => ({ ...b, endMin: clamp(endMin) }));
}

// THE QUICK SHEET (2026-08-28). Dave: tapping a protected block opened the
// full Routine editor - Quick Add presets, kind, What Happens in This Block,
// Where - to change a name or a time. He wanted the same tap he gets on a
// real event: a short sheet with the basics and a Delete button, nothing
// else. This patches only what that sheet edits (name, start, end, days);
// kind, mode, soft and location ride along untouched. The full editor is
// still one link away from the sheet for anyone who wants those.
export interface BlockBasics { label: string; startMin: number; endMin: number; days: number[] }
export function editBlockBasics(routine: RoutineData, id: string, patch: BlockBasics): RoutineData | null {
  return withBlock(routine, id, (b) => ({
    ...b,
    label: patch.label.trim(),
    startMin: clamp(patch.startMin),
    endMin: clamp(patch.endMin),
    days: [...patch.days].sort((a, c) => a - c),
  }));
}

// Delete, from the same quick sheet. Null when the block is already gone
// (nothing to delete), same "not found" contract as every function above.
export function removeBlock(routine: RoutineData, id: string): RoutineData | null {
  const blocks = routine.protectedBlocks ?? [];
  if (!blocks.some((b) => b.id === id)) return null;
  return { ...routine, protectedBlocks: blocks.filter((b) => b.id !== id) };
}

// JUST THIS DAY (2026-10-01). The per-date half of the block model: every
// function above edits the weekly RULE, these edit one date's exception on
// it, and neither side ever touches the other (a rule edit leaves exceptions
// where they are; an exception edit leaves the rule alone). Same contract as
// the rest of this file: the WHOLE routine back with one block patched, null
// when the block is gone.

// How long a past exception is kept before it is dropped. A week of grace so
// "what did I do on Tuesday" still reads right on Friday; beyond that it can
// never be seen again and only weighs the record down.
const KEEP_PAST_DAYS = 7;

// Drops exceptions for dates well in the past, and an empty map entirely so a
// block with nothing left to say is byte-identical to one that never had any.
export function pruneExceptions(b: ProtectedBlock, today: string = todayISO()): ProtectedBlock {
  if (!b.exceptions) return b;
  const floor = addDays(today, -KEEP_PAST_DAYS);
  const kept = Object.entries(b.exceptions).filter(([d]) => d >= floor);
  const { exceptions: _drop, ...rest } = b;
  void _drop;
  return kept.length === 0 ? rest : { ...rest, exceptions: Object.fromEntries(kept) };
}

// Set (or with null, clear) one date's exception. An exception that says what
// the rule already says is no exception, so it is cleared rather than stored:
// moving a block "just today" back to its usual time IS Back to Normal.
export function setBlockException(routine: RoutineData, id: string, date: string, ex: BlockException | null, today: string = todayISO()): RoutineData | null {
  return withBlock(routine, id, (b) => {
    const map: Record<string, BlockException> = { ...(b.exceptions ?? {}) };
    const same = !!ex && !ex.skip
      && (ex.startMin === undefined || ex.startMin === b.startMin)
      && (ex.endMin === undefined || ex.endMin === b.endMin);
    if (!ex || same) delete map[date];
    else map[date] = ex.skip
      ? { skip: true }
      : {
        ...(ex.startMin !== undefined ? { startMin: clamp(ex.startMin) } : {}),
        ...(ex.endMin !== undefined ? { endMin: clamp(ex.endMin) } : {}),
      };
    const { exceptions: _drop, ...rest } = b;
    void _drop;
    return pruneExceptions(Object.keys(map).length === 0 ? rest : { ...rest, exceptions: map }, today);
  });
}

// Move one date's occurrence to an exact window, for that date only.
export function retimeBlockOn(routine: RoutineData, id: string, date: string, startMin: number, endMin: number): RoutineData | null {
  return setBlockException(routine, id, date, { startMin, endMin });
}

// Skip the block on one date; Back to Normal is setBlockException(..., null).
export function skipBlockOn(routine: RoutineData, id: string, date: string): RoutineData | null {
  return setBlockException(routine, id, date, { skip: true });
}

// The row's own gestures (swipe, tap the time, tap Until) on a date that
// already carries an exception edit THAT exception, so a row marked "Just
// today" stays just today instead of silently writing the rule underneath an
// override that hides the change. On any other date they edit the rule, as
// they always did.
function dayEdit(routine: RoutineData, id: string, date: string, next: (cur: ProtectedBlock) => { startMin: number; endMin: number } | null): RoutineData | null | undefined {
  const rule = (routine.protectedBlocks ?? []).find((b) => b.id === id);
  if (!rule) return null;
  const ex = exceptionOn(rule, date);
  if (!ex || ex.skip) return undefined;
  const cur = blockForDate(rule, date) ?? rule;
  const win = next(cur);
  return win ? retimeBlockOn(routine, id, date, win.startMin, win.endMin) : null;
}

export function shiftBlockForDate(routine: RoutineData, id: string, date: string, mins: number): RoutineData | null {
  const r = dayEdit(routine, id, date, (cur) => (blockShiftFits(cur.startMin, cur.endMin, mins)
    ? { startMin: cur.startMin + mins, endMin: cur.endMin + mins } : null));
  return r === undefined ? shiftBlock(routine, id, mins) : r;
}

export function retimeBlockForDate(routine: RoutineData, id: string, date: string, startMin: number): RoutineData | null {
  const r = dayEdit(routine, id, date, (cur) => {
    const s = clamp(startMin);
    return { startMin: s, endMin: clamp(s + (cur.endMin - cur.startMin)) };
  });
  return r === undefined ? retimeBlock(routine, id, startMin) : r;
}

export function resizeBlockForDate(routine: RoutineData, id: string, date: string, endMin: number): RoutineData | null {
  const r = dayEdit(routine, id, date, (cur) => ({ startMin: cur.startMin, endMin: clamp(endMin) }));
  return r === undefined ? resizeBlock(routine, id, endMin) : r;
}
