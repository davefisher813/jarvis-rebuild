import { createPortal } from "react-dom";
import { emit } from "../events";

// WHY THIS ONE (C-25, Astra pass 2026-09-12).
//
// The ranker has always had reasons; the page showed one of them, as grey
// subtext, with no way to disagree. This is the whole answer and the two
// taps that tell JARVIS whether it was right.
//
// Everything here is a fact the ranker already produced. Nothing is written
// for the sheet, and there is no free-text box.
//
// 2026-09-15 (Dave: "if they're not going to give real, real value, then we
// have to adjust them or get rid of some of them").
//
// IT USED TO HAVE TWO BUTTONS AND NEITHER DID ANYTHING.
//
//   "That's Right" emitted an event and closed the sheet. Closing the sheet
//   is what the scrim already does, so it was a Close button with an opinion.
//   It is gone.
//
//   "That's Wrong" emitted an event too. The event reaches the month seal's
//   suggestion tally and the AI context summary, and no ranker anywhere reads
//   it -- so you could tell JARVIS its pick was wrong and it would offer the
//   same task ten seconds later. It is one button now, it says what it does,
//   and it does it: the task steps out of the leading slot for the rest of
//   today and the next one takes its place (today/notThisOne.ts).
//
// The event still fires, because the monthly tally is a real if slow use of
// the signal. It is no longer the ONLY thing that happens.
export default function WhySheet({
  taskId, reasons, leaningOn, onOpenStrand, onNotThisOne, onClose,
}: {
  taskId: string;
  /** The ranker's own fragments, in its own order. */
  reasons: string[];
  /** The strand the day's plan leaned on, when the plan came from the AI. */
  leaningOn?: { text: string; confidence?: string } | null;
  onOpenStrand?: () => void;
  /** Step this task out of the leading slot for the rest of today. Absent,
   *  the sheet is a read-only explanation and shows no verb at all, rather
   *  than a button that cannot keep its promise. */
  onNotThisOne?: () => void;
  onClose: () => void;
}) {
  const notThisOne = () => {
    emit({
      type: "suggestion.dismissed",
      entityType: "task",
      entityId: taskId,
      props: { kind: "why" },
    });
    onNotThisOne?.();
    onClose();
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Why This One</div></div>
        <div className="pad-x">
          <div className="facts">
            {reasons.map((r, i) => (
              // One coloured fact per line is the law; these are the
              // ranker's fragments and they are all quiet, which is right:
              // the sheet is an explanation, not another alarm.
              <span className="fact" key={i}>{r}</span>
            ))}
          </div>
        </div>
        {leaningOn && (
          <>
            <div className="grp"><div className="eyebrow">Leaning On</div></div>
            <div
              className="row"
              {...(onOpenStrand ? { role: "button", tabIndex: 0, onClick: () => { onOpenStrand(); onClose(); } } : {})}
            >
              <div className="row-stack">
                <div className="conn-name">{leaningOn.text}</div>
                <div className="facts">
                  <span className="fact purp">Learned</span>
                  {leaningOn.confidence && <span className="fact">{leaningOn.confidence}</span>}
                </div>
              </div>
              {onOpenStrand && <span className="chev" aria-hidden="true" />}
            </div>
          </>
        )}
        {onNotThisOne && (
          <div className="sheet-form">
            <button className="btn btn-secondary btn-block" onClick={notThisOne}>Not This One</button>
            <div className="bp-sub">It keeps its date and stays in the deck. Today just leads with something else.</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
