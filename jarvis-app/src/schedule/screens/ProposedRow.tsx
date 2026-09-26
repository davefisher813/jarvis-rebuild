import { useRef } from "react";
import { catColor, catName } from "../../shared/categories";
import { useChipInView } from "../../shared/useChipInView";
import { fmtTime } from "../calendar";
import type { PlanBlock } from "../planDay";
import { DUR_CHOICES, durLabel, minutesBetween } from "../durations";

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

// B5 (2026-08-23): the duration list moved to schedule/durations.ts, because
// PlanDaySheet had declared its own identical copy and DayRow now needs the
// same one. Re-exported so existing importers keep working.
export { DUR_CHOICES } from "../durations";

export const blockMinutes = (b: PlanBlock): number => minutesBetween(b.start, b.end);

export default function ProposedRow({
  block,
  open,
  onToggle,
  onDuration,
  onDrop,
  onComplete,
  onAccept,
}: {
  block: PlanBlock;
  open: boolean;
  onToggle: () => void;
  onDuration: (minutes: number) => void;
  onDrop: () => void;
  /** TICK IT OFF (Dave, 2026-09-15). This row could resize the task and send
   *  it back to Anytime and could not say it was done -- so a planned task
   *  you actually finished had to be found somewhere else to be closed.
   *  The ring is the same 24px anatomy every task row in the app uses, in
   *  the lead slot, where the hand already looks for it. Optional, so a
   *  caller with no completion wiring renders exactly as it did. */
  onComplete?: () => void;
  /** BOOK THIS ONE BLOCK (button audit 2026-09-16; Dave: "add it to Today").
   *  The proposed-day type has carried a per-block Accept since C-32 and only
   *  the Schedule tab ever drew one, on its nested held rows. This is the
   *  same verb on the row itself, so a draft can be taken a block at a time
   *  wherever it is shown. Optional: a caller that only offers the whole-day
   *  Accept passes nothing and this row is what it was. */
  onAccept?: () => void;
}) {
  const t = fmtTime(block.start);
  const slot = catColor(block.category);
  const mins = blockMinutes(block);
  const durs = useRef<HTMLDivElement>(null);
  useChipInView(durs, open);
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
        {/* THE CHECKBOX SITS NEXT TO THE TIME, NOT UNDER IT (Dave, 2026-09-26).
            Line one is time, checkbox, title, in that order -- the checkbox
            is part of the row's lead, not part of "everything else". Line
            two (.sched-body) is category and the Proposed tag only. */}
        {onComplete && (
          <div className="task-check-tap sched-check" role="checkbox" aria-checked={false}
            aria-label={`Mark ${block.text} done`}
            onClick={(e) => { e.stopPropagation(); onComplete(); }}>
            <div className="task-check" />
          </div>
        )}
        <div className="sched-title">{block.text}</div>
        <div className="sched-body">
          <div className="sched-cat">
            <span className={"cat-dot cat-bg-" + slot} />
            {catName(block.category)}
            {/* The word does the work the dashes started. Its own segment, so
                the dot-break casing law applies and it reads as a state, not
                as part of the category name.
                C-28 (Astra, 2026-09-12): and the word is the state word now,
                in the closed vocabulary's own small caps. .prop-tag stays on
                it for the rule that keeps live information off --tx-4. */}
            <span className="sched-sep">&middot;</span>
            <span className="prop-tag fact st gray">Proposed</span>
          </div>
        </div>
      </div>
      {open && (
        <div className="draft-edit-body" onClick={(e) => e.stopPropagation()}>
          <div className="plan-controls">
            <div className="chip-row plan-durs" ref={durs}>
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
              {/* Booking one block is the affirmative move, so it leads and
                  Move to Anytime stays the quiet one beside it. */}
              {onAccept && <button type="button" className="btn btn-primary btn-sm" onClick={onAccept}>Book It</button>}
              <button type="button" className="btn-sm" onClick={onDrop}>Move to Anytime</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
