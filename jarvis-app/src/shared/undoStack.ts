// THE undo stack (editing coverage map, universal mechanics): one
// session-scoped stack behind every edit. Each edit pushes a labelled revert;
// undo pops and runs it. The existing toast idiom keeps working on top of
// this: pushUndo() returns the entry so a caller can offer it on a toast
// action, and undoLast() is what shake-to-undo binds to at native.
//
// The stack is in-memory and per session on purpose: undo is for the edit
// you just made, not for history archaeology. Reverts run through the same
// service writes as any edit, so a failed revert surfaces the standard
// write-failure toast from its caller.

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
