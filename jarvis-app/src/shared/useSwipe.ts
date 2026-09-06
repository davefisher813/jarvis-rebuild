import { useEffect, useRef, useState } from "react";

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
//
// SHARED-F-21 (2026-09-05): HOW THE FIRST LINE IS ACTUALLY KEPT. "Horizontal
// claims the gesture" is enforced by CSS, not by the preventDefault below.
// React 18 registers touchmove on the root as a PASSIVE listener
// (react-dom.development.js:9172-9173), so preventDefault on a synthetic
// touchmove is ignored and Chrome logs the intervention warning. The rows
// that behave behave because their CSS says `touch-action: pan-y`, which
// tells the browser to keep vertical panning and hand horizontal movement to
// the page. That was true of most of them by luck rather than by rule:
// .notice-card and the bare .swipe-shell had no pan-y, so a diagonal swipe on
// a Today notice or a notification revealed the actions AND scrolled.
//
// So it is a rule now: EVERY element that spreads these handlers must carry
// touch-action: pan-y, and laws.test.ts holds the roster of swipe surfaces
// and the class each one leans on. The preventDefault below stays because it
// costs nothing and is correct the day these are bound natively; it is not
// what makes the gesture work today, and nothing should assume it is.
//
// TODAY-F-23 (2026-09-05): AND A WAY IN WITHOUT A TOUCHSCREEN.
//
// Every secondary action in this app lives behind this gesture: Dismiss,
// Delete, the alt verb on a notice, Set a Start and Not Now on the Now card.
// The handlers were onTouchStart/Move/End and nothing else, so on the web, on
// a laptop, or with a keyboard or switch control, none of those actions could
// be reached at all: no mouse drag, no menu, and `toggle` (which has existed
// on this controller since it was written) was wired to nothing.
//
// Three doors to the same reveal, none of them a new gesture to learn:
// - a LONG PRESS, finger or mouse, which is the iOS idiom for "show me the
//   rest" and cannot be confused with a tap or a scroll (movement cancels it);
// - the CONTEXT MENU (right-click, or the iOS callout), which is the same
//   intent stated by a different input;
// - FOCUS on one of the revealed buttons, so a keyboard user who tabs into
//   Dismiss sees the rail slide open around it instead of pressing a control
//   hidden under the card. Rows mark those buttons with data-reveal and spread
//   revealFocus on the wrapper.
const LONG_PRESS_MS = 500;

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
    onMouseDown: () => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
  // Spread on the wrapper that holds the revealed buttons: focus landing on
  // one of them (marked data-reveal) opens the rail so it can be seen.
  revealFocus: (e: React.FocusEvent) => void;
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
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const moveTo = (v: number) => { dxRef.current = v; setDx(v); };

  const openTo = (next: boolean) => { setOpen(next); moveTo(next ? -revealW : 0); };
  const toggle = () => openTo(!open);

  const endPress = () => { if (press.current) clearTimeout(press.current); press.current = undefined; };
  const beginPress = () => {
    if (!enabled) return;
    endPress();
    press.current = setTimeout(() => { press.current = undefined; if (!decided.current) toggle(); }, LONG_PRESS_MS);
  };
  // A row can unmount mid-press (a notice dismissed elsewhere, a tab change).
  useEffect(() => endPress, []);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!enabled) return;
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    decided.current = false;
    horizontal.current = false;
    setDragging(true);
    beginPress();
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!enabled) return;
    const mx = e.touches[0]!.clientX - startX.current;
    const my = e.touches[0]!.clientY - startY.current;
    if (!decided.current) {
      if (Math.abs(mx) <= 8 && Math.abs(my) <= 8) return;
      decided.current = true;
      horizontal.current = Math.abs(mx) > Math.abs(my);
      // Moving means this is a swipe or a scroll, not a press-and-hold.
      endPress();
    }
    if (!horizontal.current) return;
    if (e.cancelable) e.preventDefault();
    const base = open ? -revealW : 0;
    moveTo(Math.max(-revealW, Math.min(0, base + mx)));
  };

  const onTouchEnd = () => {
    if (!enabled) return;
    endPress();
    setDragging(false);
    if (!horizontal.current) return;
    const nowOpen = dxRef.current < -revealW / 2;
    openTo(nowOpen);
  };

  const closeThen = (fn?: () => void) => { setOpen(false); moveTo(0); fn?.(); };

  const revealFocus = (e: React.FocusEvent) => {
    if (!enabled || open) return;
    const el = e.target as HTMLElement | null;
    if (el && typeof el.closest === "function" && el.closest("[data-reveal]")) openTo(true);
  };

  return {
    dx,
    open,
    dragging,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onMouseDown: beginPress,
      onMouseUp: endPress,
      onMouseLeave: endPress,
      onContextMenu: (e: React.MouseEvent) => { if (!enabled) return; e.preventDefault(); toggle(); },
    },
    revealFocus,
    closeThen,
    toggle,
  };
}
