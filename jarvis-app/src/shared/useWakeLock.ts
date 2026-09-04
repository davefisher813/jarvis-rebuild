import { useEffect } from "react";

// THE WAKE LOCK (S5-Q30, 2026-09-04): "the screen sleeps between sets."
// ConditioningFace held the screen awake for its own clock; nothing held it
// for the rest of a lifting session, so backgrounding the phone or letting
// it idle between sets locked the screen, and every set after that started
// with unlock-and-find-the-app. One hook, lifted out of ConditioningFace's
// own inline request, so "hold the screen awake while this is open" is one
// implementation a caller opts into, not something the next timer has to
// remember to ask for on its own (src/laws/laws.test.ts enforces that this
// is the only file that calls navigator.wakeLock.request, same shape as the
// swipe controller's one-implementation law).
//
// The Wake Lock API wants a user gesture; the tap that opens whatever calls
// this hook is that gesture. Silently a no-op wherever the API does not
// exist (an older browser, a webview that never shipped it, jsdom in a
// test) -- the feature degrades to "the screen can sleep," never a crash.
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    // A request that resolves after this effect has already been cleaned up
    // (a very fast unmount, or `active` flipping off mid-request) must not
    // leave a lock nobody holds a reference to any more -- released the
    // moment it lands instead.
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen")
      .then((l) => { if (cancelled) l.release().catch(() => {}); else lock = l; })
      .catch(() => {});
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
    };
  }, [active]);
}
