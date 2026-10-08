// ONE-TAP RECONNECT, THE RULES (Foundation Fix Spec 4, 2026-10-07).
//
// A reconnect is not done when Google's window closes. It is done when the
// server has proved, in order, that the person who came back is the person the
// account belongs to and that what they handed over actually works. This file
// is the pure half, shared by the server (api/google.ts, api/_reconnect.ts) and
// the app: the signed `state` that carries the intent and expires, the order of
// the checks, and the words for each outcome. No I/O here, so every rule has a
// test that needs no network.
//
// THE STATE. The OAuth `state` parameter is not a random string the app makes
// up: the server mints it when Dave taps Reconnect, it names the account and the
// person, it expires in ten minutes, and it is verified (signature, age, owner)
// BEFORE any code is exchanged. A code that arrives with no valid state is
// never exchanged. It is signed (HMAC-SHA256) under a key derived from the
// token key with its own label, so it is stateless-verifiable even before the
// attempt table (migration 0058) exists; the table adds single use and the
// server-owned progress record.

/** The longest an attempt may live. Spec 4: at most ten minutes. */
export const STATE_TTL_MS = 10 * 60e3;
const PREFIX = "rc1";

export interface StatePayload {
  /** The attempt this state belongs to. */
  a: string;
  /** The JARVIS user who asked. */
  u: string;
  /** The account being reconnected, lowercase. */
  e: string;
  /** Expiry, epoch ms. */
  x: number;
  /** Random per attempt, so two states for the same account are never equal. */
  n: string;
}

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

async function hmacKey(tokenKeyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(tokenKeyB64), (c) => c.charCodeAt(0));
  // A key for this purpose alone: the token key itself never signs anything.
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("jarvis-reconnect-state"), info: enc.encode("v1") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"],
  );
}

export function newNonce(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(12)));
}

export async function signState(p: StatePayload, tokenKeyB64: string): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(p)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(tokenKeyB64), enc.encode(`${PREFIX}.${body}`)));
  return `${PREFIX}.${body}.${b64u(sig)}`;
}

export type StateCheck =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_user" };

