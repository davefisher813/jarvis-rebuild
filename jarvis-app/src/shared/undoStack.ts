// THE undo stack (editing coverage map, universal mechanics): one
// session-scoped stack behind every edit. Each edit pushes a labelled revert;
// undo pops and runs it.
//
// The stack is in-memory and per session on purpose: undo is for the edit
// you just made, not for history archaeology. Reverts run through the same
// service writes as any edit, so a failed revert surfaces the standard
// write-failure toast from its caller.
//
// SHARED-F-15 (2026-09-05): WHAT THIS HEADER USED TO CLAIM, AND DOES NOT NOW.
// It said "undoLast() is what shake-to-undo binds to at native". There is no
// such binding, and there never was. Nothing in app code calls pushUndo, so
// undoDepth() is always 0 and clearUndo() on sign-out clears an empty stack.
// Every Undo in the app goes through showToast({ actionLabel: "Undo" })
// directly, at 81 sites, each writing the exact state it means to restore
// (see shared/toast.ts, SHARED-F-03). That idiom won.
//
// This file is KEPT rather than deleted, and the fork is Dave's to close:
// laws/editingPrimitives.test.ts names the undo stack as one of the six
// editing primitives that must exist exactly once, so deleting it takes a
// law with it, and the alternative (pushing every toast Undo's revert in
// here so a future shake-to-undo has something to pop) needs bookkeeping
// this does not have: popping on tap and on expiry, or a shake would re-run
// a revert the person already ran from the toast. Either is a decision, not
// a cleanup. Until one is made, this is a working stack with no callers, and
// the header no longer says otherwise.

export interface UndoEntry {
  label: string;
  revert: () => Promise<void> | void;
}

const MAX_DEPTH = 50;
let stack: UndoEntry[] = [];

export function pushUndo(entry: UndoEntry): UndoEntry {
  stack.push(entry);
  if (stack.length > MAX_DEPTH) stack = stack.slice(-MAX_DEPTH);
  return entry;
}

// Undo the most recent edit. Resolves the entry it ran, or null when there
// was nothing to undo. Running an undo never re-pushes itself.
export async function undoLast(): Promise<UndoEntry | null> {
  const entry = stack.pop();
  if (!entry) return null;
  await entry.revert();
  return entry;
}

export function undoDepth(): number {
  return stack.length;
}

// Session boundary (sign-out): edits from one user must never be undoable
// into another's session.
export function clearUndo(): void {
  stack = [];
}
