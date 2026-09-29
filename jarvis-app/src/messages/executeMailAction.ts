import type { AddMeetingResult, MeetingCandidate, NotificationAction } from "./mailContracts";
import type { Unsub } from "./unsubscribe";
import { canExecuteMailAction, isCompleteMeeting, recallCode, rememberCode, validateHttpsUrl } from "./notificationActions";

// THE TAP, CARRIED OUT (2026-09-29).
//
// One dispatch for every notification button on Today. It performs what the
// button's label says and reports what actually happened, in words that never
// claim more:
//
//   - Opened is not granted, signed, accepted, submitted, paid or unsubscribed.
//     A page that opened is a page that opened; what happens on it is between
//     Dave and the site.
//   - "Added" is said only after the save landed. "Code copied" only after the
//     clipboard accepted it. "Asked them to stop" only after the mail server
//     took the message.
//   - A local event added and an external RSVP confirmed are two facts, and the
//     result carries them separately. Nothing here can confirm an RSVP: Google
//     Calendar is read-only to this app, so the message says "RSVP not
//     confirmed" unless a caller passes a read-only check that says otherwise.
//   - If a link would not open, the exact validated link comes back so the
//     screen can offer it.
//
// This is dispatch only. It detects nothing and asks no model anything: what an
// action is was decided in notificationActions.ts, before the tap.
//
// EVERY OPEN COMES BEFORE THE FIRST AWAIT. iOS drops a window.open that is not
// made inside the tap, so each branch that opens a page does it in the
// synchronous part of this function.

export type MailActionStatus = "completed" | "opened" | "failed" | "partial";

export interface MailActionTarget {
  action: NotificationAction;
  threadId: string;
  account?: string;
  /** The sender's display name and address, for the unsubscribe record. */
  from?: string;
  fromEmail?: string;
  /** What an event added from this is called. */
  title?: string;
}

export interface MailActionDeps {
  /** The signed-in user id: code memory is keyed by it. */
  owner: string;
  /** Opens a page inside the tap. False when it did not open. */
  open: (url: string) => boolean;
  /** Writes to the clipboard, resolving only when it was accepted. Called inside the tap. */
  copy: (text: string | Promise<string>) => Promise<void>;
  /** addEmailMeetingOnce, bound to the schedule. Absent means no local add is possible here. */
  addMeeting?: (args: { candidate: MeetingCandidate; threadId: string; account?: string; title?: string }) => Promise<AddMeetingResult>;
  /** A read-only look at whether the RSVP landed. Optional, and never assumed. */
  verifyRsvp?: () => Promise<boolean>;
  /** requestUnsubscribe, bound to the account's mail client and the device's list. */
  requestUnsub?: (u: Unsub, account?: string, sender?: string) => Promise<{ sent: boolean; kind: Unsub["kind"] }>;
  /** The exact message read again, when the code has left memory. No model. Null when there is not one unambiguous code. */
  loadCode?: (t: MailActionTarget) => Promise<string | null>;
  now?: () => number;
}

export interface MailActionResult {
  status: MailActionStatus;
  /** What is true, for the receipt. */
  message: string;
  /** Takes back only what Jarvis wrote, and says true only when it is gone. */
  undo?: () => Promise<boolean>;
  /** The job is finished, so the notice may leave. False for anything that only opened a page. */
  settled: boolean;
  /** A link that would not open, exactly as validated, to offer instead. */
  fallbackUrl?: string;
  /** Open the thread: the tap could not do its job and there is somewhere better to go. */
  openThread?: boolean;
  /** What happened to Jarvis's own calendar, apart from the RSVP. */
  localEvent?: "added" | "already" | "failed";
  /** What is known of the RSVP at the sender's end. Not the same as localEvent. */
  rsvp?: "not_confirmed" | "confirmed";
}

const OPENED: Partial<Record<NotificationAction["kind"], string>> = {
  grant_access: "Opened Google's access request.",
  open_share: "Opened.",
  sign: "Opened the signing page.",
  track: "Opened tracking.",
  fill_form: "Opened the form.",
  fix_payment: "Opened the payment page.",
};

class NoCode extends Error { constructor() { super("no single code"); } }

const fail = (message: string, extra: Partial<MailActionResult> = {}): MailActionResult =>
  ({ status: "failed", message, settled: false, ...extra });

export function executeMailAction(t: MailActionTarget, deps: MailActionDeps): Promise<MailActionResult> {
  const a = t.action;
  // Re-checked here: a stored action is data, and data can be edited.
  if (!canExecuteMailAction(a, { canOpen: true, canCopy: true, canSchedule: !!deps.addMeeting, hasMailApi: !!deps.requestUnsub })) {
    return Promise.resolve(fail("Can't Do That From Here", { openThread: true }));
  }
  switch (a.kind) {
    case "copy_code": return copyCode(t, deps);
    case "add_travel": return addTravel(t, deps);
    case "unsubscribe": return unsubscribe(t, deps);
    case "accept_invite": return acceptInvite(t, deps);
    default: return Promise.resolve(openPage(t, deps));
  }
}

function openPage(t: MailActionTarget, deps: MailActionDeps): MailActionResult {
  const url = validateHttpsUrl(t.action.url);
  if (!url) return fail("Couldn't Open That Link", { openThread: true });
  if (!deps.open(url)) return fail("Your Browser Blocked That Tab", { fallbackUrl: url });
  return { status: "opened", message: OPENED[t.action.kind] ?? "Opened.", settled: false };
}