/** Checked before any code exchange. Expiry is judged on the server's clock and is capped at STATE_TTL_MS whatever the payload claims. */
export async function verifyState(state: unknown, tokenKeyB64: string, o: { userId: string; nowMs: number }): Promise<StateCheck> {
  if (typeof state !== "string" || state.length > 1024) return { ok: false, reason: "malformed" };
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "malformed" };
  let payload: StatePayload;
  try {
    const good = await crypto.subtle.verify("HMAC", await hmacKey(tokenKeyB64), unb64u(parts[2]!), enc.encode(`${PREFIX}.${parts[1]}`));
    if (!good) return { ok: false, reason: "bad_signature" };
    payload = JSON.parse(new TextDecoder().decode(unb64u(parts[1]!))) as StatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.a !== "string" || typeof payload.u !== "string" || typeof payload.e !== "string" || typeof payload.x !== "number") return { ok: false, reason: "malformed" };
  if (payload.u !== o.userId) return { ok: false, reason: "wrong_user" };
  if (!(o.nowMs < payload.x) || payload.x - o.nowMs > STATE_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

// ---- The attempt's lifecycle -----------------------------------------------

export const ATTEMPT_STATUSES = [
  "started",       // issued, Google not yet back
  "verified",      // all six checks passed and the credential is stored
  "wrong_account", // Google returned a different address than the one being reconnected
  "needs_step",    // access granted, but no refresh token: cannot renew by itself
  "scope_missing", // the permissions granted do not cover mail
  "unverified",    // the new token did not refresh, or could not read the mailbox
  "denied",        // Google refused the flow (its reason is recorded)
  "cancelled",     // the person closed the window: silent
  "expired",       // ten minutes passed
  "superseded",    // a newer attempt for the same account replaced it
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Outcomes that are not a failure of the person's and are never shown as an alarm. */
export const SILENT_STATUSES: readonly AttemptStatus[] = ["cancelled", "superseded"];

// ---- The six checks, in order (failure-modes E1) ----------------------------

export interface ExchangeFacts {
  intendedEmail: string;
  /** The address Google answered with for the token it issued. Null when it could not be read. */
  returnedEmail: string | null;
  /** The scopes Google says were granted, space separated. Empty when it did not say. */
  grantedScope: string;
  /** Google sent a refresh token with this exchange. */
  newRefreshToken: boolean;
  /** A refresh token is already stored for this identity and its grant is not dead. */
  storedRefreshUsable: boolean;
}

export type Judgement =
  | { ok: true }
  | { ok: false; status: "wrong_account" | "scope_missing" | "needs_step"; step: 1 | 2 | 3 };

/** A grant that can read and change mail. Narrower than the app's whole list on purpose: the app's own scope gate decides about the rest. */
export const MAIL_SCOPE = /gmail\.modify|gmail\.send|mail\.google\.com|gmail\.readonly/;

/** Checks 1 to 3: identity, permissions, a renewable credential. The refresh exchange, the mailbox read and the durable store are the server's, because they need the network. */
export function judgeExchange(f: ExchangeFacts): Judgement {
  if (!f.returnedEmail || f.returnedEmail.trim().toLowerCase() !== f.intendedEmail.trim().toLowerCase()) return { ok: false, status: "wrong_account", step: 1 };
  if (!MAIL_SCOPE.test(f.grantedScope)) return { ok: false, status: "scope_missing", step: 2 };
  if (!f.newRefreshToken && !f.storedRefreshUsable) return { ok: false, status: "needs_step", step: 3 };
  return { ok: true };
}

// ---- Words (the app's copy laws: Title Case on titles, one sentence a line, no dash) ----

export interface OutcomeCopy {
  title: string;
  /** One sentence each. */
  lines: string[];
  /** The buttons, in order. Empty when there is nothing to offer. */
  actions: Array<"finish" | "not_now" | "retry" | "permissions">;
}

export function wrongAccountCopy(selected: string, intended: string): OutcomeCopy {
  return {
    title: "That's a Different Google Account",
    lines: [`You selected ${selected}.`, `JARVIS is reconnecting ${intended}.`],
    actions: ["retry", "not_now"],
  };
}

/** `again` is true when the one more step has already been tried once: the loop ends there and the way out is Google's own permissions page. */
export function needsStepCopy(again: boolean): OutcomeCopy {
  return {
    title: "Reconnect Needs One More Step",
    lines: again
      ? ["Google still did not return a way to renew.", "Remove JARVIS in your Google permissions, then reconnect."]
      : ["Google allowed access now.", "JARVIS cannot renew it automatically."],
    actions: again ? ["permissions", "not_now"] : ["finish", "not_now"],
  };
}

export const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

export function scopeMissingCopy(): OutcomeCopy {
  return { title: "Mail Permission Was Not Granted", lines: ["Reconnect and allow JARVIS to read and send mail."], actions: ["retry", "not_now"] };
}
export function unverifiedCopy(): OutcomeCopy {
  return { title: "Couldn't Confirm the Connection", lines: ["Google signed in, but JARVIS could not read the mailbox yet.", "Nothing was changed."], actions: ["retry", "not_now"] };
}
/** Google's own reason, as it gave it. */
export function deniedCopy(reason: string): OutcomeCopy {
  return { title: "Google Did Not Allow It", lines: [`Google said ${reason}.`], actions: ["retry", "not_now"] };
}
export function expiredCopy(): OutcomeCopy {
  return { title: "Reconnect Wasn't Completed", lines: ["That attempt timed out.", "Your drafts are saved."], actions: ["retry", "not_now"] };
}
export function interruptedCopy(): OutcomeCopy {
  return { title: "Reconnect Wasn't Completed", lines: ["Your drafts are saved."], actions: ["retry", "not_now"] };
}
export const CHECKING_LINE = "Checking Your Gmail Connection...";

/** What the person sees for an attempt's outcome, or null when it is silent or needs no words (verified). */
export function copyFor(status: AttemptStatus, o: { selected?: string; intended: string; reason?: string; again?: boolean }): OutcomeCopy | null {
  switch (status) {
    case "wrong_account": return wrongAccountCopy(o.selected ?? "another account", o.intended);
    case "needs_step": return needsStepCopy(o.again === true);
    case "scope_missing": return scopeMissingCopy();
    case "unverified": return unverifiedCopy();
    case "denied": return deniedCopy(o.reason || "no reason was given");
    case "expired": return expiredCopy();
    default: return null;
  }
}

/** Google's refusal reasons arrive as machine strings (access_denied, admin_policy_enforced); these are the ones a person can make sense of. */
export function providerReason(raw: string): string {
  const r = raw.toLowerCase();
  if (r === "access_denied") return "access was denied";
  if (r === "admin_policy_enforced") return "your administrator blocks this app";
  if (r === "org_internal") return "this app is limited to another organization";
  if (r === "disallowed_useragent") return "this browser is not allowed";
  return raw.replace(/_/g, " ").slice(0, 80);
}

// ---- What the client throws -----------------------------------------------------

/** The person closed Google's window, or backed out on the consent screen. Silent: never an alarm, never an error line. */
export class ReconnectCancelled extends Error {
  constructor() { super("Sign-in cancelled"); this.name = "ReconnectCancelled"; }
}

/** Google refused the flow and said why (an admin policy, a blocked app...). Reported with the provider's reason. */
export class ReconnectDenied extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(deniedCopy(providerReason(reason)).lines.join(" "));
    this.name = "ReconnectDenied";
    this.reason = reason;
  }
}

/** The server ran the checks and one of them did not pass. Carries the words, so every screen says the same thing. */
export class ReconnectOutcomeError extends Error {
  readonly status: AttemptStatus;
  readonly intended: string;
  readonly selected?: string;
  readonly retryable: boolean;
  constructor(status: AttemptStatus, intended: string, o: { selected?: string; retryable?: boolean } = {}) {
    const c = copyFor(status, { intended, ...(o.selected ? { selected: o.selected } : {}) });
    super(c ? [c.title, ...c.lines].join(" · ") : "Reconnect did not complete");
    this.name = "ReconnectOutcomeError";
    this.status = status;
    this.intended = intended;
    if (o.selected) this.selected = o.selected;
    this.retryable = o.retryable === true;
  }
}

/** A device-side note that a reconnect left for Google and has not come back, so a killed app can say so honestly on reopen. */
export const PENDING_KEY = "jarvis.reconnect.pending.v1";
export const PENDING_MAX_AGE_MS = STATE_TTL_MS + 5 * 60e3;
export interface PendingReconnect { email: string; startedAt: number }

export function readPending(nowMs: number = Date.now()): PendingReconnect | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingReconnect;
    if (typeof p.email !== "string" || typeof p.startedAt !== "number" || nowMs - p.startedAt > PENDING_MAX_AGE_MS) { localStorage.removeItem(PENDING_KEY); return null; }
    return p;
  } catch { return null; }
}
export function writePending(email: string, nowMs: number = Date.now()): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ email: email.trim().toLowerCase(), startedAt: nowMs } satisfies PendingReconnect)); } catch { /* the server still has the attempt */ }
}
export function clearPending(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
}
