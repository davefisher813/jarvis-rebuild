import { useLayoutEffect, useRef } from "react";

// A PAGE THAT OPENS OVER A LIST STARTS AT ITS TOP, AND THE LIST COMES BACK WHERE IT WAS (Alfred 2026-10-04: after a back
// navigation a row was "gone" from the Brain hub's Explore list).
//
// The app does not scroll the document: .app-scroll is the one box that does (shared/PageHeader says so), and every flow
// in a tab is rendered inside it. A flow swaps its hub for a page by unmounting one and mounting the other in the same
// box, so the box kept the scroll position it had. Scroll a long page down, go back, and the hub drew itself already
// scrolled by that much: its first rows and their head sat above the top edge, behind the bar, and read as missing.
//
// The fix is the one every native stack makes: opening a page scrolls to the top (remembering where the list was), and
// closing it puts the list back. `depth` is the same number the flow hands usePushDepth (0 at its root, 1 over it), so the
// two stay in step. jsdom and a page outside the shell have no .app-scroll, and then this does nothing.
const box = (): HTMLElement | null => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".app-scroll"));

export function useScrollOnPush(depth: number): void {
  const prev = useRef(depth);
  const saved = useRef<number[]>([]);
  useLayoutEffect(() => {
    const b = box();
    if (b && depth > 0) b.scrollTop = 0; // arriving already over the root (a deep link) is a new page too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = depth;
    if (depth === was) return;
    const b = box();
    if (!b) return;
    if (depth > was) { saved.current[was] = b.scrollTop; b.scrollTop = 0; }
    else b.scrollTop = saved.current[depth] ?? 0;
  }, [depth]);
}
