// Tiny app-wide toast store. One transient message at a time, with an optional
// action (e.g. Undo). Framework-free so any service or flow can call it.
//
// SHARED-F-03 (2026-09-05): AN UNDO SETS A STATE, IT NEVER TOGGLES ONE. The
// toast lives for five seconds and the row is still tappable underneath it,
// so by the time the action fires the record may already have moved: three
// sites implemented Undo as a second toggleDone, and tapping Undo after
// un-ticking the row by hand re-completed the task. An action here must
// write the exact state it means to restore (the snapshot the caller read
// before the write it is undoing), so tapping it twice, or late, or after a
// hand edit, lands on the same answer.
import { onScreenChange } from "./screenChange";

export interface ToastState { message: string; actionLabel?: string; onAction?: () => void }
type Sub = (t: ToastState | null) => void;

let current: ToastState | null = null;
const subs = new Set<Sub>();
let timer: ReturnType<typeof setTimeout> | undefined;
// SHARED-F-09 (2026-09-05), option A. The store held ONE toast and replacement
// was unconditional, so bulk-deleting twelve tasks and then getting a
// "Couldn't save" from an unrelated background write two seconds later took
// the Undo away, permanently, with no confirm step anywhere by design
// (SelectBar.tsx:22-25). A toast with an action is the app's whole answer to
// "reversible without confirm", so it cannot be evicted by one without.
//
// The plain toast is not dropped, it waits: it is still a message the user
// needs, and it gets the slot the moment the action toast is finished, whether
// that is by its timer or by the action being taken. Only the newest waiting
// plain toast is kept, because a queue of stale receipts is worse than the
// newest one.
let queued: { t: ToastState; ms: number; at: number } | null = null;
let shownAt = 0;
let shownMs = 0;
// J-08 (Dave, 2026-10-27): SEQUENTIAL DELETES, ONE UNDO. Deleting a second row while the first Undo was still up REPLACED that toast, so
// Undo restored only the second delete and the first was gone for good. An Undo is the app's whole answer to "no confirm", so a new
// Undo no longer evicts a live one: the older one is set aside with its OWN deadline (when it would have expired, had nothing
// replaced it), and comes back the moment the newer is taken or expires, for whatever is left of that window. Each Undo still
// restores its own delete (the snapshot rule above), the chain never outlives any one toast's own clock, and a stale one is dropped.
const HELD_MAX = 5;
let held: { t: ToastState; deadline: number; at: number }[] = [];
// A LABEL WITHOUT A HANDLER IS NOT AN ACTION (audit 2026-09-16). The two are
// separate optionals, so `{ message, actionLabel: "Undo" }` with no onAction
// type-checks; it used to count as an action here and draw a real capsule in
// ToastHost that did nothing when tapped. Making them a union instead would
// reject the spread form every caller legitimately uses
// (`...(undo ? { actionLabel, onAction } : {})`), so the rule lives at the
// two places that read the pair: an action is a label AND something to run.
const hasAction = (t: ToastState | null): boolean => !!t?.actionLabel && !!t?.onAction;

// HOW LONG A TOAST LIVES. A plain receipt is five seconds. A toast that carries an action (an Undo) is the app's whole answer
// to "reversible without a confirm", so its window is the longer one the Brain's filings already use (ai/brainMemory UNDO_MS,
// 8 seconds; toast.test.ts holds the two equal): the Logging Standard asks for at least five seconds in which the Undo is genuinely usable, and the live audit of
// 2026-10-19 could not tap the Transaction Added Undo in three tries inside five. A caller that names its own time keeps it.
export const TOAST_MS = 5000;
export const UNDO_TOAST_MS = 8000;

export function showToast(t: ToastState, ms = hasAction(t) ? UNDO_TOAST_MS : TOAST_MS): void {
  if (hasAction(current) && !hasAction(t)) {
    queued = { t, ms, at: Date.now() };
    return;
  }
  if (hasAction(current) && hasAction(t) && current) {
    held.push({ t: current, deadline: shownAt + shownMs, at: shownAt });
    if (held.length > HELD_MAX) held = held.slice(-HELD_MAX);
  }
  current = t;
  shownAt = Date.now();
  shownMs = ms;
  subs.forEach((s) => s(current));
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, ms);
}
export function hideToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
  // The newest set-aside Undo that still has time comes back first, for the time it has left.
  const now = Date.now();
  held = held.filter((h) => h.deadline > now);
  const back = held.pop();
  if (back) {
    current = back.t;
    shownAt = back.at;
    shownMs = back.deadline - back.at;
    subs.forEach((s) => s(current));
    timer = setTimeout(hideToast, back.deadline - now);
    return;
  }
  subs.forEach((s) => s(null));
  const next = queued;
  queued = null;
  if (next) showToast(next.t, next.ms);
}
// A TOAST IS ABOUT THE SCREEN IT WAS RAISED ON (Dave 2026-10-05, "he opens the app and finds nothing"; the review: a
// "Moved Rent to Tomorrow" receipt rode along into Schedule and sat over a page it had nothing to do with, and its Undo
// would have reached back into a screen that was gone). The shell calls this when the screen changes (a tab, Focus,
// Search, Quick Capture), and a toast already showing goes, with any plain one waiting behind it.
//
// One thing survives: a toast raised in the same gesture as the change, because that gesture IS the change. "Opened
// Waiting" after a jump, or a receipt that arrives a beat before the render settles, belongs to the screen being
// opened. The grace is wider than one render and far shorter than the five seconds a toast lives.
export const TOAST_NAV_GRACE_MS = 600;
export function dismissForNavigation(): void {
  const q = queued;
  if (q && Date.now() - q.at > TOAST_NAV_GRACE_MS) queued = null;
  // An Undo set aside belongs to the screen it was raised on, like the one showing.
  held = held.filter((h) => Date.now() - h.at <= TOAST_NAV_GRACE_MS);
  if (current && Date.now() - shownAt > TOAST_NAV_GRACE_MS) hideToast();
}
// The store listens for the shell's one "the screen changed" signal (shared/screenChange.ts).
onScreenChange(dismissForNavigation);
/** Tests only: drop anything in flight so one case cannot leak into the next. */
export function resetToasts(): void {
  queued = null;
  held = [];
  hideToast();
}
export function subscribeToast(fn: Sub): () => void {
  subs.add(fn);
  fn(current);
  return () => { subs.delete(fn); };
}
