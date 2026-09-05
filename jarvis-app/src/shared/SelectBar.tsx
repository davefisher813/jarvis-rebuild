import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "./icons";
import type { Selection } from "./useSelection";
import HeadMenu from "./HeadMenu";

// THE ONE SELECT BAR (Dave 2026-08-24: "very easy to clear and delete stuff.
// Also in bulk"). Four surfaces asked for bulk delete, so this is written
// once. Four bars that behaved almost the same is how the app grew two
// schedule formats.
//
// It sits at the FOOT, not the head, because on a phone the thumb is at the
// bottom and the count it reports is the thing being confirmed. The head
// keeps Done, which is the way out, and the way out is the one control that
// must never move.
//
// Delete is the only filled control on the bar and it carries the count, so
// the button says what will happen rather than making the user hold the
// number in their head. "Delete 3" is a sentence; a trash can beside a "3"
// somewhere else is a puzzle.
//
// There is no confirm step. Dave chose Undo over a confirm sheet, and the
// app already works that way everywhere else: a confirm dialog on every
// delete is a tax on the common case, paid to protect against the rare one,
// which is exactly what Undo protects against for free.
export default function SelectBar({
  sel,
  onDelete,
  noun,
  extraLabel,
  onExtra,
  projects,
  onMoveToProject,
}: {
  sel: Selection;
  onDelete: () => void;
  // Singular. "task" gives "Delete 1 Task" and "Delete 3 Tasks".
  noun: string;
  // One optional surface-specific bulk action beside Delete, e.g. Mark Done
  // on tasks. Absent on surfaces where nothing else makes sense in bulk.
  extraLabel?: string;
  onExtra?: () => void;
  // S6-Q39 (2026-09-05, Tasks only): bulk-file the selection into a project.
  // A HeadMenu capsule (this app's own "Fewer Buttons" dropdown), not a
  // second styled button, so Delete keeps its place as the bar's one filled
  // control (the reasoning right above Select All's own bare-text styling).
  // Absent when there is nothing to file into.
  projects?: { id: string; title: string }[];
  onMoveToProject?: (ids: string[], projectId: string) => void;
}) {
  // The bar is fixed above the tab bar, and while it is up the capture dock
  // steps aside: "Add anything" is not what anyone wants mid-selection, and
  // stacking both eats a third of a phone screen. A body class rather than
  // shell state, so a page can own its own select mode without every surface
  // having to thread a flag up through AppShell.
  //
  // Keyed off `active`, not off mounting, because the component returns null
  // when inactive and an effect that only ran on mount would leave the class
  // behind the moment a list emptied under a selection.
  useEffect(() => {
    if (!sel.active) return;
    document.body.classList.add("selecting");
    return () => document.body.classList.remove("selecting");
  }, [sel.active]);

  // Resolved after mount: the host lives in AppShell, which renders around
  // this page, so it exists by the time an effect runs but not during the
  // first render of a page that opens straight into select mode.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById("select-bar-host")); }, []);

  if (!sel.active || !host) return null;
  const n = sel.count;
  const label = n === 1 ? noun : noun + "s";
  return createPortal(
    <div className="select-bar" role="toolbar" aria-label={"Selected " + n + " " + label}>
      <button
        className="select-all"
        onClick={() => (sel.allSelected ? sel.clearAll() : sel.selectAll())}
      >
        {sel.allSelected ? "Select None" : "Select All"}
      </button>
      {/* No separate "2 Selected" label. It shipped for about ten minutes
          and the browser walk caught it sitting underneath "Mark Done": four
          things in one row at 390px, with the only flexible one in the
          middle. The count belongs on the Delete button anyway, where it is
          part of a sentence saying what will happen, rather than a number
          somewhere else that the reader has to carry across the bar. */}
      {extraLabel && onExtra && (
        <button className="btn btn-secondary btn-sm select-extra" disabled={n === 0} onClick={onExtra}>
          {extraLabel}
        </button>
      )}
      {projects && projects.length > 0 && onMoveToProject && (
        <div className={"select-move" + (n === 0 ? " select-move-off" : "")}>
          <HeadMenu
            variant="capsule"
            ariaLabel="Move to Project"
            value=""
            label="Move to Project"
            off
            options={projects.map((p) => ({ value: p.id, label: p.title }))}
            onPick={(v) => { if (n > 0 && v) onMoveToProject(sel.selected, v); }}
          />
        </div>
      )}
      {/* Disabled rather than hidden at zero: a control that vanishes and
          reappears as you tap rows makes the bar jump under your thumb, and
          the app's disabled treatment already reads as dead. */}
      <button
        className="btn btn-primary btn-sm select-del"
        disabled={n === 0}
        onClick={onDelete}
        aria-label={"Delete " + n + " " + label}
      >
        <Trash2 className="ic" />
        Delete {n > 0 ? n : ""}
      </button>
    </div>,
    host,
  );
}
