// THE SWEEP (B2, approved 2026-08-20).
//
// "7h 27m" is a number you have to convert into a feeling before it means
// anything, and converting is the step ADHD skips. The clinical
// recommendation for time blindness is consistent on this point: show the
// SHAPE of the remaining time, because an arc is read at a glance while a
// digital readout has to be computed.
//
// So the gap draws as a shrinking arc. The number stays underneath, because
// removing it would trade one kind of illegibility for another, and because
// he sometimes genuinely needs the figure.
//
// Laws:
//   - THE ARC IS PROPORTIONAL TO A REAL SPAN, never to a made-up maximum. It
//     fills against the whole gap as it was when the gap began, so watching
//     it empty means something.
//   - It never renders past full or below empty, whatever the clock does.
//   - aria carries the words, not the picture: a screen reader gets "1 hour
//     20 minutes free", not a description of an arc.

const R = 34;
const STROKE = 7;
const SIZE = (R + STROKE) * 2;
const CIRC = 2 * Math.PI * R;

export function arcFraction(leftMin: number, totalMin: number): number {
  if (totalMin <= 0) return 0;
  return Math.max(0, Math.min(1, leftMin / totalMin));
}

export default function TimeArc({
  leftMin,
  totalMin,
  label,
  sub,
}: {
  leftMin: number;
  totalMin: number;
  label: string;
  sub: string;
}) {
  const f = arcFraction(leftMin, totalMin);
  // Drawn from twelve o'clock, clockwise, so it empties the way a clock face
  // does rather than the way a progress bar does.
  const dash = `${CIRC * f} ${CIRC}`;
  return (
    <div className={"time-arc" + (label.length > 3 ? " long" : "")} role="img" aria-label={`${label} ${sub}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="var(--press-3)" strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="var(--good)" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={dash}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="time-arc-text">
        <div className="time-arc-num">{label}</div>
        <div className="time-arc-sub">{sub}</div>
      </div>
    </div>
  );
}
