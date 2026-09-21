import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * HOW MUCH ROOM A FIXED BAR IS TAKING, PUBLISHED AS CSS.
 *
 * A bar pinned to the bottom of the screen covers whatever scrolls under it,
 * and no stylesheet can know how tall it is: its height is a button size times
 * the reader's own text scale, plus its padding, plus however much of the home
 * indicator inset is left once the keyboard has eaten into it. Spacers written
 * as a fixed number are wrong for everybody whose phone is not the one the
 * number was typed on -- 32px of foot under a 90px bar is how the last row of
 * a live workout ended up permanently behind the Log button.
 *
 * So the bar measures itself and writes two custom properties on :root:
 *
 *   --<name>-h      the bar's own height
 *   --<name>-clear  the distance from the top of the bar to the foot of the
 *                   layout viewport, which counts the bar, anything the
 *                   platform parks under it (iOS's keyboard accessory pill)
 *                   and the keys, without this code knowing which is which
 *
 * Written first for the writing bar (shared/DocEditor.tsx, and the decision in
 * CLAUDE.md is about exactly this measurement); made shared the day the live
 * workout's log bar turned out to need the identical thing. One
 * implementation, two callers, per the app's own rule against a second copy of
 * a shared shape.
 */
export function useBarClearance(name: string, deps: unknown[] = []): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    const hVar = `--${name}-h`, clearVar = `--${name}-clear`;
    const clearAll = () => { root.style.removeProperty(hVar); root.style.removeProperty(clearVar); };
    if (!el) { clearAll(); return; }
    const measure = () => {
      const box = el.getBoundingClientRect();
      root.style.setProperty(hVar, Math.ceil(box.height) + "px");
      root.style.setProperty(clearVar, Math.max(0, Math.ceil(window.innerHeight - box.top)) + "px");
    };
    measure();
    // The keyboard and its pill arrive by animation, and the visual viewport
    // is what reports them. shared/viewport.ts answers the same two events by
    // writing --vv-top and --vv-h on the next frame, and a bar positioned off
    // those two values has not moved yet when they are written. So take the
    // frame after, which is the frame the bar has actually moved in.
    const vv = window.visualViewport;
    let queued = false;
    const afterFrame = () => {
      if (queued) return;
      queued = true;
      const run = () => { queued = false; measure(); };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(run));
      else run();
    };
    vv?.addEventListener("resize", afterFrame);
    vv?.addEventListener("scroll", afterFrame);
    // The caller's own deps already re-run this when the bar appears or a menu
    // opens a row. The observer is the belt on top of those braces, for a
    // height nothing asked for (a rotation, a dynamic-type change), and jsdom
    // has no ResizeObserver to give.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      vv?.removeEventListener("resize", afterFrame);
      vv?.removeEventListener("scroll", afterFrame);
      clearAll();
    };
  }, [name, ...deps]);
  return ref;
}
