import { GOOGLE_SCOPES, googleClientId } from "./config";
import { ReconnectCancelled, ReconnectDenied, SIGN_IN_TIMEOUT_MS, SignInBlocked, SignInTimedOut } from "./reconnect";

// Loads Google Identity Services and runs the OAuth token flow (PKCE, no client
// secret). Browser-only; needs a configured client id and an authorized origin.
// This is the one piece that requires a live Google project to exercise.
interface TokenClient { requestAccessToken: () => void }
interface CodeClient { requestCode: () => void }
interface GoogleGlobal {
  accounts?: { oauth2?: {
    initTokenClient: (c: {
      client_id: string;
      scope: string;
      login_hint?: string;
      prompt?: string;
      callback: (r: { access_token?: string; error?: string }) => void;
    }) => TokenClient;
    initCodeClient: (c: {
      client_id: string;
      scope: string;
      ux_mode: "popup";
      login_hint?: string;
      prompt?: string;
      state?: string;
      callback: (r: { code?: string; error?: string; state?: string }) => void;
      // Google calls this instead of `callback` when the popup never got as far
      // as an answer: closed by the person, or blocked by the browser.
      error_callback?: (e: { type?: string }) => void;
    }) => CodeClient;
  } };
}
function gwin(): { google?: GoogleGlobal } {
  return window as unknown as { google?: GoogleGlobal };
}

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gwin().google?.accounts?.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
  return loading;
}

// Multi-account (2026-08-04): loginHint re-authorizes a KNOWN account without
// the chooser; selectAccount forces the chooser so a NEW account can be added.
//
// Spec 4 (one-tap reconnect): `reconnect` names the account being reconnected and turns on the guarded flow (the broker asks the
// server for a signed, ten-minute `state` first); `state` is that value, carried to Google and checked when it comes back.
export interface TokenOpts { loginHint?: string; selectAccount?: boolean; reconnect?: string; state?: string }

// Persistent sign-in (2026-08-04): the CODE flow. The popup returns a one-time
// code the server exchanges for tokens, including the refresh token that keeps
// the account signed in. prompt=consent on add guarantees Google re-issues a
// refresh token even for an account that authorized before.
export async function requestGoogleCode(opts: TokenOpts = {}): Promise<string> {
  await preloadGoogleSignIn();
  return startGoogleCode(opts);
}

/** Loads Google's sign-in script ahead of the tap, so the tap itself can open the window. */
export async function preloadGoogleSignIn(): Promise<void> {
  if (!googleClientId()) throw new Error("Google is not set up yet");
  await loadGis();
}

/** True once the script is loaded and startGoogleCode can open the window without waiting. */
export function googleSignInReady(): boolean {
  return !!gwin().google?.accounts?.oauth2?.initCodeClient;
}

// THE WINDOW OPENS INSIDE THE TAP (2026-10-10, the reconnect that did nothing). A browser lets a page open a window only while
// it is still handling the person's tap; Safari is strictest. Anything awaited first (a token refresh, the server's reconnect
// attempt, loading this script) spends that permission, and the window is refused, often without a word. So this starts the
// request SYNCHRONOUSLY: the Promise executor runs inside the caller's stack, so requestCode is called in the same tap.
// Callers prepare everything else first (preloadGoogleSignIn, the broker's prepare). It also never hangs: a window that never
// answers releases the tap after SIGN_IN_TIMEOUT_MS, and a window the browser refused says so.
export function startGoogleCode(opts: TokenOpts = {}, timeoutMs: number = SIGN_IN_TIMEOUT_MS): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) return Promise.reject(new Error("Google is not set up yet"));
  const oauth2 = gwin().google?.accounts?.oauth2;
  if (!oauth2?.initCodeClient) return Promise.reject(new Error("Google sign-in unavailable"));
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const done = (f: () => void) => { if (settled) return; settled = true; clearTimeout(timer); f(); };
    const timer = setTimeout(() => done(() => reject(new SignInTimedOut())), timeoutMs);
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      ux_mode: "popup",
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
      prompt: opts.selectAccount ? "select_account consent" : "consent",
      ...(opts.state ? { state: opts.state } : {}),
      callback: (r) => done(() => {
        // Spec 4: the state Google hands back must be the one the server minted for this attempt.
        if (opts.state && r.state !== opts.state) return reject(new Error("That sign-in did not match this one"));
        if (r.code) return resolve(r.code);
        // Google refused the flow: a reconnect reports it in Google's own words, and a backing out is a cancel, not an error.
        if (opts.reconnect && r.error) return reject(r.error === "access_denied" ? new ReconnectCancelled() : new ReconnectDenied(r.error));
        reject(new Error(r.error || "No authorization code"));
      }),
      // popup_closed: the person closed the window (silent); popup_failed_to_open: the browser refused it (said, with the fix).
      error_callback: (e) => done(() => reject(
        e?.type === "popup_closed" ? new ReconnectCancelled()
          : e?.type === "popup_failed_to_open" ? new SignInBlocked()
            : new Error("Could not open Google sign-in"))),
    });
    try {
      client.requestCode();
    } catch {
      done(() => reject(new SignInBlocked()));
    }
  });
}

export async function requestGoogleToken(opts: TokenOpts = {}): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google is not set up yet");
  await loadGis();
  const oauth2 = gwin().google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google sign-in unavailable");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
      ...(opts.selectAccount ? { prompt: "select_account" } : {}),
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error || "No access token"))),
    });
    client.requestAccessToken();
  });
}