async function acceptInvite(t: MailActionTarget, deps: MailActionDeps): Promise<MailActionResult> {
  const url = validateHttpsUrl(t.action.url);
  if (!url) return fail("Couldn't Open That Link", { openThread: true });
  // The page first, inside the tap. Nothing is added to Jarvis for an
  // invitation whose page never opened: the tap did not do what it said.
  if (!deps.open(url)) return fail("Your Browser Blocked That Tab", { fallbackUrl: url });

  let rsvp: "not_confirmed" | "confirmed" = "not_confirmed";
  const mtg = t.action.meeting;
  let local: AddMeetingResult | null = null;
  if (mtg && isCompleteMeeting(mtg) && deps.addMeeting) {
    try {
      local = await deps.addMeeting({ candidate: mtg, threadId: t.threadId, ...(t.account ? { account: t.account } : {}), ...(t.title ? { title: t.title } : {}) });
    } catch {
      local = { status: "failed", message: "Couldn't add it" };
    }
  }
  if (deps.verifyRsvp) {
    try { if (await deps.verifyRsvp()) rsvp = "confirmed"; } catch { /* unverified stays unverified */ }
  }
  const tail = rsvp === "confirmed" ? "RSVP confirmed" : "RSVP not confirmed";
  if (local?.status === "added") {
    return { status: "partial", message: `Opened · Added to Jarvis · ${tail}`, settled: false, localEvent: "added", rsvp, ...(local.undo ? { undo: local.undo } : {}) };
  }
  if (local?.status === "already") {
    return { status: "opened", message: `Opened · Already on Jarvis · ${tail}`, settled: false, localEvent: "already", rsvp };
  }
  if (local?.status === "failed") {
    return { status: "partial", message: `Opened · Couldn't Add to Jarvis · ${tail}`, settled: false, localEvent: "failed", rsvp };
  }
  return { status: "opened", message: `Opened · ${tail}`, settled: false, rsvp };
}

async function addTravel(t: MailActionTarget, deps: MailActionDeps): Promise<MailActionResult> {
  const mtg = t.action.meeting;
  // More than one leg, or one that is missing a date or a time: the existing
  // review flow (the thread) is where that gets settled. Nothing is written.
  if (!mtg || !isCompleteMeeting(mtg) || !deps.addMeeting) {
    return { status: "opened", message: "Opened to Review · Nothing Added", settled: false, openThread: true };
  }
  let r: AddMeetingResult;
  try {
    r = await deps.addMeeting({ candidate: mtg, threadId: t.threadId, ...(t.account ? { account: t.account } : {}), ...(t.title ? { title: t.title } : {}) });
  } catch {
    return fail("Couldn't Add It · Nothing Was Saved");
  }
  switch (r.status) {
    case "added":
      return { status: "completed", message: r.message, settled: true, localEvent: "added", ...(r.undo ? { undo: r.undo } : {}) };
    case "already":
      return { status: "completed", message: r.message, settled: true, localEvent: "already" };
    case "incomplete":
      return { status: "opened", message: "Opened to Review · Nothing Added", settled: false, openThread: true };
    default:
      return fail(r.message || "Couldn't Add It · Nothing Was Saved", { localEvent: "failed" });
  }
}

function copyCode(t: MailActionTarget, deps: MailActionDeps): Promise<MailActionResult> {
  const now = deps.now?.() ?? Date.now();
  const scope = { userId: deps.owner, account: t.account ?? "", messageId: t.action.evidence.sourceMessageId };
  const known = recallCode(scope, now);
  // The write starts NOW, inside the tap. When the code has left memory the
  // write is handed a promise of it: the exact message is read again (no
  // model), and a message with no single code rejects, which is a failure and
  // never a copy.
  const source: string | Promise<string> = known ?? (deps.loadCode
    ? deps.loadCode(t).then((c) => { if (!c) throw new NoCode(); rememberCode(scope, c, deps.now?.() ?? Date.now()); return c; })
    : Promise.reject(new NoCode()));
  if (typeof source !== "string") source.catch(() => { /* reported below, through copy */ });
  return deps.copy(source).then(
    // Said only now, after the clipboard accepted it.
    () => ({ status: "completed", message: "Code copied", settled: true }) as MailActionResult,
    (e: unknown) => e instanceof NoCode
      ? fail("No Single Code Found · Opening the Email", { openThread: true })
      : fail("Couldn't Copy · Opening the Email", { openThread: true }),
  );
}

async function unsubscribe(t: MailActionTarget, deps: MailActionDeps): Promise<MailActionResult> {
  const u = t.action.unsubscribe;
  if (!u || !deps.requestUnsub) return fail("Couldn't Ask · Nothing Was Asked", { openThread: true });
  const out = await deps.requestUnsub(u, t.account, t.fromEmail);
  if (out.sent) {
    // Never "unsubscribed": the sender decides.
    return u.kind === "mailto"
      ? { status: "completed", message: "Asked them to stop", settled: true }
      : { status: "opened", message: "Opened unsubscribe page", settled: false };
  }
  return u.kind === "mailto"
    ? fail("Couldn't Send It · Nothing Was Asked")
    : fail("Your Browser Blocked That Tab · Nothing Was Asked", { fallbackUrl: validateHttpsUrl(u.target) ?? undefined });
}
