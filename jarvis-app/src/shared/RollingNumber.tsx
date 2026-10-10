import { useEffect, useRef, useState } from "react";

// A NUMBER THAT MOVES TO ITS NEW VALUE instead of snapping, so completing a
// task visibly changes the count it belongs to. Renders a plain <span>, so it
// drops into any text without a layout change.
//
// PREMIUM FEEL (Dave 2026-10-09; the bar is Apple, Linear, Arc, Things 3). Two
// ways, by the size of the change:
//   - A change of a few (1 to ROLL_MAX) ROLLS, the way iOS numeric text does:
//     the new figure slides 0.35em into place, up for a rise and down for a
//     fall, with a fade (components.css, .num-roll; --dur-enter, 260 ms). Counting 5 to 4
//     over a tween would show no motion at all, only a late snap.
//   - A bigger change COUNTS, on an expo ease-out over SETTLE_MS, so a month's
//     total arrives quickly and settles gently.
// Under Reduce Motion, the phone's or the app's own (Feedback Style > Motion,
// html[data-motion="reduce"]), it simply shows the new value.
const ROLL_MAX = 9;
const SETTLE_MS = 360; // --dur-settle

function prefersStill(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce") return true;
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function RollingNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [roll, setRoll] = useState<"" | "up" | "down">("");
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    cancelAnimationFrame(rafRef.current);
    const delta = value - from;
    if (prefersStill() || Math.abs(delta) <= ROLL_MAX) {
      fromRef.current = value;
      setShown(value);
      setRoll(prefersStill() ? "" : delta > 0 ? "up" : "down");
      return;
    }
    setRoll("");
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / SETTLE_MS);
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); // expo ease-out
      setShown(Math.round(from + delta * e));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  // A count past 999 carries its thousands separator ("1,365", never "1365": Dave 2026-10-05, the review).
  const text = shown.toLocaleString("en-US");
  if (!roll) return <span>{text}</span>;
  // Keyed by the value, so each change is a fresh arrival; the class leaves
  // when the roll ends, and the span is a plain inline run again.
  return (
    <span key={shown} className={"num-roll num-roll-" + roll} onAnimationEnd={() => setRoll("")}>{text}</span>
  );
}
