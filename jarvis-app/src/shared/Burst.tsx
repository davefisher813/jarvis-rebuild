import { useRef, useState } from "react";
import type { BurstSize } from "./completion";
import { useFeedback } from "../encourage/FeedbackProvider";

// The completion micro-burst: 8 good-green dots radiating from the checkbox
// for 420ms (RDB, Dave 2026-07-29). Render <Burst show={bursting} /> inside a
// .task-check-tap; directions and timing live in components.css.
// The moment scales with what it was (dopamine layer, 2026-08-20): ticking a
// loose task and clearing the last task of a six-month project are not the
// same event, so they must not feel the same. Same 8 dots, further and longer.
// Expressive only (Feedback Style): the default, Gentle, answers a tick with
// the checkmark and one short pulse instead, and Off or Quiet Today with
// neither. See styles/components.css, html[data-celebrate].
export function Burst({ show, size = "small" }: { show: boolean; size?: BurstSize }) {
  const { eff } = useFeedback();
  if (!show || !eff.burst) return null;
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
