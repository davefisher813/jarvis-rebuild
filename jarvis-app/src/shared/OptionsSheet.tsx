import type React from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// THE PLACE SECONDARY TOOLS LIVE (Dave 2026-09-17, Unified Headers handoff,
// rule 7: "The title options button opens a sheet for Area, Sort, Group and
// selection tools. Preserve Tasks camera capture, Notes attachments/import,
// bulk select, deleted items and any existing per-page tools").
//
// The chips above are for WORKFLOW STATE and nothing else. Area names, sort
// order, grouping, bulk select, import and Recently Deleted were mixed into
// that same row on Notes and spread across three dropdown capsules on Tasks;
// they are all one tap from the same control now, on all five pages.
//
// Nothing here is new behaviour. Every row opens a menu or a screen the page
// already had -- this is where they are reachable from, not what they do.

export interface OptionRow {
  key: string;
  label: string;
  /** The current answer, on the right: "All areas", "Last edited". Absent on
   *  a row that opens a screen rather than holding a setting. */
  value?: string;
  /** A real count, drawn only when the page has one. Never a zero. */
  count?: number;
  /** THE PAGE'S OWN CONTROL, RELOCATED (2026-09-17). Area and Group were
   *  HeadMenu capsules on a line under the head; the row hands the same
   *  component the same props in its right-hand slot rather than a new
   *  picker reimplementing the same menu. Moving a control is not the same
   *  as rebuilding it, and the handoff asks for the first one. */
  right?: ReactNode;
  onClick?: () => void;
}

export default function OptionsSheet({ title, rows, onClose }: {
  /** "Notes Options", "Tasks Options". Title Case, like every other sheet. */
  title: string;
  rows: OptionRow[];
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* Done, not Cancel and Save: nothing on this sheet is a draft. Each
            row writes as it is tapped, so the only thing left to say is that
            you are finished looking at it. */}
        <div className="opt-bar">
          <div className="opt-title">{title}</div>
          <button type="button" className="opt-done" onClick={onClose}>Done</button>
        </div>
        <div className="pad-x"><div className="card list-card-ruled">
          {rows.map((r) => (
            <div key={r.key} className="row" {...(r.onClick ? {
              role: "button", tabIndex: 0, onClick: r.onClick,
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onClick!(); } },
            } : {})}>
              <div className="row-grow"><div className="conn-name">{r.label}</div></div>
              {r.value && <span className="opt-val">{r.value}</span>}
              {typeof r.count === "number" && r.count > 0 && <span className="opt-val">{r.count}</span>}
              {r.right}
              {r.onClick && <div className="chev" />}
            </div>
          ))}
        </div></div>
        <div className="xs-foot" />
      </div>
    </div>,
    document.body,
  );
}
