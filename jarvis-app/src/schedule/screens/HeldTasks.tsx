import { useState, type ReactNode } from "react";

// THE WORK A BLOCK IS HOLDING (Dave 2026-08-25: "any tasks within events in
// the schedule should be able to compress").
//
// A focus block pulls work into itself, and on his screenshot Deep Work was
// holding five things and spending about 180px saying so. The nesting is the
// right idea; showing all of it always is not.
//
// COLLAPSED OVER THREE, which was his pick. One or two held tasks are cheaper
// to read than a count is to decode, so they stay open. Four or more is where
// the list starts costing more room than it returns, and it folds to a line.
// The threshold is the whole design: a rule that collapsed everything would
// hide a single task behind a tap for no gain, and a rule that collapsed
// nothing is what he was looking at.
//
// Written once, here, because Today and the Schedule tab both nest and the
// two have already drifted apart twice this month.
export const COLLAPSE_OVER = 3;

export default function HeldTasks({
  count,
  children,
  label = "task",
  alwaysOpen = false,
}: {
  // How many rows `children` holds. Passed rather than counted, because the
  // caller builds them from two different lists (committed and proposed) and
  // React children are not reliably countable once they are fragments.
  count: number;
  children: ReactNode;
  label?: string;
  // THE TICKER SHOWS EVERYTHING (Dave 2026-08-25: "The schedule isn't
  // scrolling on its own like a tv guide").
  //
  // Compressing the day made it FIT, and a day that fits does not scroll, so
  // yesterday's pick quietly switched off the day before's. His screenshot
  // was two rows and a "5 tasks" line where there used to be seven rows.
  //
  // The two views want opposite things and that is the resolution rather
  // than a compromise: the ticker is ambient and untouchable, so it shows the
  // whole day the way a guide does, and the paused view is where you act, so
  // it stays compressed. Same component, told which one it is in.
  alwaysOpen?: boolean;
}) {
  const collapsible = count > COLLAPSE_OVER && !alwaysOpen;
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  const shown = !collapsible || open;

  return (
    <div className="block-nest">
      {collapsible && (
        // Its own control, not the row's tap. The row opens the block's
        // editor; this opens the list. Same lesson as the task title: one
        // gesture, one outcome, and a control that lives inside a tappable
        // row stops that row's tap reaching it.
        <button
          type="button"
          className="held-toggle"
          aria-expanded={shown}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          <span className={"chev chev-down" + (shown ? " chev-open" : "")} />
          {shown ? "Hide" : count + " " + label + (count === 1 ? "" : "s")}
        </button>
      )}
      {shown && children}
    </div>
  );
}
