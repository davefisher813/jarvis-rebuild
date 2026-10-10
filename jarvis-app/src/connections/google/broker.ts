import { apiUrl } from "../../shared/apiBase";
import { preloadGoogleSignIn, startGoogleCode, type TokenOpts } from "./gis";
import { nativeGoogleAvailable, requestGoogleCodeNative } from "./nativeAuth";
import { ReconnectCancelled, ReconnectDenied, ReconnectOutcomeError, SignInBlocked, clearPending, writePending, type AttemptStatus } from "./reconnect";

// The token broker (persistent sign-in, 2026-08-04): how the session gets
// Google access tokens.
//   authorize: interactive (popup), used the FIRST time an account connects
//              or when a stored sign-in has been revoked.
//   silent:    no user interaction, the server mints a fresh access token
//              from the stored refresh token. This is "stays signed in".
//   forget:    drop the stored sign-in (disconnect).
// The server does the exchange because refresh tokens must never reach the
// client; see api/google.ts.

// WHY SILENT NO LONGER RETURNS A TOKEN OR NULL (2026-09-29). It answered
// `string | null`, so a revoked grant, a dead network, an expired JARVIS
// sign-in and a database blip were all the same null, and every caller
// reacted to null the one way it knew: open Google's chooser. A person on a
// train tapping Delete got asked to sign in to Google again for a problem
// signing in cannot fix. The result now says what happened. The codes are
// the server's (api/_google.ts, googleFailure) plus the ones only the client
// can know; the test in broker.test.ts holds the two lists together.

export const SERVER_CODES = [
  "GOOGLE_NO_STORED_SIGNIN",
  "GOOGLE_STORED_SIGNIN_UNREADABLE",
  "GOOGLE_SIGNIN_REVOKED",
  "GOOGLE_REFRESH_UNAVAILABLE",
  "GOOGLE_NETWORK_ERROR",
  "GOOGLE_AUTH_EXPIRED",
  "GOOGLE_STORAGE_FAILURE",
] as const;

/** Causes only the session can know: a token that would be refused for what
 *  it cannot do, or an account that is not the one asked for. */
export const SESSION_CODES = [
  "GOOGLE_MISSING_SCOPE",
  "GOOGLE_UNKNOWN_ACCOUNT",
  "GOOGLE_MAIL_DISABLED",
  "GOOGLE_ACCOUNT_MISMATCH",
  "GOOGLE_UNAVAILABLE",
] as const;

export type GoogleFailureCode = (typeof SERVER_CODES)[number] | (typeof SESSION_CODES)[number];

export interface GoogleFailure {
  code: GoogleFailureCode;
  /** Plain words a person can act on, safe to show as they are. */
  message: string;
  /** True when trying the same thing again may work (network, Google, storage). */
  retryable: boolean;
  /** The HTTP status behind it, 0 when nothing answered. */
  status: number;
}

export type GoogleSessionResult =
  | {
      ok: true;
      token: string;
      email: string;
      /** Epoch ms after which the token is no good. */
      expiresAt: number;
      /** True only when the server confirmed a stored sign-in that outlives this token. */
      remembered: boolean;
      /** The scopes Google says the token carries, when it said. */
      scope?: string;
      status: number;
    }
  | ({ ok: false } & GoogleFailure);

export interface AuthorizeResult {
  token: string;
  email?: string;
  /** Absent on test brokers: the session assumes an hour. */
  expiresAt?: number;
  /** Absent means not remembered: nothing has confirmed a stored sign-in. */
  remembered?: boolean;
  scope?: string;
  /** Why it is not remembered, when the server said. */
  warning?: GoogleFailure;
}

/** An interactive sign-in made ready before the tap: launch() opens Google synchronously, inside the tap, and resolves with the
 *  exchange's result. Single use (the server's state is single use); stale after expiresAt (the state lives ten minutes). */
