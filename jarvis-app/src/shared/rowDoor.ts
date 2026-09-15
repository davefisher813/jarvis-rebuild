import type { KeyboardEvent, MouseEvent, SyntheticEvent } from "react";

// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15, photographed Today and
// Schedule: "I want all rows clickable. How is the first thing that renders
// on the app not clickable? It seems like throughout the app rows with
// buttons tend to not be clickable. I want a FULL sweep of this and all of
// them to be fixed").
//
// pressable() for a row that ALSO holds its own controls (a pill, a ring, a
// chip, a date input). Two guards a bare pressable row does not need:
//   - a click that landed on an inner control is that control's, not the
//     row's, even if the control forgot to stop it;
//   - Enter or Space on a focused inner control bubbles here as a keydown,
//     and preventDefault on it would swallow the control's own click. Only a
//     key pressed on the row itself opens the row.
// The sweep found this helper written three times (today, gym, messages);
// this is the one copy. laws/rowTap.test.ts is the law it serves.
const CONTROLS = "button, input, select, textarea, a, label, [role='button'], [role='switch'], [role='checkbox'], [role='radio']";

function onControl(target: EventTarget | null, row: EventTarget): boolean {
  const el = target as Element | null;
  const hit = el && typeof el.closest === "function" ? el.closest(CONTROLS) : null;
  return !!hit && hit !== row;
}

export interface RowDoor {
  role: "button";
  tabIndex: number;
  onClick: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function rowDoor(open: () => void): RowDoor {
  return {
    role: "button",
    tabIndex: 0,
    onClick: (e) => { if (!onControl(e.target, e.currentTarget)) open(); },
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    },
  };
}

/** Wraps a control's handler so its tap stays its own and never opens the row. */
export function own<E extends SyntheticEvent>(fn?: (e: E) => void): (e: E) => void {
  return (e: E) => { e.stopPropagation(); fn?.(e); };
}
