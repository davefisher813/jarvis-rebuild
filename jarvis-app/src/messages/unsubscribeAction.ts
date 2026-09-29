import type { GoogleApi } from "../connections/google/api";
import { encodeEmail } from "../connections/google/map";
import { settleAll } from "./settle";
import { UNSUB_SUBJECT, UNSUB_BODY, type Unsub } from "./unsubscribe";
import { recordUnsub, type UnsubRecord } from "./unsubRecords";

// ASKING ONE SENDER TO STOP (extracted from MessagesFlow, 2026-09-29).
//
// The Email tab's sweep and Today's Unsubscribe button do the same thing, so
// they call the same function. It keeps the two forms and the honesty the tab
// always had:
//   - mailto is SENT, from the exact account the list mails (a sender only
//     honours an unsubscribe from the subscribed address), and is recorded
//     only after the mail server acknowledged it.
//   - a web link is OPENED. Without List-Unsubscribe-Post a URL may be a page
//     that needs a click, so opening it is not asking, and it is recorded as
//     OPENED, never as done.
// Neither is ever reported as confirmed: the sender decides.

export interface UnsubDeps {
  /** The mail client for this account, or null when it is no longer connected (which counts as failed). */
  apiFor: (account?: string) => Pick<GoogleApi, "sendMessage"> | null | undefined;
  /** Opens a page inside the tap. False when it did not open. */
  open: (url: string) => boolean;
  /** Where the record goes. Defaults to the device's own list. */
  record?: (r: UnsubRecord) => void;
  /** Told once when the ask left, for analytics. */
  emit?: (kind: Unsub["kind"]) => void;
  today: () => string;
}

export interface UnsubOutcome {
  /** The ask left the building: a mail was accepted, or a page opened. */
  sent: boolean;
  kind: Unsub["kind"];
}

/**
 * The ask itself. A web link opens synchronously, before any await, so a tap
 * on iOS keeps its gesture; a mailto awaits the send.
 */
export async function requestUnsubscribe(
  u: Unsub,
  account: string | undefined,
  sender: string | undefined,
  deps: UnsubDeps,
): Promise<UnsubOutcome> {
  let sent = false;
  if (u.kind === "mailto") {
    // EMAIL-F-13 (2026-09-05): the ask leaves from the address the list
    // actually mails, not from whichever account happens to be first.
    const api = deps.apiFor(account);
    if (!api) return { sent: false, kind: u.kind };
    const { ok } = await settleAll([u], () =>
      api.sendMessage(encodeEmail({ to: u.target, subject: u.subject || UNSUB_SUBJECT, body: UNSUB_BODY })));
    sent = ok.length > 0;
  } else {
    sent = deps.open(u.target);
  }
  if (sent) {
    deps.emit?.(u.kind);
    // UP-MIND-17 (2026-09-05): WHEN, HOW and FROM WHICH ACCOUNT. Without those
    // three the app could only ever say "asked", which is why it could never
    // say "asked three weeks ago and they are still sending". 2026-09-29: and
    // WHETHER, since a page opened is not an ask sent.
    if (sender) {
      (deps.record ?? ((r) => { recordUnsub(r); }))({
        sender: sender.toLowerCase(),
        askedISO: deps.today(),
        via: u.kind === "mailto" ? "header" : "link",
        state: u.kind === "mailto" ? "asked" : "opened",
        ...(account ? { account } : {}),
      });
    }
  }
  return { sent, kind: u.kind };
}
