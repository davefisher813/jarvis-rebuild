import { useSyncExternalStore } from "react";

// THE SHELL STEPS ASIDE FOR A LIVE SESSION (Health Push B, H-11 / R8, Dave's
// picks 2026-09-12). While a session is on screen the tab bar and the
// capture dock are hidden and one Log bar owns the bottom edge, exactly as
// the note editor already does through NotesFlow's onChrome. The gym sits
// four components below the shell (Brain, the area page, the gym flow), so
// rather than thread a callback through all of them this is one tiny store:
// GymFlow says when a session is open, AppShell reads it.
//
// Module state on purpose, the same shape brain/strands/stars.ts uses: one
// session at a time is the whole point of a live session.

let open = false;
const listeners = new Set<() => void>();

export function setSessionOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

export function isSessionOpen(): boolean {
  return open;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** True while a live session is on screen. */
export function useSessionOpen(): boolean {
  return useSyncExternalStore(subscribe, isSessionOpen, () => false);
}
