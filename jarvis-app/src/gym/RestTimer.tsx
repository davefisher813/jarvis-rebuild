import { useEffect, useState } from "react";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * THE REST TIMER (catalog §4.3), with THE FILLER offered inside it (catalog
 * §4.2): "Rest 2:00 -- or do your T-Spine Rotations." Counts down on the
 * session screen; no notification needed while in-app. An inline card, not a
 * blocking sheet -- the athlete can keep logging while it runs.
 *
 * `key`-remounted by the caller on every new set (React resets all state on
 * a key change), which is how the countdown restarts clean each time rather
 * than this component tracking which set it belongs to.
 */
export default function RestTimer({ seconds, fillerName, onLogFiller, onDismiss }: {
  seconds: number;
  fillerName?: string;
  onLogFiller?: () => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const over = remaining <= 0;

  return (
    <div className="pad-x"><div className="card pad rest-timer">
      <div className="eyebrow">{over ? "Rest Over" : "Resting"}</div>
      <div className="p3-q rest-clock">{mmss(remaining)}</div>
      {fillerName && !over && (
        <button className="row-create rest-filler-btn" onClick={onLogFiller}>
          Or Do {fillerName}
        </button>
      )}
      <button className="row-create" onClick={onDismiss}>{over ? "Continue" : "Skip Rest"}</button>
    </div></div>
  );
}
