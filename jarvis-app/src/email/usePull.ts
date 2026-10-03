// PULL TO REFRESH (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08
// E02). The standalone web app has no browser chrome to pull, so the list
// takes the gesture itself: a touch that starts at the top of the scroller
// and travels down past the threshold arms a refresh, and lifting the finger
// runs it. Nothing runs on a timer; the gesture is the only trigger here.

import { useCallback, useRef, useState, type TouchEvent } from "react";

const PULL_THRESHOLD = 72;

export interface PullHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
}

export function usePull(onRefresh: () => void, enabled: boolean): { armed: boolean; handlers: PullHandlers } {
  const startY = useRef<number | null>(null);
  const [armed, setArmed] = useState(false);

  const onTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    if (!enabled) return;
    const el = e.currentTarget;
    const top = (el.scrollTop ?? 0) <= 0 && (typeof window === "undefined" || window.scrollY <= 0);
    startY.current = top ? (e.touches[0]?.clientY ?? null) : null;
  }, [enabled]);

  const onTouchMove = useCallback((e: TouchEvent<HTMLElement>) => {
    if (startY.current === null) return;
    const y = e.touches[0]?.clientY ?? 0;
    const next = y - startY.current > PULL_THRESHOLD;
    setArmed((was) => (was === next ? was : next));
  }, []);

  const onTouchEnd = useCallback(() => {
    const was = armed;
    startY.current = null;
    setArmed(false);
    if (was) onRefresh();
  }, [armed, onRefresh]);

  return { armed, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
