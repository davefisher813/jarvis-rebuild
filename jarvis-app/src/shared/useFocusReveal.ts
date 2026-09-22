import { useEffect } from "react";

/** A ROW THAT SCROLLS SIDEWAYS HAS TO FOLLOW THE KEYBOARD (2026-09-21).
 *
 * The focus audit tabbed through 22 screens and found two controls sitting
 * outside their own scroller after the browser had focused them: the
 * Tracker's "Subscriptions" segment, 98px past the right edge of its
 * segmented control, and Chat's "Complete..." starter, 75px past the right
 * edge of its .chip-row. Measured, not assumed: `el.focus()` left the
 * segmented control's scrollLeft at 2. The browser's own scroll-on-focus does
 * not reach a horizontal scroller nested inside the page scroller.
 *
 * Both are the same bug, and so is every scrolling row this app grows next,
 * which is why this is one listener rather than two components. Same shape as
 * useSheetEscape and useLayerFocus: mounted once, reading the document.
 *
 * WHY IT MEASURES FIRST INSTEAD OF ALWAYS CALLING scrollIntoView.
 *
 * `inline: "nearest"` is the polite option -- it scrolls the least possible
 * amount and does nothing at all when the control is already visible -- and
 * on .chip-row it did nothing when the control was NOT visible either. Those
 * rows carry `scroll-snap-type: x`, and the minimum scroll "nearest" asks for
 * lands between two snap points, so the row snaps straight back to where it
 * was. Verified in Chromium: scrollLeft 0 before and 0 after.
 *
 * So: work out whether the control is actually outside one of its scrollers,
 * and only then move, with `inline: "center"`, which lands somewhere snapping
 * is happy to keep. Measuring first is what buys back the no-op that made
 * "nearest" attractive in the first place. Vertical stays `nearest`, where
 * the browser is already right and nothing snaps.
 */
const outOfView = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect();
  let n = el.parentElement;
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n);
    const scrolls = [cs.overflow, cs.overflowX, cs.overflowY].some((v) => v === "auto" || v === "scroll");
    if (scrolls) {
      const p = n.getBoundingClientRect();
      // A pixel or two is a rounded corner meeting an edge, not a hidden
      // control.
      if (r.left < p.left - 2 || r.right > p.right + 2 || r.top < p.top - 2 || r.bottom > p.bottom + 2) return true;
    }
    n = n.parentElement;
  }
  return false;
};

export function useFocusReveal() {
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      // THE KEYBOARD TEST. focusin fires on a TAP too, and a tap that snaps a
      // half-visible chip into place is a surprise nobody asked for.
      // :focus-visible is false for pointer focus and true for Tab, which is
      // exactly the line this wants to draw. Some engines throw on it rather
      // than returning false.
      let keyboard = false;
      try { keyboard = el.matches(":focus-visible"); } catch { keyboard = false; }
      if (!keyboard || !outOfView(el)) return;
      el.scrollIntoView({ block: "nearest", inline: "center" });
    };
    document.addEventListener("focusin", on);
    return () => document.removeEventListener("focusin", on);
  }, []);
}
