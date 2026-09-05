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

export function showToast(t: ToastState, ms = 5000): void {
  current = t;
  subs.forEach((s) => s(current));
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, ms);
}
export function hideToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
  subs.forEach((s) => s(null));
}
export function subscribeToast(fn: Sub): () => void {
  subs.add(fn);
  fn(current);
  return () => { subs.delete(fn); };
}
