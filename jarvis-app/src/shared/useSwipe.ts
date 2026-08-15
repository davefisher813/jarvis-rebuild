import { useRef, useState } from "react";

// THE swipe controller (editing coverage map, universal mechanics). One
// implementation of the gesture math; every swipeable row configures it and
// renders its own actions. A second implementation of this logic anywhere is
// a review-blocking violation, enforced by law test: no other file may read
// raw touch coordinates.
//
// The gesture contract, identical on every list in the app:
// - 8px direction lock: horizontal claims the gesture (page must not
//   scroll); vertical is left alone so the list scrolls normally.
// - The row tracks the finger, clamped to [-revealW, 0].
// - Release past half the reveal opens; anything less snaps shut.

export interface SwipeOptions {
  // Total width of the revealed action area (88 per action).
  revealW: number;
  // A row that is not swipeable right now (e.g. schedule rows on other days)
  // keeps its markup and ignores the gesture.
  enabled?: boolean;
}

export interface SwipeState {
  dx: number;
  open: boolean;
  dragging: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  // Close the reveal, then run the action (the standard post-action snap).
  closeThen: (fn?: () => void) => void;
  toggle: () => void;
}

export function useSwipe({ revealW, enabled = true }: SwipeOptions): SwipeState {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef(false);
  const horizontal = useRef(false);

  const moveTo = (v: number) => { dxRef.current = v; setDx(v); };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!enabled) return;
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    decided.current = false;
    horizontal.current = false;
    setDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!enabled) return;
    const mx = e.touches[0]!.clientX - startX.current;
    const my = e.touches[0]!.clientY - startY.current;
    if (!decided.current) {
      if (Math.abs(mx) <= 8 && Math.abs(my) <= 8) return;
      decided.current = true;
      horizontal.current = Math.abs(mx) > Math.abs(my);
    }
    if (!horizontal.current) return;
    if (e.cancelable) e.preventDefault();
    const base = open ? -revealW : 0;
    moveTo(Math.max(-revealW, Math.min(0, base + mx)));
  };

  const onTouchEnd = () => {
    if (!enabled) return;
    setDragging(false);
    if (!horizontal.current) return;
    const nowOpen = dxRef.current < -revealW / 2;
    setOpen(nowOpen);
    moveTo(nowOpen ? -revealW : 0);
  };

  const closeThen = (fn?: () => void) => { setOpen(false); moveTo(0); fn?.(); };
  const toggle = () => { const next = !open; setOpen(next); moveTo(next ? -revealW : 0); };

  return { dx, open, dragging, handlers: { onTouchStart, onTouchMove, onTouchEnd }, closeThen, toggle };
}
