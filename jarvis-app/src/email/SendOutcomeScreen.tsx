// THE OUTCOME (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 07.3,
// 09 M7, 13 "Provider send timeout"). Three honest states and no fourth: Sent
// (Gmail accepted it; accepted is not read), Not Sent (why, and Review Again,
// which is a new tap), and Send Status Unknown (JARVIS could not tell; nothing
// is resent on its own; Check Again looks for the message in Gmail by the id
// the review bound, and only finding it settles anything; Open in Gmail is
// the other honest door). Each has its receipt.

import PageHeader from "../shared/PageHeader";
import { lineFor, type CommandFailure } from "../substrate/commands/errors";
import { openExternal } from "../messages/openExternal";
import {
  CHECK_AGAIN, CHECK_GMAIL, EMAIL_TITLE, NOT_SENT_TITLE, OPEN_GMAIL_EXACT, OPEN_GMAIL_GENERIC, RECIPIENTS_LABEL, RESEND_SHUT, REVIEW_AGAIN, SENDING_LINE, SENT_FROM, SENT_LINE, SENT_TITLE,
  UNKNOWN_TITLE, UNKNOWN_WHY, VIEW_RECEIPT_LONG, NO_SUBJECT,
} from "./copy";
import { gmailLink } from "./emailClient";
import { outcomeOf, type DraftRow } from "./drafts";

export default function SendOutcomeScreen({ draft, offline, checking, checkLine, onBack, onReviewAgain, onCheckAgain, onReceipt }: {
  draft: DraftRow;
  offline: boolean;
  checking: boolean;
  /** The last Check Again's answer. */
  checkLine: string | CommandFailure | null;
  onBack: () => void;
  onReviewAgain: () => void;
  onCheckAgain: () => void;
  onReceipt: (actionId: string) => void;
}) {
  const outcome = outcomeOf(draft);
  const title = outcome === "sent" ? SENT_TITLE : outcome === "unknown" ? UNKNOWN_TITLE : outcome === "failed" ? NOT_SENT_TITLE : SENDING_LINE;
  const threadId = (draft.provider_ack?.thread_id as string | undefined) ?? draft.reply_headers?.thread_id ?? draft.thread_id ?? null;
  const link = gmailLink(draft.account, threadId);
  const recipients = [...draft.to_addresses, ...draft.cc_addresses, ...draft.bcc_addresses];
  const why = outcome === "failed" ? draft.action_verb && /^Not Sent/.test(draft.action_verb) ? draft.action_verb : draft.error_code ? lineFor({ code: isKnown(draft.error_code) ? draft.error_code : "UNAVAILABLE" }) : null : null;
  return (
    <div className="screen ruled email-outcome">
      <PageHeader title={title} back={EMAIL_TITLE} onBack={onBack} />
      <div className="pad-x"><div className={"card email-review-card email-outcome-" + outcome}>
        <div className="email-card-value">{draft.subject.trim() || NO_SUBJECT}</div>
        <dl className="email-review-facts">
          <dt>{SENT_FROM}</dt><dd>{draft.account}</dd>
          <dt>{RECIPIENTS_LABEL}</dt><dd>{recipients.join(", ")}</dd>
        </dl>
        {outcome === "sent" && <div className="email-card-detail">{SENT_LINE}</div>}
        {outcome === "failed" && why && <div className="email-card-detail">{why}</div>}
        {outcome === "unknown" && <><div className="email-card-detail">{UNKNOWN_WHY}</div><div className="email-card-detail">{CHECK_GMAIL}</div></>}
        {outcome === "sending" && <div className="email-card-detail">{SENDING_LINE}</div>}
      </div></div>
      {checkLine && <div className="email-note quiet"><span>{typeof checkLine === "string" ? checkLine : lineFor(checkLine)}</span></div>}
      <div className="email-sheet-acts email-compose-acts">
        {(outcome === "failed" || outcome === "unknown") && (
          <button className="btn btn-primary" onClick={outcome === "failed" ? onReviewAgain : onCheckAgain} disabled={offline || (outcome === "unknown" && checking)}>{outcome === "failed" ? REVIEW_AGAIN : CHECK_AGAIN}</button>
        )}
        {outcome === "unknown" && <button className="quiet-action" disabled>{RESEND_SHUT}</button>}
        {(outcome === "sent" || outcome === "unknown") && <button className="quiet-action" onClick={() => openExternal(link.href)}>{link.exact ? OPEN_GMAIL_EXACT : OPEN_GMAIL_GENERIC}</button>}
        {draft.sent_action_id && <button className="quiet-action" onClick={() => onReceipt(draft.sent_action_id!)}>{VIEW_RECEIPT_LONG}</button>}
      </div>
      <div className="screen-foot" />
    </div>
  );
}

const KNOWN = new Set(["REVIEW_CHANGED", "APPROVAL_EXPIRED", "PROVIDER_AUTH", "PROVIDER_SCOPE", "RATE_LIMITED", "INVALID_PAYLOAD", "UNAVAILABLE", "NOT_FOUND", "OUTCOME_UNKNOWN", "DRAFT_SENT"]);
const isKnown = (c: string): c is "REVIEW_CHANGED" | "APPROVAL_EXPIRED" | "PROVIDER_AUTH" | "PROVIDER_SCOPE" | "RATE_LIMITED" | "INVALID_PAYLOAD" | "UNAVAILABLE" | "NOT_FOUND" | "OUTCOME_UNKNOWN" | "DRAFT_SENT" => KNOWN.has(c);
