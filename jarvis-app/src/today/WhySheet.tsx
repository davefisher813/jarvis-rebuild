import { createPortal } from "react-dom";
import { emit } from "../events";

// WHY THIS ONE (C-25, Astra pass 2026-09-12).
//
// The ranker has always had reasons; the page showed one of them, as grey
// subtext, with no way to disagree. This is the whole answer and the two
// taps that tell JARVIS whether it was right.
//
// Everything here is a fact the ranker already produced. Nothing is written
// for the sheet, and there is no free-text box: the two buttons emit
// suggestion.accepted / suggestion.dismissed with kind "why" and the task's
// id, which is the entire payload. What was suggested, and whether he took
// it, is the signal; what he might have typed about it is not the log's
// business.
export default function WhySheet({
  taskId, reasons, leaningOn, onOpenStrand, onClose,
}: {
  taskId: string;
  /** The ranker's own fragments, in its own order. */
  reasons: string[];
  /** The strand the day's plan leaned on, when the plan came from the AI. */
  leaningOn?: { text: string; confidence?: string } | null;
  onOpenStrand?: () => void;
  onClose: () => void;
}) {
  const answer = (right: boolean) => {
    emit({
      type: right ? "suggestion.accepted" : "suggestion.dismissed",
      entityType: "task",
      entityId: taskId,
      props: { kind: "why" },
    });
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
        <div className="sheet-form">
          <button className="btn btn-primary" onClick={() => answer(true)}>That&rsquo;s Right</button>
          <button className="quiet-action" onClick={() => answer(false)}>That&rsquo;s Wrong</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
