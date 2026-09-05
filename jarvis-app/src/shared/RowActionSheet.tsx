import { createPortal } from "react-dom";

// SHELL-F-22 + BROWSER-F-14 (2026-09-05): the tap-alternative for gesture-only
// row actions, and the ONE menu behind every one of them.
//
// A notification could be opened or marked Done by tap but only waved off by
// swiping left, and tabs and areas could only be reordered by dragging a
// grip: no menu, no up/down control, no keyboard path. A swipe is
// undiscoverable on a screen whose rows also open on tap, so the person who
// never tries one never learns the action exists at all.
//
// The gestures stay exactly as they are. This is the second door, and every
// row that has one opens THIS sheet: a long press anywhere on the row, a tap
// on the reorder grip, or Enter and Space on that grip, all land here (see
// ReorderList.tsx). Two menus offering the same actions would be two things
// to keep in step, so there is one.
//
// Built from the app's own .action-sheet atoms (see
// notes/screens/AddBlockSheet.tsx), so it looks like every other sheet in the
// app and nothing new was styled for it.
export interface RowAction {
  label: string;
  onPick: () => void;
  destructive?: boolean;
  // An action this row cannot take right now (Move Up on the first row).
  // Shown and greyed rather than dropped, so the buttons do not move around
  // under the thumb from one row to the next.
  disabled?: boolean;
}

export default function RowActionSheet({
  title,
  actions,
  onCancel,
}: {
  // What the sheet is about, so a menu that opened over a list says which row
  // it belongs to.
  title?: string;
  actions: RowAction[];
  onCancel: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        {title && <div className="grp"><div className="eyebrow">{title}</div></div>}
        <div className="action-sheet">
          {actions.map((a) => (
            <button
              key={a.label}
              className={a.destructive ? "destructive" : undefined}
              disabled={a.disabled}
              onClick={() => { if (a.disabled) return; onCancel(); a.onPick(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet">
          <button className="cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
