import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// THE CURRENT VALUE HAS TO BE ON SCREEN (2026-08-24).
//
// The duration chip rows offer six lengths. Six chips is about 540px of
// content in a 282px strip, so half of them are always outside the scroll
// port, and the strip opens at scrollLeft 0 every time. Caught in the browser
// walk on a 90-minute event: the editor opened showing 15m / 30m / 45m / 1h
// and the chip saying which one the event actually IS was off the right edge.
//
// An editor that hides the current value is worse than no editor, because the
// user cannot tell whether tapping 1h is a change or a no-op.
//
// Shared rather than written twice: the same chip row is rendered by DayRow
// and by ProposedRow, and a scroll fix that only landed on one of them is
// exactly the drift the taskMoves extraction exists to prevent.
export function useChipInView(ref: RefObject<HTMLElement | null>, open: boolean): void {
  // Only on the OPEN transition. Re-running while open would yank the strip
  // back under a finger that is mid-scroll.
  const was = useRef(false);
  useEffect(() => {
    const justOpened = open && !was.current;
    was.current = open;
    if (!justOpened) return;
    const box = ref.current;
    if (!box) return;
    const on = box.querySelector<HTMLElement>(".chip-on");
    if (!on) return;
    // Centre it, so the neighbouring choices either side are visible too:
    // "nearest" would park the current chip against an edge and hide the
    // shorter or longer option next to it, which is the one most likely to
    // be wanted. No smooth behaviour, because the strip is being revealed in
    // the same frame and an animated scroll on a just-mounted element reads
    // as a glitch.
    box.scrollLeft = Math.max(0, on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2);
  }, [ref, open]);
}