export interface PreparedAuthorize {
  launch: () => Promise<AuthorizeResult>;
  expiresAt: number;
}

/** How long a prepared sign-in is used before it is prepared again: inside the server state's ten minutes, with room for the tap. */
export const PREPARED_FOR_MS = 8 * 60e3;

export interface TokenBroker {
  authorize: (opts: TokenOpts) => Promise<AuthorizeResult>;
  /** Everything an interactive sign-in needs before Google's window opens (the server's attempt, the script). Optional: a broker without it is authorized directly. */
  prepare?: (opts: TokenOpts) => Promise<PreparedAuthorize>;
  silent?: (email: string) => Promise<GoogleSessionResult>;
  forget?: (email: string) => Promise<void>;
}

/** A failure that has to travel as an exception (an interactive step that
 *  cannot continue). Carries the same facts as the result does. */
export class GoogleSessionError extends Error {
  readonly code: GoogleFailureCode;
  readonly retryable: boolean;
  readonly status: number;
  constructor(f: GoogleFailure) {
    super(f.message);
    this.name = "GoogleSessionError";
    this.code = f.code;
    this.retryable = f.retryable;
    this.status = f.status;
  }
}

/** Only these failures are answered by asking Google again. Everything else
 *  (network, Google down, storage, an expired JARVIS sign-in) is not fixed by
 *  a chooser, and the chooser must not appear for it. */
export function interactiveHelps(code: GoogleFailureCode): boolean {
  return code === "GOOGLE_NO_STORED_SIGNIN"
    || code === "GOOGLE_STORED_SIGNIN_UNREADABLE"
    || code === "GOOGLE_SIGNIN_REVOKED"
    || code === "GOOGLE_MISSING_SCOPE";
}

const RETRYABLE = new Set<GoogleFailureCode>([
  "GOOGLE_REFRESH_UNAVAILABLE", "GOOGLE_NETWORK_ERROR", "GOOGLE_STORAGE_FAILURE", "GOOGLE_UNAVAILABLE",
]);

// The client's copy of the wording, for a response that carries a code and no
// message (a proxy's error page, an older server). The server's own message
// wins whenever it sends one. The two-part wording is Dave's handoff text;
// each half is a sentence of its own.
const who = (email: string): string => email || "this account";
const twoSentences = (a: string, b: string): string => a + " " + b;
const FALLBACK: Record<GoogleFailureCode, (email: string) => string> = {
  GOOGLE_NO_STORED_SIGNIN: (e) => twoSentences("Google isn't set to stay signed in.", "Reconnect " + who(e) + "."),
  GOOGLE_STORED_SIGNIN_UNREADABLE: (e) => twoSentences("The saved Google sign-in couldn't be opened.", "Reconnect " + who(e) + "."),
  GOOGLE_SIGNIN_REVOKED: (e) => twoSentences("Google revoked this sign-in.", "Reconnect " + who(e) + "."),
  GOOGLE_REFRESH_UNAVAILABLE: () => twoSentences("Google couldn't refresh right now.", "Try again."),
  GOOGLE_NETWORK_ERROR: () => twoSentences("Couldn't reach Google.", "Check your connection and try again."),
  GOOGLE_AUTH_EXPIRED: () => twoSentences("Your JARVIS sign-in expired.", "Sign in again."),
  GOOGLE_STORAGE_FAILURE: () => twoSentences("JARVIS couldn't reach its saved sign-ins.", "Try again."),
  GOOGLE_MISSING_SCOPE: (e) => "Reconnect " + who(e) + " to allow changes to mail",
  GOOGLE_UNKNOWN_ACCOUNT: (e) => who(e) + " isn't connected",
  GOOGLE_MAIL_DISABLED: (e) => "Mail is turned off for " + who(e),
  GOOGLE_ACCOUNT_MISMATCH: (e) => "That sign-in isn't " + who(e) + "; reconnect it",
  GOOGLE_UNAVAILABLE: () => "Google isn't responding; try again",
};

