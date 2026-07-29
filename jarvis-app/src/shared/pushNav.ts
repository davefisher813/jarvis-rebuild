import { useLayoutEffect, useRef, useState } from "react";

// iOS-style push/pop direction for stacked full-screen drill-ins (RDB, Dave
// 2026-07-29). Depth 0 is a flow's root; going deeper pushes (slide in from
// the right), coming back pops (settle in from the left). The class is held
// just long enough for the animation, then cleared so later remounts of the
// same screen (data refreshes, sibling swaps at equal depth) stay still.
// Tab switches stay instant: a freshly mounted flow starts at its current
// depth, and equal depth means no class.
export function usePushDepth(depth: number): string {
  const prev = useRef(depth);
  const [cls, setCls] = useState("");
  useLayoutEffect(() => {
    if (depth === prev.current) return;
    const dir = depth > prev.current ? "screen-push" : "screen-pop";
    prev.current = depth;
    setCls(dir);
    const t = setTimeout(() => setCls(""), 380);
    return () => clearTimeout(t);
  }, [depth]);
  return cls;
}
