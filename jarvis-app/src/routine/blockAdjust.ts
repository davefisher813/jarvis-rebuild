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

import type { RoutineData, ProtectedBlock } from "./types";

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

// Shift the whole block by a relative amount (the swipe actions): both
// ends move together, so the block keeps its length.
export function shiftBlock(routine: RoutineData, id: string, mins: number): RoutineData | null {
  return withBlock(routine, id, (b) => {
    const dur = b.endMin - b.startMin;
    const startMin = clamp(b.startMin + mins);
    return { ...b, startMin, endMin: clamp(startMin + dur) };
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