const KNOWN = new Set<string>([...SERVER_CODES, ...SESSION_CODES]);
export const isGoogleCode = (c: unknown): c is GoogleFailureCode => typeof c === "string" && KNOWN.has(c);

/** A failure, with the message worded for this account. */
export function googleFailure(code: GoogleFailureCode, email = "", status = 0, message?: string): GoogleFailure {
  return { code, message: message || FALLBACK[code](email), retryable: RETRYABLE.has(code), status };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

interface ServerAnswer {
  accessToken?: string;
  email?: string;
  expiresIn?: number;
  remembered?: boolean;
  scope?: string;
  code?: string;
  message?: string;
  error?: string;
  /** A reconnect's start (state, loginHint) and its outcome (Spec 4). */
  state?: string;
  loginHint?: string;
  reconnect?: { status: AttemptStatus; intended?: string; selected?: string };
  retryable?: boolean;
  status: number;
}

export function serverBroker(getAuthToken: () => string | undefined, doFetch: FetchLike = fetch, now: () => number = Date.now): TokenBroker {
  // Either the server answered (whatever it said) or the call never got one.
  type Reply = { answer: ServerAnswer } | { local: GoogleFailure };
  const call = async (body: Record<string, unknown>): Promise<Reply> => {
    const auth = getAuthToken();
    // No JARVIS session to send: the server would say the same thing, so
    // say it without the round trip.
    if (!auth) return { local: googleFailure("GOOGLE_AUTH_EXPIRED", "", 401) };
    try {
      const r = await doFetch(apiUrl("/api/google"), {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + auth },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as Omit<ServerAnswer, "status">;
      return { answer: { ...j, status: r.status } };
    } catch {
      return { local: googleFailure("GOOGLE_NETWORK_ERROR", "", 0) };
    }
  };

  // What a response that did not carry a token means. The server's code wins;
  // without one the status decides, and nothing is guessed beyond that.
  const failureOf = (a: ServerAnswer, email: string): GoogleFailure => {
    if (isGoogleCode(a.code)) return googleFailure(a.code, email, a.status, a.message);
    if (a.status === 401) return googleFailure("GOOGLE_AUTH_EXPIRED", email, a.status);
    return googleFailure("GOOGLE_REFRESH_UNAVAILABLE", email, a.status);
  };

  // The half of an interactive sign-in after Google answers: the server is told of a cancel or a refusal, the code is exchanged,
  // and the server's checks decide. Shared by every launch.
  const finish = async (o: TokenOpts, opts: TokenOpts, native: boolean, code: Promise<{ code: string; verifier: string; redirectUri: string }>): Promise<AuthorizeResult> => {
    let sent: { code: string; verifier: string; redirectUri: string };
    try {
      sent = await code;
    } catch (e) {
      // The window closed (silent) or Google refused (with its reason): the server is told, the device forgets it left.
      if (o.state && (e instanceof ReconnectCancelled || e instanceof ReconnectDenied)) {
        clearPending();
        await call({ reconnectReport: { state: o.state, outcome: e instanceof ReconnectDenied ? "denied" : "cancelled", ...(e instanceof ReconnectDenied ? { reason: e.reason } : {}) } });
      }
      // The browser refused the window: nothing left this device, so nothing is pending.
      if (e instanceof SignInBlocked) clearPending();
      throw e;
    }
    const reply = await call({ code: sent.code, ...(native ? { verifier: sent.verifier, redirectUri: sent.redirectUri } : {}), ...(o.state ? { state: o.state } : {}) });
    if ("local" in reply) throw new GoogleSessionError(reply.local);
    const res = reply.answer;
    if (o.state && !res.accessToken) {
      // The server ran the checks and one did not pass: the same words on every screen, and nothing was stored.
      clearPending();
      if (res.reconnect?.status) throw new ReconnectOutcomeError(res.reconnect.status, res.reconnect.intended ?? opts.reconnect ?? "", { ...(res.reconnect.selected ? { selected: res.reconnect.selected } : {}), retryable: res.retryable === true });
    }
    if (!res.accessToken) {
      // A coded refusal (network, storage, an expired JARVIS sign-in)
      // keeps its code; the exchange's own errors keep their old wording.
      if (isGoogleCode(res.code)) throw new GoogleSessionError(failureOf(res, res.email ?? ""));
      throw new Error(res.error || "Google sign-in failed");
    }
    if (o.state) clearPending();
    const warning = res.remembered !== true && isGoogleCode(res.code) ? googleFailure(res.code, res.email ?? "", res.status, res.message) : undefined;
    return {
      token: res.accessToken,
      email: res.email,
      expiresAt: now() + (res.expiresIn ?? 3600) * 1000,
      // Durable only when the server says it stored one. A response with
      // no field at all is an older server and is not taken on trust.
      remembered: res.remembered === true,
      ...(res.scope ? { scope: res.scope } : {}),
      ...(warning ? { warning } : {}),
    };
  };

  return {
    // UP-LAUNCH-12 (2026-09-05): the same exchange, two ways of getting the
    // code. The web keeps the GIS popup; the phone opens the system sign-in
    // sheet with PKCE, because a popup code client posts back to the page's
    // origin and in the App Store build that origin is capacitor://localhost,
    // which Google will not accept. The server half is identical apart from
    // the verifier, which is what proves the exchange belongs to this sheet.
    async authorize(opts) {
      // Prepared and launched at once: for a caller with no tap to protect (tests, a retry from code). Tap paths prepare ahead.
      return (await this.prepare!(opts)).launch();
    },

    // ONE-TAP RECONNECT (Spec 4): the server mints the attempt and its signed state BEFORE the person leaves for Google. The
    // attempt is the server's: this device only remembers that it left, so a killed app can say so honestly when it reopens.
    // PREPARED AHEAD (2026-10-10, the reconnect that did nothing): all of that happens here, before the tap, so launch() can open
    // Google's window inside the tap. Awaiting the server first spent the tap's permission to open a window and Safari refused it.
    async prepare(opts) {
      let o = opts;
      if (opts.reconnect) {
        const st = await call({ reconnectStart: opts.reconnect });
        if ("local" in st) throw new GoogleSessionError(st.local);
        if (!st.answer.state) throw new GoogleSessionError(failureOf(st.answer, opts.reconnect));
        o = { ...opts, state: st.answer.state, loginHint: st.answer.loginHint ?? opts.reconnect };
      }
      const native = nativeGoogleAvailable();
      if (!native) await preloadGoogleSignIn();
      const ready = o;
      return {
        expiresAt: now() + PREPARED_FOR_MS,
        launch: () => {
          if (ready.reconnect) writePending(ready.reconnect);
          // Synchronous up to the window: startGoogleCode calls Google inside this call stack, which is the tap's.
          const code = native ? requestGoogleCodeNative(ready) : startGoogleCode(ready).then((c) => ({ code: c, verifier: "", redirectUri: "" }));
          return finish(ready, opts, native, code);
        },
      };
    },
    async silent(email) {
      const reply = await call({ refresh: email });
      if ("local" in reply) return { ok: false, ...googleFailure(reply.local.code, email, reply.local.status) };
      const res = reply.answer;
      if (!res.accessToken) return { ok: false, ...failureOf(res, email) };
      return {
        ok: true,
        token: res.accessToken,
        email: res.email || email,
        expiresAt: now() + (res.expiresIn ?? 3600) * 1000,
        remembered: res.remembered !== false,
        ...(res.scope ? { scope: res.scope } : {}),
        status: res.status,
      };
    },
    async forget(email) {
      await call({ forget: email });
    },
  };
}
