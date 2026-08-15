// The write-failure guard (corrections pack 2026-08-14, item 3). One
// primitive, built once: every user-initiated mutation in a flow runs
// through attemptWrite(), so a failed write can never die silently. On
// failure the standard toast renders, matching the shipped
// RoutineFlow/BrainDocPage pattern verbatim, and the caller gets false so
// it can skip success-only follow-ons (completion toasts, undo offers).
//
// Silent automations (Auto-Sweep, silent create, auto-file, re-flow) do NOT
// use this: their failures render as an error RECEIPT line ("Couldn't move
// yesterday's tasks. Tap to retry."), which is louder than a toast, because
// a failed automation must be MORE visible than a successful one. That
// variant ships with the automations themselves.

import { showToast } from "./toast";

export const WRITE_FAILED_MESSAGE = "Couldn't save. Check your connection and try again.";

// Run a write (or a sequence of writes that succeed or fail as one action).
// Resolves true on success. On failure: standard toast, resolves false,
// never throws. One failed action = one toast, however many writes it held.
export async function attemptWrite(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    showToast({ message: WRITE_FAILED_MESSAGE });
    return false;
  }
}
