import { GOOGLE_SCOPES, googleClientId } from "./config";

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
      callback: (r: { code?: string; error?: string }) => void;
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
export interface TokenOpts { loginHint?: string; selectAccount?: boolean }

// Persistent sign-in (2026-08-04): the CODE flow. The popup returns a one-time
// code the server exchanges for tokens, including the refresh token that keeps
// the account signed in. prompt=consent on add guarantees Google re-issues a
// refresh token even for an account that authorized before.
export async function requestGoogleCode(opts: TokenOpts = {}): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google is not set up yet");
  await loadGis();
  const oauth2 = gwin().google?.accounts?.oauth2;
  if (!oauth2?.initCodeClient) throw new Error("Google sign-in unavailable");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      ux_mode: "popup",
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
      prompt: opts.selectAccount ? "select_account consent" : "consent",
      callback: (r) => (r.code ? resolve(r.code) : reject(new Error(r.error || "No authorization code"))),
    });
    client.requestCode();
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
