import { useCallback, useState } from "react";

// ONE-SHOT DEEP LINKS (the B5 group, 2026-09-05: BRAIN-F-03, BRAIN-F-04,
// LIFE-F-07, LIFE-F-08, EMAIL-F-06, SHELL-F-12, SHELL-F-21, HMN-F-19).
//
// Every "open this exact thing" the shell hands a tab used to be a bare id in
// shell state, read once by a child in its own useState initialiser and
// cleared only when the user tapped a bottom tab. Two whole classes of bug
// came out of that one shape:
//
//   - A link INTO the tab you are already on did nothing. setActive("brain")
//     while active is already "brain" changes no key, the prop did not change
//     either, and the child never re-read it.
//   - A link you HAD followed fired itself over: the id was still sitting in
//     the shell, so every later visit to that tab consumed it again and
//     jumped back to the person, the decision, the thread you had left.
//
// One shape closes both. The intent carries a nonce, so asking for the same
// target twice is still a change a child can see, and the child calls
// onConsumed the moment it acts, which clears it here. Neither half is new:
// lifeNav proved the nonce and onRoutineBlockConsumed proved the callback;
// this is those two, given to every intent the shell owns.
//
// The rule for a consumer: act on `value` in an effect keyed on BOTH the
// value and the nonce, then call the onConsumed callback. Never clear an
// intent from the firing side, and never consume one anywhere but the screen
// that actually opens the thing.
export interface OneShot<T> {
  /** What to open, or undefined when nothing is pending. */
  value: T | undefined;
  /** Changes on every fire, so a repeat of the same value still navigates. */
  nonce: number;
  /** Ask a tab to open this. */
  fire: (value: T) => void;
  /** The child acted on it. Called by the consumer, never by the caller. */
  clear: () => void;
}

export function useOneShot<T>(): OneShot<T> {
  const [state, setState] = useState<{ value: T | undefined; nonce: number }>({ value: undefined, nonce: 0 });
  const fire = useCallback((value: T) => setState((s) => ({ value, nonce: s.nonce + 1 })), []);
  // Same object when there is nothing to clear, so a tab tap that clears
  // thirteen intents is not thirteen renders.
  const clear = useCallback(() => setState((s) => (s.value === undefined ? s : { value: undefined, nonce: s.nonce })), []);
  return { value: state.value, nonce: state.nonce, fire, clear };
}
