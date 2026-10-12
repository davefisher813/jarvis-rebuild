// ONE MAILBOX'S STATUS, EVERY DIMENSION (Email v1 spec 2026-10-08, sections 2.5 and 8.1; 2026-10-12).
//
// The mail home shows one headline; this sheet shows the three dimensions it was chosen from, as three separate rows,
// because "Connected" does not mean "Current" and neither says whether a send would go:
//
//   Sign-In    whether JARVIS's access to the mailbox works (the server's proof, Foundation Fix Spec 1)
//   Sync       whether the 90-day window is reconciled: the state, when it was last checked, and Catching Up while it is
//   Sending    whether the send permission is confirmed (connectionStatus sendReady); no test email is sent to prove it
//
// Each row is a name and one facts line (its state in its key colour, at most one grey). The actions are the sheet's
// own, below the rows, never pills inside them: Reconnect when the sign-in needs it (the same one-tap path as the banner),
// Retry Sync when the mailbox is not current. Reached from the Accounts row's menu, a quiet door.

import { createPortal } from "react-dom";
import type { AccountStatus, ClientView } from "../connections/connectionStatus";
import type { EmailAccount } from "./emailClient";
import EmailFacts from "./EmailFacts";
import { checkedFacts, type EmailFact } from "./format";
import { titleCase } from "../shared/casing";
import { CATCHING_UP, NOT_SYNCED, RECONNECT, STATE_WORD } from "./copy";
import { MAIL_NOT_UPDATING, RETRY_SYNC, SYNC_FAILED, SYNC_PAUSED } from "./statusHeadline";

export const STATUS_SHEET_TITLE = "Connection Status";
export const SIGN_IN_LABEL = "Sign-In";
export const SYNC_LABEL = "Sync";
export const SENDING_LABEL = "Sending";
export const SIGNED_IN = "Signed In";
export const UP_TO_DATE = "Up to Date";
export const READY_TO_SEND = "Ready to Send";
export const NOT_CONFIRMED = "Not Confirmed";
export const DONE = "Done";

const SEND_REASON: Record<string, string> = {
  "Send permission confirmed": READY_TO_SEND,
  "Send permission missing": "Send Permission Missing",
  "Send permission not confirmed": "Send Permission Not Confirmed",
  "Account needs attention": "Waits on Sign-In",
};

/** Sign-In: the proof when there is one, the cache row's state until then. Unknown is amber, never green (spec 2.8). */
export function signInFacts(account: EmailAccount, view: ClientView | undefined, status: AccountStatus | undefined): { facts: EmailFact[]; reconnect: boolean } {
  if (view) {
    if (view.state === "connected") return { facts: [{ text: SIGNED_IN, tone: "good" }], reconnect: false };
    if (view.state === "pending_auth") return { facts: [{ text: view.headline, tone: "warn" }, ...(view.detail ? [{ text: view.detail }] : [])], reconnect: true };
    if (view.state === "offline" || view.state === "stale") return { facts: [{ text: view.headline === "Offline" ? "Offline" : NOT_CONFIRMED, tone: "warn" }, ...(view.detail && view.state === "stale" ? [{ text: view.detail }] : [])], reconnect: false };
    if (status?.auth_state === "valid") return { facts: [{ text: SIGNED_IN, tone: "good" }], reconnect: false };
    return { facts: [{ text: view.headline, tone: "warn" }, ...(view.detail ? [{ text: view.detail }] : [])], reconnect: false };
  }
  if (account.state === "connected") return { facts: [{ text: STATE_WORD.connected, tone: "good" }], reconnect: false };
  return { facts: [{ text: STATE_WORD[account.state], tone: "warn" }], reconnect: account.state === "reauth" };
}

/** Sync: the state in its colour, then Last Checked and the time. Catching Up while the window is still being listed. */
export function syncFacts(account: EmailAccount, status: AccountStatus | undefined, now: Date = new Date()): { facts: EmailFact[]; retry: boolean } {
  const at = account.verified_through_at ?? account.last_sync_at;
  const checked = at ? checkedFacts(at, now) : [];
  const s = account.sync_state;
  const word: EmailFact | null =
    s === "current" ? { text: UP_TO_DATE, tone: "good" }
    : s === "catching_up" || s === "syncing" ? { text: CATCHING_UP, tone: "warn" }
    : s === "stale" ? { text: MAIL_NOT_UPDATING, tone: "warn" }
    : s === "failed" ? { text: SYNC_FAILED, tone: "warn" }
    : s === "paused" ? { text: SYNC_PAUSED, tone: "warn" }
    : s === "not_started" || !at ? { text: NOT_SYNCED, tone: "warn" }
    : status?.delivery.liveness === "stale" ? { text: MAIL_NOT_UPDATING, tone: "warn" }
    : null;
  // A row with a state says it in colour; the check time follows as the one grey plus its small-caps clock.
  return { facts: [...(word ? [word] : []), ...checked], retry: s !== "current" && account.state !== "disconnected" };
}

/** Sending: confirmed send permission, or what is missing, in Title Case. Never proven by a test email. */
export function sendFacts(status: AccountStatus | undefined): EmailFact[] {
  if (!status) return [{ text: NOT_CONFIRMED, tone: "warn" }];
  if (status.sendReady.ready) return [{ text: READY_TO_SEND, tone: "good" }];
  return [{ text: SEND_REASON[status.sendReady.reason] ?? titleCase(status.sendReady.reason), tone: "warn" }];
}

export default function AccountStatusSheet({ account, view, status, now = new Date(), onReconnect, onRetrySync, onClose }: {
  account: EmailAccount;
  view?: ClientView;
  status?: AccountStatus;
  now?: Date;
  /** The one-tap reconnect for this address (useReconnect.start). Absent: the sheet offers none. */
  onReconnect?: (email: string) => void;
  /** Catch the mailbox up now. Absent: the sheet offers none. */
  onRetrySync?: () => void;
  onClose: () => void;
}) {
  const sign = signInFacts(account, view, status);
  const sync = syncFacts(account, status, now);
  const send = sendFacts(status);
  const acts: Array<{ label: string; run: () => void }> = [
    ...(sign.reconnect && onReconnect ? [{ label: RECONNECT, run: () => onReconnect(account.address) }] : []),
    ...(sync.retry && onRetrySync ? [{ label: RETRY_SYNC, run: onRetrySync }] : []),
  ];
  const rows: Array<[string, EmailFact[]]> = [[SIGN_IN_LABEL, sign.facts], [SYNC_LABEL, sync.facts], [SENDING_LABEL, send]];
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={`${STATUS_SHEET_TITLE} ${account.address}`} onClick={(e) => e.stopPropagation()}>
        {/* The mailbox it is about, as every row sheet names its row (RowActionSheet's title); the dialog's name says what it is. */}
        <div className="grp"><div className="eyebrow">{account.address}</div></div>
        <div className="list-card-ruled">
          {rows.map(([label, facts]) => (
            <div className="row" key={label} data-dimension={label}>
              <div className="row-grow">
                <div className="conn-name">{label}</div>
                <EmailFacts wrap facts={facts} />
              </div>
            </div>
          ))}
        </div>
        {acts.length > 0 && (
          <div className="action-sheet">
            {acts.map((a) => <button key={a.label} onClick={() => { onClose(); a.run(); }}>{a.label}</button>)}
          </div>
        )}
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet"><button className="cancel" onClick={onClose}>{DONE}</button></div>
      </div>
    </div>,
    document.body,
  );
}
