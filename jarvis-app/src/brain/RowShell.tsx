import type { ReactNode } from "react";
import { SwipeShell, type TrayAction } from "../today/MoveHeadliner";

// ONE ROW OF A BRAIN LIST THAT SWIPES (Dave 2026-10-05, locked: clean rows; swipe left is the row's one quickest action).
// It is the shell every swipeable row in the app wears (today/MoveHeadliner's SwipeShell: the one gesture controller, the
// tray, the 88px verb), wrapped in .pad-x so a card of them reads as one list: the hairline between rows is drawn on the
// wrapper (.shell-rows in hub.css), because the rows are no longer siblings. A row with no verb (a detector that only
// opens its page) gets a shell with no tray: it does not move, and it never invents a verb.
//
// Module level on purpose. A shell declared inside a screen is a new component on every render, which would remount the
// row and drop an open tray the moment anything above it changed.
export default function RowShell({ verb, onRight, rightLabel, children }: {
  verb?: TrayAction;
  /** Swipe right completes, for a row with something to complete (Took It). Absent, the row cannot move right. */
  onRight?: () => void;
  rightLabel?: string;
  children: ReactNode;
}) {
  return <div className="pad-x"><SwipeShell actions={verb ? [verb] : []} onRight={onRight} rightLabel={rightLabel}>{children}</SwipeShell></div>;
}
