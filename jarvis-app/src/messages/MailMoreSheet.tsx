import { createPortal } from "react-dom";
import { promises, type Decision, type MailAction } from "./mailAction";
import { Facts, type FactTone } from "./factsLine";
import { capAfterNumber } from "../shared/casing";

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
//
// THE HEAD IS TWO FACTS (§AM R1, R6, R8, 2026-09-26). It was subject, age
// and reason in one grey with two typed dots. The age now says what it
// means in the rail's own heat: red past the point an email helps, amber
// once it has been weeks, and a wait still inside a week is a neutral time
// in small caps. The reason is the one grey. The subject is not repeated:
// the row this sheet opens from, still behind it, already names it.
export default function MailMoreSheet({
  who,
  days,
  decision,
  onPick,
  onClose,
}: {
  who: string;
  days: number;
  decision: Decision;
  onPick: (a: MailAction) => void;
  onClose: () => void;
}) {
  const heat: FactTone = decision.tone === "firm" ? "red" : decision.tone === "direct" ? "warn" : "date";
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">More Moves</div></div>
        <div className="pad-x more-head">
          <div className="conn-name truncate">{who}</div>
          {/* The age first: it is short and never the one that gives way. */}
          <Facts facts={[
            { text: capAfterNumber(days + (days === 1 ? " day" : " days")), tone: heat },
            { text: decision.note },
          ]} />
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
