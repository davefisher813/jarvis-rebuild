import { useLayoutEffect, useRef, useState } from "react";

// iOS-style push/pop direction for stacked full-screen drill-ins (RDB, Dave
// 2026-07-29). Depth 0 is a flow's root; going deeper pushes (slide in from
// the right), coming back pops (settle in from the left). The class is held
// just long enough for the animation, then cleared so later remounts of the
// same screen (data refreshes, sibling swaps at equal depth) stay still.
// Tab switches stay instant: a freshly mounted flow starts at its current
// depth, and equal depth means no class.
//
// AND THE SCROLL BOX FOLLOWS THE STACK (Alfred 2026-10-04: after a back navigation a row was "gone" from the Brain
// hub's Explore list). The app does not scroll the document: .app-scroll is the one box that does, and a flow swaps its
// hub for a page by unmounting one and mounting the other in the same box, so the box kept the scroll position it had.
// Scroll a long page down, go back, and the hub drew itself already scrolled by that much: its first rows and head sat
// above the top edge, behind the bar, and read as missing. So every flow does what a native stack does: opening a page
// scrolls to the top (remembering where the list was), closing it puts the list back. jsdom and a page outside the
// shell have no .app-scroll, and then the scroll half does nothing.
const scrollBox = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".app-scroll");

export function usePushDepth(depth: number): string {
  const prev = useRef(depth);
  const saved = useRef<number[]>([]);
  const [cls, setCls] = useState("");
  useLayoutEffect(() => {
    const b = scrollBox();
    if (b && depth > 0) b.scrollTop = 0; // arriving already over the root (a deep link) is a new page too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (depth === prev.current) return;
    const b = scrollBox();
    if (b) {
      if (depth > prev.current) { saved.current[prev.current] = b.scrollTop; b.scrollTop = 0; }
      else b.scrollTop = saved.current[depth] ?? 0;
    }
    const dir = depth > prev.current ? "screen-push" : "screen-pop";
    prev.current = depth;
    setCls(dir);
    const t = setTimeout(() => setCls(""), 380);
    return () => clearTimeout(t);
  }, [depth]);
  return cls;
}
