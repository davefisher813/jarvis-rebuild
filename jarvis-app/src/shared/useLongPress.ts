import { useEffect, useRef } from "react";

// LONG PRESS (Dave 2026-08-24: "when I tap to edit a task it now edits the
// text instead... it's WAY more important that I can easily click and edit").
//
// B6 put InlineEdit on the task title and gave it the title's tap. The title
// is the biggest, most obvious thing on the row and the one place a person
// aims when they mean "open this", so renaming took the gesture that opening
// needed. The row still opened the editor everywhere else, which is no
// comfort when the target you actually hit is the one that does the other
// thing.
//
// So the tap goes back to opening, and rename moves here. Long press is the
// right home for it: it is the platform convention for "the other thing this
// can do", it cannot be hit by accident, and it costs the primary gesture
// nothing.
//
// THE THREE THINGS THAT MAKE THIS WORK ON A PHONE, all learned the hard way
// by everyone who has written one of these:
//
//   1. A SCROLL IS NOT A PRESS. A finger resting on a row for 500ms while
//      the list moves under it is scrolling. Movement past a few pixels
//      cancels, or every flick down a long list fires a rename.
//   2. THE CLICK AFTER IT IS SUPPRESSED. Touch devices synthesise a click
//      on release, so without this the row would long-press AND open, which
//      is the current bug wearing a different coat.
//   3. IT CLEANS UP. A timer left running past unmount fires into a
//      component that is gone.

export interface LongPressOptions {
  onLongPress: () => void;
  // Long enough not to catch a deliberate tap, short enough not to feel
  // broken. 500ms is the platform value and there is no reason to be clever.
  ms?: number;
  // Pixels of movement that mean "this is a scroll, not a press".
  moveTolerance?: number;
  enabled?: boolean;
}

interface Handlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
}

export function useLongPress({
  onLongPress,
  ms = 500,
  moveTolerance = 8,
  enabled = true,
}: LongPressOptions): Handlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  // Set when the press fires, read and cleared by the click that follows.
  const fired = useRef(false);
  // Held in a ref so a caller passing an inline arrow does not have to
  // memoise it, and so the timer always calls the LATEST one.
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    from.current = null;
  };

  const start = (x: number, y: number) => {
    if (!enabled) return;
    clear();
    from.current = { x, y };
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      cb.current();
    }, ms);
  };

  // Point 3, and the test that caught it was worth writing: without this a
  // press begun on a row that then unmounts (a filter change, a delete, a
  // navigation) fires its callback into a component that no longer exists.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const moved = (x: number, y: number) => {
    const f = from.current;
    if (!f || !timer.current) return;
    if (Math.abs(x - f.x) > moveTolerance || Math.abs(y - f.y) > moveTolerance) clear();
  };

  return {
    onTouchStart: (e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); },
    onTouchMove: (e) => { const t = e.touches[0]; if (t) moved(t.clientX, t.clientY); },
    onTouchEnd: clear,
    onTouchCancel: clear,
    // Pointer events cover mouse and pen. Touch is handled above rather than
    // through pointer events because a touch fires BOTH, and starting the
    // timer twice would double-fire the callback.
    onPointerDown: (e) => { if (e.pointerType !== "touch") start(e.clientX, e.clientY); },
    onPointerMove: (e) => { if (e.pointerType !== "touch") moved(e.clientX, e.clientY); },
    onPointerUp: clear,
    onPointerLeave: clear,
    // A long press on a touch screen also raises the context menu, which
    // would cover the thing being renamed with a system sheet.
    onContextMenu: (e) => { if (enabled) e.preventDefault(); },
    // The suppression. Capture phase, so it stops the click before any
    // handler on this element or its parents can see it.
    onClickCapture: (e) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
