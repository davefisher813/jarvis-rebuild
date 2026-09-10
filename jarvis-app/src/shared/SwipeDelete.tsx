import type { ReactNode } from "react";
import { useSwipe } from "./useSwipe";
import { Trash2 } from "./icons";

// SWIPE TO DELETE, FOR LISTS THAT HAD NO GESTURE AT ALL (Dave 2026-09-10:
// "there is no way to swipe on stuff to take action. Make sure the days and
// history ect have that action. It's way too hard to delete stuff
// especially").
//
// Tasks, notes, mail, bills, reminders and events have all had the swipe
// since the editing-coverage pass. The GYM never did: a program day and a
// logged session could only be removed by opening the row, finding a menu,
// and confirming inside it -- three or four taps to undo a mis-tap, on the
// one screen a person is using with sweaty hands between sets.
//
// This is the same gesture and the same mechanics every other list already
// uses (shared/useSwipe owns the math; a second implementation is a
// review-blocking violation). It is deliberately the SMALL version of the
// pattern: one reveal, one verb, no right-swipe -- a program day and a logged
// workout are both records, and a record has nothing to "complete", which is
// the opt-out editingPrimitives.test.ts asks a surface to name.
//
// The moving element carries `.swipe-row`, which is where its
// `touch-action: pan-y` lives (the roster in editingPrimitives.test.ts).
export default function SwipeDelete({ label, onDelete, enabled = true, children }: {
  /** What is being deleted, for the button's accessible name. */
  label: string;
  onDelete: () => void;
  /** Off while a list is in reorder mode: two gestures on one row is neither. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const swipe = useSwipe({ revealW: 88, enabled });
  return (
    <div className="task-swipe">
      <button className="task-del" onClick={() => swipe.closeThen(onDelete)} aria-label={"Delete " + label}>
        <Trash2 className="ic" />
        <span className="swipe-label">Delete</span>
      </button>
      <div
        className={"swipe-row" + (swipe.dragging ? " dragging" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
}
