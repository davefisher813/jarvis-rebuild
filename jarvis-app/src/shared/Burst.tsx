import { useRef, useState } from "react";

// The completion micro-burst: 8 good-green dots radiating from the checkbox
// for 420ms (RDB, Dave 2026-07-29). Render <Burst show={bursting} /> inside a
// .task-check-tap; directions and timing live in components.css.
// The moment scales with what it was (dopamine layer, 2026-08-20): ticking a
// loose task and clearing the last task of a six-month project are not the
// same event, so they must not feel the same. Same 8 dots, further and longer.
export function Burst({ show, size = "small" }: { show: boolean; size?: "small" | "big" }) {
  if (!show) return null;
  return (
    <span className={"burst" + (size === "big" ? " burst-big" : "")} aria-hidden="true">
      <i /><i /><i /><i /><i /><i /><i /><i />
    </span>
  );
}

// Local burst state with auto-clear, so call sites stay one-liners:
// const [bursting, fireBurst] = useBurst(); ... onClick={() => { if (!done) fireBurst(); toggle(); }}
export function useBurst(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fire = () => {
    setOn(false);
    if (timer.current) clearTimeout(timer.current);
    // re-arm on the next frame so back-to-back completions each burst
    requestAnimationFrame(() => {
      setOn(true);
      timer.current = setTimeout(() => setOn(false), 500);
    });
  };
  return [on, fire];
}
