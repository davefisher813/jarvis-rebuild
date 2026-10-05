import type { ReactNode } from "react";

// A ROW'S SHEET (Dave 2026-10-05, locked: "Tap a row, detail bottom sheet with all actions, primary prominent, quieter
// ones below"). The row is a door and carries no capsule; this is what it opens. The first answer is the primary (the
// filled one), the rest sit beneath it quietly, and a destructive one wears the sheet's danger ink. The same first
// answer is the row's swipe-left and, once its moment has come, its one quiet word (RowCtxAction), so there is one verb
// per row. Each answer is an explicit tap, which is also what the Brain's identity-write agency law asks for.
export interface RowAnswer { label: string; onPick: () => void; destructive?: boolean }

export default function RowSheet({ eyebrow, text, facts, answers, onClose }: {
  /** What it is: "Needs Confirmation", "Medication". */
  eyebrow: string;
  /** The row's own words, already in the voice the row reads in. */
  text: string;
  /** Spans for the line under it (the CSS draws the dots). */
  facts?: ReactNode;
  /** The first is the primary; the rest are quiet. */
  answers: RowAnswer[];
  onClose: () => void;
}) {
  const [primary, ...rest] = answers;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{eyebrow}</div></div>
        <div className="pad-x sheet-form">
          <div className="strand-head">{text}</div>
          {facts && <div className="facts">{facts}</div>}
        </div>
        <div className="pad-x sheet-actions">
          {/* A destructive first answer (Remove, with nothing else to say) is not a filled red: it is the danger-ink button. */}
          {primary && <button type="button" className={primary.destructive ? "btn btn-secondary btn-block btn-danger-text" : "btn btn-primary btn-block"} onClick={() => { onClose(); primary.onPick(); }}>{primary.label}</button>}
          {rest.map((a) => (
            <button key={a.label} type="button" className={"btn btn-secondary btn-block" + (a.destructive ? " btn-danger-text" : "")} onClick={() => { onClose(); a.onPick(); }}>{a.label}</button>
          ))}
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
