import { catColor, catName } from "../../shared/categories";
import { fmtTime } from "../calendar";
import type { PlanBlock } from "../planDay";

// THE PROPOSED BLOCK (blend, 2026-08-22).
//
// Dave: "I want it showing in the schedule form already... what's the point of
// having two different schedule formats on the home page?" He was right, and
// the drafted card was the wrong half to keep. A proposed block is a row of
// the day like any other; what it must never do is pass for a committed one.
//
// It says so with the vocabulary the app already has for "not real yet":
// .sched-gap draws open time with a dashed rule, so the category bar goes
// HOLLOW and dashed in the category's own color. No new color, no opacity
// trick (a dimmed row reads as past, which is the opposite of what this is),
// and the difference survives at a glance from arm's length.
//
// One component, used by Today and by the Schedule tab, so the two cannot
// drift into a third format the way the card and the day list did.

export const DUR_CHOICES = [15, 30, 45, 60, 90, 120];

export const blockMinutes = (b: PlanBlock): number => {
  const m = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  return m(b.end) - m(b.start);
};

const durLabel = (d: number) =>
  d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h ${d % 60}m`;

export default function ProposedRow({
  block,
  open,
  onToggle,
  onDuration,
  onDrop,
}: {
  block: PlanBlock;
  open: boolean;
  onToggle: () => void;
  onDuration: (minutes: number) => void;
  onDrop: () => void;
}) {
  const t = fmtTime(block.start);
  const slot = catColor(block.category);
  const mins = blockMinutes(block);
  return (
    <>
      <div
        className={"sched-row sched-proposed" + (open ? " open" : "")}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={"sched-bar sched-bar-proposed cat-bd-" + slot} />
        <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
        <div className="sched-body">
          <div className="sched-title">{block.text}</div>
          <div className="sched-cat">
            <span className={"cat-dot cat-bg-" + slot} />
            {catName(block.category)}
            {/* The word does the work the dashes started. Its own segment, so
                the dot-break casing law applies and it reads as a state, not
                as part of the category name. */}
            <span className="prop-tag">&middot; Proposed</span>
          </div>
        </div>
      </div>
      {open && (
        <div className="draft-edit-body" onClick={(e) => e.stopPropagation()}>
          <div className="plan-controls">
            <div className="chip-row plan-durs">
              {DUR_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={"chip" + (mins === d ? " chip-on" : "")}
                  aria-label={`${block.text}: ${d} minutes`}
                  onClick={() => onDuration(d)}
                >
                  {durLabel(d)}
                </button>
              ))}
            </div>
            {/* Not destructive: the task goes back to the Anytime pool and
                nothing is deleted, so it wears the app's own verb for the
                move and the neutral capsule, never red. */}
            <div className="plan-when">
              <button type="button" className="btn-sm" onClick={onDrop}>Move to Anytime</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
