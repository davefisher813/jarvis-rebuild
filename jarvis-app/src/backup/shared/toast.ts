// Tiny app-wide toast store. One transient message at a time, with an optional
// action (e.g. Undo). Framework-free so any service or flow can call it.
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
