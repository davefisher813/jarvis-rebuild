// THE SHEET LIVES IN WHAT YOU CAN SEE (2026-09-06, Dave from his phone:
// "sometimes when modals render I can't click save or cancel (I think they
// might be too high up on the screen)").
//
// A bottom sheet is position: fixed, which pins it to the LAYOUT viewport. iOS
// does not shrink the layout viewport when the keyboard comes up: it shrinks
// the VISUAL one and slides it down the page far enough to clear the focused
// field. dvh does not track that, and nothing fixed moves, so the top of a
// tall sheet, and the Cancel / title / Save bar sitting on it, ends up above
// the band the person can see, with no way to reach either control.
//
// Measured on the built app: New Event caps at 92 percent, card top 67.5, the
// bar 97.5 to 141.5. Its Location field sits at y 766, which on a phone is
// under the keys, so iOS reports a 508 tall visual viewport offset 310 down
// the page and the bar lands 212.5px above the top of the visible band.
//
// The answer is to state the visible band once, in two custom properties, and
// let the sheet wear them. No ruled value moves: the sheet is still
// content-driven up to 92 percent, still bottom-anchored, still 22pt corners,
// still a 40 percent scrim. 92 percent is now 92 percent of what the person
// can actually see, which is what the ruling meant by viewport.
//
// A browser with no visualViewport (and any render with no window at all)
// leaves both properties unset, and the CSS falls back to 100dvh and 0, which
// is exactly the layout that ships today.

// --vv-bot, ADDED 2026-09-16 (Dave, photographing a live set: the red Log
// button "renders all fucked up. Like it's behind the Apple bar, the clear
// bar. So you can't even see it."). The Log bar is position: fixed, bottom: 0,
// which is the LAYOUT viewport's floor, and that floor is under the keyboard.
// --vv-top and --vv-h already say where the visible band is; --vv-bot is the
// third fact the band implies and the one a bottom-anchored element needs:
// how much of the layout viewport the keyboard has taken. It is what lets a
// bar ride the top of the keys AND drop the home-indicator inset, which the
// keys are already covering, in the same rule.

/** A SHEET OPENING RE-READS THE BAND (Dave's pass-off, 2026-09-26, on the
 *  New Event sheet: a black band of page under the sheet's foot). A sheet's
 *  scrim is sized from --vv-h, so a band left stale by a keyboard that went
 *  away without an event leaves the sheet short of the screen's foot, with
 *  the page showing under it. Nothing is focused when a sheet mounts, so the
 *  read is exact: it asks the tracker to write again, through the same
 *  resize it already listens for. Harmless when the band was right. */
export function nudgeViewport(): void {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return;
  try { vv.dispatchEvent(new Event("resize")); } catch { /* an old webview */ }
}

/** Mirror the visual viewport into --vv-h, --vv-top and --vv-bot. Returns the
 *  stopper. */
export function trackVisualViewport(): () => void {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let queued = false;
  // NOTHING FOCUSED MEANS NO KEYBOARD (2026-09-21, Dave on a live Push Day:
  // "The log another set and next exercise buttons are in the middle of the
  // screen"). They were, and this is why.
  //
  // The band was written from visualViewport alone, on its resize and scroll
  // events. Those are the right events and they are not a guarantee: iOS does
  // not always fire a resize when the keys go away -- a dismiss by scroll, a
  // background and restore, a webview handing focus back -- and there is no
  // event at all for "the keyboard you measured is gone now". So the last
  // write stood, --vv-h stayed at the keyboard-up height, and the Log bar,
  // which is built to sit at the foot of the VISIBLE band, sat at the foot of
  // a band that had not existed for minutes. On his screen that put the two
  // buttons across the middle of the page, over the row behind them.
  //
  // A stale band can only persist while nothing is focused, and while nothing
  // is focused the keyboard cannot be up. That is not a heuristic, it is the
  // one thing about this that is certain, so it is what gets trusted: with no
  // field focused the band IS the layout viewport, whatever visualViewport
  // still remembers. Focused, it is measured exactly as before.
  const typing = (): boolean => {
    const el = document.activeElement;
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  };
  const write = () => {
    queued = false;
    if (!typing()) {
      root.style.setProperty("--vv-h", window.innerHeight + "px");
      root.style.setProperty("--vv-top", "0px");
      root.style.setProperty("--vv-bot", "0px");
      return;
    }
    root.style.setProperty("--vv-h", vv.height + "px");
    root.style.setProperty("--vv-top", vv.offsetTop + "px");
    root.style.setProperty("--vv-bot", Math.max(0, window.innerHeight - vv.offsetTop - vv.height) + "px");
  };
  // The keyboard animates in, so resize and scroll both fire several times a
  // frame. One write per frame is enough and keeps the sheet off the main
  // thread's back while it is sliding.
  const sync = () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(write);
    else write();
  };
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  // THE MOMENTS visualViewport DOES NOT SPEAK FOR. focusout is the blur that
  // dismisses the keys; the keys then animate away over roughly a third of a
  // second, so it is read again after they have gone rather than while they
  // are moving. pageshow covers a bfcache restore and visibilitychange covers
  // the home-screen app being resumed, which is the case that fires no
  // navigation at all (see main.tsx's note on the same problem).
  const settle = () => { sync(); setTimeout(sync, 350); };
  document.addEventListener("focusout", settle);
  document.addEventListener("focusin", sync);
  window.addEventListener("resize", sync);
  window.addEventListener("pageshow", settle);
  window.addEventListener("orientationchange", settle);
  document.addEventListener("visibilitychange", settle);
  write();
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    document.removeEventListener("focusout", settle);
    document.removeEventListener("focusin", sync);
    window.removeEventListener("resize", sync);
    window.removeEventListener("pageshow", settle);
    window.removeEventListener("orientationchange", settle);
    document.removeEventListener("visibilitychange", settle);
  };
}

// THE SCREEN'S REAL HEIGHT IN A HOME-SCREEN APP (tab bar rebuild, 2026-10-13; issue 110).
//
// iOS 26 has a WebKit regression in home-screen apps that use
// viewport-fit=cover with the black-translucent status bar, as this one does:
// 100%, 100svh, 100dvh, innerHeight and the layout viewport all come up short
// by the top safe-area inset (about 59pt), and fixed elements are laid out and
// PAINTED only inside that short box. Rounds 1 to 4 all measured the wrong box:
// the bar sat 82pt above the foot because the shell ended 59pt short, and round
// 4's stretch (the shell set to the physical screen's height) pushed the bar past the painted
// edge, which clipped it to slivers over an empty band.
//
// The fix other apps verified on the device is CSS, not a measurement: in a
// home-screen launch on iOS the document and the shell are sized to
// --app-h = min(100lvh, 100dvh + the top inset), the large viewport, which iOS
// reports correctly. The min() keeps a release that does NOT have the bug (and
// one that starts the page below an opaque status bar) from running a status
// bar past the foot. The rule lives in components.css; this only marks the
// launch, because some iOS versions do not answer the display-mode query.

/** True in a home-screen launch on iOS (or the native shell), never in a browser tab. */
export function isIosStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const win = window as Window & { Capacitor?: unknown };
  if (nav.standalone === true || typeof win.Capacitor !== "undefined") return true;
  const ios = /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  try {
    return ios && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  } catch { return false; }
}

/** Mark <html> with ios-standalone in a home-screen launch, so the full-height rule applies. */
export function markStandalone(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("ios-standalone", isIosStandalone());
}
