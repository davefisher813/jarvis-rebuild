import { useMemo, useRef, useState } from "react";
import type { BurstSize } from "./completion";
import { useFeedback } from "../encourage/FeedbackProvider";
import { currentCelebrationForm } from "../encourage/effects";

// THE EXPRESSIVE ACCENT. Render <Burst show={bursting} /> inside the check's
// tap target (a .task-check-tap or a .cb); everything it draws lives in
// components.css, CELEBRATION FORMS.
//
// PREMIUM FEEL (Dave 2026-10-09: the reward moments "look terrible"; take them
// to "as high end of a feel as possible", never childish; no stock confetti,
// no cartoon bounce, nothing over 500 ms). This used to throw eight green
// dots 34px out of the box, and its other two forms were a ring and a spray of
// spinning diamonds that lifted the row. It is now one quiet accent on top of
// the check-off every level shares (the box fills, the tick draws itself on):
//   ring   a hairline ring opens from the box and fades
//   bloom  a soft glow blooms off the box's edge and fades
//   wash   a light band of the done tint crosses the row once, and the box
//          gives off a faint halo
// Each is gone by --dur-celebrate (440 ms). The form still changes from one
// completion to the next (Dave 2026-10-05, "celebrations that vary"), chosen
// once per completion by encourage/effects and published on the root as
// data-cv, so the stylesheet (Gentle) and this span (Expressive) read one
// choice. The moment still scales with what it was (dopamine layer,
// 2026-08-20): a big one reaches further in the same time.
//
// Expressive only (Feedback Style). Gentle, the default, answers a tick with
// the check-off alone, and Off, Quiet Today or Reduce Motion (the phone's or
// the app's own) draw no Burst at all (eff.burst is false), and the
// stylesheet gates it again.
const BURST_FORMS = ["burst-ring", "burst-bloom", "burst-wash"] as const;

export function Burst({ show, size = "small" }: { show: boolean; size?: BurstSize }) {
  const { eff } = useFeedback();
  // Read when the burst starts, not on every render, so it cannot change form
  // halfway through its own moment.
  const form = useMemo(() => (show ? currentCelebrationForm() : 0), [show]);
  if (!show || !eff.burst) return null;
  return (
    <span className={"burst " + BURST_FORMS[form] + (size === "big" ? " burst-big" : "")} aria-hidden="true" />
  );
}

// Local burst state with auto-clear, so call sites stay one-liners:
// const [bursting, fireBurst] = useBurst(); ... onClick={() => { if (!done) fireBurst(); toggle(); }}
// The span is held a little past the accent's 440 ms so it is never cut off.
export function useBurst(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fire = () => {
    setOn(false);
    if (timer.current) clearTimeout(timer.current);
    // re-arm on the next frame so back-to-back completions each play
    requestAnimationFrame(() => {
      setOn(true);
      timer.current = setTimeout(() => setOn(false), 500);
    });
  };
  return [on, fire];
}
