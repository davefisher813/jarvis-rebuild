import { Fragment } from "react";
import { CANCEL_LABEL, cardLines, confirmLabel, type Proposal } from "./proposals";

// THE CARDS IN THE THREAD (chat box order, 2026-10-24: "every consequential action shows its EXACT content before it can happen").
//
// A proposal is drawn the way the chat already draws a draft it is waiting on (the email draft's Open and Discard): a JARVIS bubble that
// holds the words, and under it the chips that act on them. The bubble is the card's own lines (proposals.ts, cardLines), whole and in
// order, so what the person reads is what the change will do and nothing the model said. The chips are capsules standing outside the
// bubble: nothing sits alone in a box, and no pill sits inside one.
//
//   open      the question and the content, then the change named for what it does (Add Task, Mark Done, Move Task) and Not Now.
//   working   the tap was accepted and the change is being made; the chips rest until the receipt lands.
//   expired   five minutes passed. The content stays so the person can see what it was, the grey line says nothing was changed, and the
//             only chip closes it. There is no way to approve it.
//
// Tapping Not Now or the change itself is the person's alone: nothing in this file can make either happen without a tap.

export default function ProposalCards({ proposals, onApprove, onCancel, onDismiss }: {
  proposals: Proposal[];
  onApprove(p: Proposal): void;
  onCancel(p: Proposal): void;
  onDismiss(p: Proposal): void;
}) {
  return (
    <>
      {proposals.map((p) => (
        <Fragment key={p.id}>
          <div className="chat-bubble chat-jarvis" role="group" aria-label="Proposed Change">
            <div className="chat-text">{cardLines(p.content).join("\n")}</div>
            {p.state === "expired" && <div className="chat-prov">Timed out · Nothing was changed</div>}
          </div>
          <div className="chip-row chat-refs">
            {p.state === "expired" ? (
              <button type="button" className="chip" onClick={() => onDismiss(p)}>Dismiss</button>
            ) : (
              <>
                <button type="button" className={"chip chip-act" + (p.state === "approved" ? " chip-off" : "")} aria-busy={p.state === "approved"} onClick={() => onApprove(p)}>{confirmLabel(p.content)}</button>
                <button type="button" className={"chip" + (p.state === "approved" ? " chip-off" : "")} onClick={() => onCancel(p)}>{CANCEL_LABEL}</button>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </>
  );
}
