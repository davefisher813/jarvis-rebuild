import { useState } from "react";
import { createPortal } from "react-dom";
import { haptics } from "../shared/haptics";
import type { Evidence } from "./evidence";

// THE CHIP THAT SHOWS ITS WORKING (UP-MIND-12, Email E6).
//
// A deadline chip you can tap to see the exact words is the difference
// between trusting the card and opening Gmail to check. The chip is the
// claim itself, so nothing new appears on a screen that already had one; it
// simply becomes tappable when there is a sentence behind it.
//
// Two rules:
//   - The sentence is shown UNTOUCHED. It is the sender's own words, quoted,
//     not cleaned, not shortened, not rewritten. It is the whole point.
//   - A claim with no evidence renders as a plain chip, exactly as it did
//     before. There is never a chip that opens onto nothing, and never a
//     "source unavailable" apology where a fact used to be.
export default function EvidenceChip({
  label,
  evidence,
  className = "",
  onOpenSource,
}: {
  label: string;
  evidence?: Evidence;
  className?: string;
  /** Opens the thread at the message the span came from. Absent means the
   *  sheet shows the words and stops there, which is still the answer. */
  onOpenSource?: (sourceMsgId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!evidence) return <span className={className}>{label}</span>;
  return (
    <>
      <button
        type="button"
        className={className + " ev-chip"}
        aria-label={label + ", see the sentence it came from"}
        onClick={(e) => { e.stopPropagation(); haptics.selection(); setOpen(true); }}
      >
        {label}
        <span className="ev-mark" aria-hidden="true">&#8221;</span>
      </button>
      {open && createPortal(
        <div className="sheet-scrim" onClick={() => setOpen(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">Where This Came From</div></div>
            <div className="pad-x">
              {/* The sender's sentence, as they wrote it. */}
              <div className="ev-span">{evidence.span}</div>
            </div>
            <div className="sheet-form">
              {onOpenSource && (
                <button
                  className="btn btn-secondary"
                  onClick={() => { setOpen(false); onOpenSource(evidence.sourceMsgId); }}
                >Open Thread</button>
              )}
              <button className="quiet-action" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
