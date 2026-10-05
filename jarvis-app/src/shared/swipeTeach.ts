// TEACHING THE SWIPE (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md section 4).
// A swipe is useless if nobody knows it exists, and the UI must stay clean once they do. Two one-time pieces and
// nothing permanent: ONE row peeks open and closes, ONCE EVER; a dismissible tip sits at the top of the Today list
// until the first real swipe or the first dismiss. No grip dots, no always-visible hint.
const PEEKED = "jarvis.swipe.peeked.v1";
const TIP = "jarvis.swipe.tip.v1";

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* storage can be blocked */ } };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const onSwipeTeachChange = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The peek plays once, ever, and never under Reduced Motion. */
export const shouldPeek = (): boolean => read(PEEKED) !== "1" && read(TIP) !== "done" && !reducedMotion();
export const markPeeked = (): void => { write(PEEKED, "1"); };

/** The tip shows until a swipe has happened or it was dismissed. */
export const tipVisible = (): boolean => read(TIP) !== "done";
export const dismissTip = (): void => { write(TIP, "done"); notify(); };
/** Any real swipe teaches it: the tip and the peek are finished for good. */
export const noteSwiped = (): void => { if (read(TIP) !== "done") { write(TIP, "done"); write(PEEKED, "1"); notify(); } };
