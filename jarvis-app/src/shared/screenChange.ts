// "THE SCREEN CHANGED", ONE SIGNAL (2026-10-05). The shell calls it when the tab, Search or Quick Capture changes, and a
// screen that opens on top of another (Today's Focus, its Reminders page) calls it when it opens or closes. Anything that
// belongs to "the screen you were on" listens: today that is the toast (shared/toast.ts), which drops a receipt about the
// last screen's action. It is its own tiny module so a caller never has to import the toast store just to say "I moved",
// and so a test that stubs the toast store does not have to know about it.
type Fn = () => void;
const subs = new Set<Fn>();

export function noteScreenChange(): void {
  subs.forEach((f) => f());
}

export function onScreenChange(fn: Fn): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
