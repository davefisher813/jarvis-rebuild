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

/** Mirror the visual viewport into --vv-h, --vv-top and --vv-bot. Returns the
 *  stopper. */
export function trackVisualViewport(): () => void {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let queued = false;
  const write = () => {
    queued = false;
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
  write();
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
  };
}
