import { createPortal } from "react-dom";
import { promises, type Decision, type MailAction } from "./mailAction";

// THE REST OF THE MOVES (Dave's pick, 2026-08-21: "one button, rest on
// swipe").
//
// The row shows ONE action, because the whole point of the action model is
// that reading four buttons replaces reading four emails, and that only works
// if there is one button per row. Everything else the thread could become
// lives here, one swipe away.
//
// Three rules, all learned the hard way:
//   - Every row states what the tap DOES underneath what it says. A list of
//     five verbs with no consequences is a quiz.
//   - Nothing appears here that has no handler. decide() gates the list on
//     capability, so a missing task service shortens the sheet rather than
//     printing a button that does nothing.
//   - The reason is said ONCE, by the sheet, not repeated down every row.
//     That was the original Waiting On sin.
export default function MailMoreSheet({
  who,
  subject,
  days,
  decision,
  onPick,
  onClose,
}: {
  who: string;
  subject: string;
  days: number;
  decision: Decision;
  onPick: (a: MailAction) => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">More Moves</div></div>
        <div className="pad-x more-head">
          <div className="conn-name truncate">{who}</div>
          <div className="conn-meta">{subject} &middot; {days}d &middot; {decision.note}</div>
        </div>
        <div className="sheet-form">
          <div className="list-flat">
            {decision.alternates.map((a) => (
              <div
                key={a.key}
                className="row"
                role="button"
                tabIndex={0}
                onClick={() => onPick(a)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(a); }}
              >
                <div className="row-grow">
                  <div className="conn-name">{a.label}</div>
                  <div className="conn-meta">{promises(a)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
