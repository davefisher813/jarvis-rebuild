import { useEffect, useRef, useState } from "react";

// A number that rolls to its new value instead of snapping, so completing a
// task visibly ticks the header counts down. Tweens with an ease-out over
// ~450ms. Respects prefers-reduced-motion (snaps instantly). Renders a plain
// <span>, so it drops into any text without layout changes.
export default function RollingNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const reduced = typeof window !== "undefined" &&
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const DUR = 450;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setShown(Math.round(from + (value - from) * e));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span>{shown}</span>;
}
