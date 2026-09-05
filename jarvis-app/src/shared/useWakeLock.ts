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
// GYM-F-09 (2026-09-05): the request happened once, on mount, and was never
// renewed. The Wake Lock spec RELEASES every lock the moment the document
// becomes hidden, so one glance at a text undid S5-Q30 for the rest of the
// session: the screen slept between sets again, including through a running
// conditioning clock. Coming back visible re-requests it.
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
    const acquire = () => {
      if (cancelled || lock) return;
      nav.wakeLock?.request("screen")
        .then((l) => { if (cancelled) l.release().catch(() => {}); else lock = l; })
        .catch(() => {});
    };
    // The system already dropped the lock on the way out, so the reference
    // this hook holds is stale: clear it, then ask again on the way back in.
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
      else lock = null;
    };
    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
