// Day progress ring for the Today hero (RDB, Dave 2026-07-29): due-today
// tasks completed over due-today total. Fills as the day progresses, pops
// once full. Renders nothing on days with no due tasks, so it never nags.
const R = 19;
const C = 2 * Math.PI * R;

export default function DayRing({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const full = done >= total;
  return (
    <div className={"day-ring" + (full ? " done" : "")} role="img" aria-label={`${done} of ${total} tasks done today`}>
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
        {/* Catalog V3.1: the arc is a red-to-orange gradient with a soft glow
            (CSS drop-shadow on .fill), not a flat green stroke. */}
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF1F30" />
            <stop offset="100%" stopColor="#FF7A00" />
          </linearGradient>
        </defs>
        <circle className="track" cx="22" cy="22" r={R} strokeWidth="4" />
        <circle className="fill" cx="22" cy="22" r={R} strokeWidth="4" stroke="url(#ringGrad)" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, done / total))} />
      </svg>
      <div className="count">{done}/{total}</div>
    </div>
  );
}
