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
// A LABEL WITHOUT A HANDLER IS NOT AN ACTION (audit 2026-09-16). The two are
// separate optionals, so `{ message, actionLabel: "Undo" }` with no onAction
// type-checks; it used to count as an action here and draw a real capsule in
// ToastHost that did nothing when tapped. Making them a union instead would
// reject the spread form every caller legitimately uses
// (`...(undo ? { actionLabel, onAction } : {})`), so the rule lives at the
// two places that read the pair: an action is a label AND something to run.
const hasAction = (t: ToastState | null): boolean => !!t?.actionLabel && !!t?.onAction;

export function showToast(t: ToastState, ms = 5000): void {
  if (hasAction(current) && !hasAction(t)) {
    queued = { t, ms, at: Date.now() };
    return;
  }
  current = t;
  shownAt = Date.now();
  subs.forEach((s) => s(current));
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, ms);
}
export function hideToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
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
  if (current && Date.now() - shownAt > TOAST_NAV_GRACE_MS) hideToast();
}
/** Tests only: drop anything in flight so one case cannot leak into the next. */
export function resetToasts(): void {
  queued = null;
  hideToast();
}
export function subscribeToast(fn: Sub): () => void {
  subs.add(fn);
  fn(current);
  return () => { subs.delete(fn); };
}
