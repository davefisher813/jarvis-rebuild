// WAITING TO SEND (Email v1 spec section 9, screen V08; Dave's locked decision 4). The message is approved and held on the
// server for 30 seconds; nothing has gone to Gmail. One action: Undo, which brings the draft back. The number is the
// server's clock, not this phone's. Leaving this screen does not stop a healthy held send, so Back says where you land.
// Screen readers hear the start, the cancel and the outcome, never the seconds ticking.

import PageHeader from "../shared/PageHeader";
import { EMAIL_TITLE, HELD_TITLE, NOT_SENT_YET, NO_SUBJECT, PREPARING_LINE, RECIPIENTS_LABEL, SENDING_LINE, SENT_FROM, UNDO_SEND, UNDO_TOO_LATE } from "./copy";
import EmailFacts from "./EmailFacts";
import type { HeldState } from "./useHeldSend";

export default function HeldSendScreen({ held, subject, from, recipients, onUndo, onBack }: {
  held: HeldState;
  subject: string;
  from: string;
  recipients: readonly string[];
  onUndo: () => void;
  onBack: () => void;
}) {
  const sending = held.phase === "sending";
  const label = sending ? SENDING_LINE : held.phase === "preparing" ? PREPARING_LINE : null;
  // "Not Sent Yet" while it is true; the countdown is one more fact. Sending is a different fact: it has left our hands.
  const facts = sending
    ? [{ text: SENDING_LINE, tone: "warn" as const }]
    : [{ text: NOT_SENT_YET, tone: "warn" as const }, ...(held.phase === "held" ? [{ text: `${held.seconds}s`, strong: true }] : label ? [{ text: label }] : [])];
  return (
    <div className="screen ruled email-outcome">
      <PageHeader title={HELD_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      <div className="pad-x"><div className="card email-review-card">
        <div className="email-card-value">{subject.trim() || NO_SUBJECT}</div>
        <dl className="email-review-facts">
          <dt>{SENT_FROM}</dt><dd>{from}</dd>
          <dt>{RECIPIENTS_LABEL}</dt><dd>{recipients.join(", ")}</dd>
        </dl>
        <div role="timer" aria-live="off"><EmailFacts wrap facts={facts} /></div>
      </div></div>
      {/* Announced once per change of state, not per second; drawn only when there is something to say. */}
      {(held.note ?? (sending ? UNDO_TOO_LATE : null)) && <div className="email-note quiet" role="status" aria-live="polite"><span>{held.note ?? UNDO_TOO_LATE}</span></div>}
      <div className="email-sheet-acts email-compose-acts">
        <button className="btn btn-primary" onClick={onUndo} disabled={sending || held.undoing}>{UNDO_SEND}</button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
