// REVIEW THIS EXACT MESSAGE (docs/jarvis-unified, slice 07;
// IMPLEMENTATION-SPEC.md 07.3, 08 E18, 09 M6). What the server will send and
// nothing else: the account and From, every recipient including Bcc, the
// subject, the whole body, each attachment with its size. Empty subject and
// empty body are said here, never filled in. The one tap is Send This Message,
// bound to the hash the server computed over exactly this; Edit goes back and
// the approval dies with the edit. A review lives five minutes; after that the
// tap is Review Again. Shut while offline; nothing is queued.

import PageHeader from "../shared/PageHeader";
import { lineFor, type CommandFailure } from "../substrate/commands/errors";
import {
  APPROVAL_SCOPE, ATTACHMENTS_LABEL, BCC_LABEL, CC_LABEL, EDIT_MESSAGE, EMPTY_BODY_WARN, EMPTY_SUBJECT_WARN, FROM_LABEL, NOT_SENT_YET, OFFLINE_SEND, REVIEW_AGAIN, REVIEW_EXPIRED,
  REVIEW_TITLE, SENDING_LINE, SEND_THIS, SUBJECT_LABEL, TO_LABEL, COMPOSE_TITLE,
} from "./copy";
import { sizeLine } from "./format";
import EmailFacts from "./EmailFacts";
import { reviewExpired, type Review } from "./drafts";

export default function SendReviewScreen({ review, offline, now, sending, failure, onEdit, onSend, onReviewAgain }: {
  review: Review;
  offline: boolean;
  now: () => Date;
  sending: boolean;
  /** The last tap's refusal, shown on this screen with the draft intact. */
  failure: CommandFailure | null;
  onEdit: () => void;
  onSend: () => void;
  onReviewAgain: () => void;
}) {
  const e = review.exact;
  const expired = reviewExpired(review.review.expires_at, now());
  const refusedForGood = failure && (failure.code === "REVIEW_CHANGED" || failure.code === "APPROVAL_EXPIRED" || failure.code === "DRAFT_SENT" || failure.code === "NOT_FOUND");
  // One tap on this screen: Send while the review stands, Review Again once it cannot be used.
  const again = expired || !!refusedForGood;
  return (
    <div className="screen ruled email-review">
      <PageHeader title={REVIEW_TITLE} back={COMPOSE_TITLE} onBack={onEdit} />
      <div className="pad-x">
        <div className="card email-review-card">
          <div><span className="email-badge">{NOT_SENT_YET}</span></div>
          <dl className="email-review-facts">
            <dt>{FROM_LABEL}</dt><dd>{e.from_identity}</dd>
            <dt>{TO_LABEL}</dt><dd>{e.to.join(", ")}</dd>
            {e.cc.length > 0 && <><dt>{CC_LABEL}</dt><dd>{e.cc.join(", ")}</dd></>}
            {e.bcc.length > 0 && <><dt>{BCC_LABEL}</dt><dd>{e.bcc.join(", ")}</dd></>}
            <dt>{SUBJECT_LABEL}</dt><dd>{e.subject.trim() ? e.subject : <span className="email-warn-word">{EMPTY_SUBJECT_WARN}</span>}</dd>
          </dl>
          <div className="email-review-body">{e.body_text.trim() ? e.body_text : <span className="email-warn-word">{EMPTY_BODY_WARN}</span>}</div>
          {e.attachments.length > 0 && (
            <div className="email-review-attachments">
              <div className="eyebrow email-eyebrow">{ATTACHMENTS_LABEL}</div>
              {/* 2026-10-05: the file's name is the title and its size the one fact, in white: two greys side by side were the old line. */}
              {e.attachments.map((a) => <div key={a.storage_id}><div className="conn-name truncate">{a.filename}</div><EmailFacts facts={[{ text: sizeLine(a.size_bytes), strong: true }]} /></div>)}
            </div>
          )}
        </div>
      </div>
      <div className="email-note quiet"><span>{APPROVAL_SCOPE}</span></div>
      {expired && <div className="email-note"><span>{REVIEW_EXPIRED}</span></div>}
      {failure && <div className="pad-x"><div className="input-error" role="alert">{lineFor(failure)}</div></div>}
      {offline && <div className="email-note quiet"><span>{OFFLINE_SEND}</span></div>}
      <div className="email-sheet-acts email-compose-acts">
        <button className="btn btn-primary" onClick={again ? onReviewAgain : onSend} disabled={offline || (!again && sending)}>{again ? REVIEW_AGAIN : sending ? SENDING_LINE : SEND_THIS}</button>
        <button className="quiet-action" onClick={onEdit} disabled={sending}>{EDIT_MESSAGE}</button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
