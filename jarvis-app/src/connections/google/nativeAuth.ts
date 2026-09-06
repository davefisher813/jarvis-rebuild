import { Capacitor, registerPlugin } from "@capacitor/core";
import { GOOGLE_SCOPES } from "./config";
import { onAppUrl } from "../../native/appUrl";
import type { TokenOpts } from "./gis";

// CONNECT GOOGLE FROM INSIDE THE APP (UP-LAUNCH-12, 2026-09-05), fork A.
//
// The web flow is Google Identity Services in a popup (gis.ts), and a popup
// code client posts its result back to the page's ORIGIN. In the App Store
// build that origin is capacitor://localhost, which Google's OAuth client
// will not accept as an authorized JavaScript origin and never will. So on
// the phone a tester taps Connect Google and nothing usable happens: not a
// bug in the popup, a flow that cannot exist there.
//
// The native flow is the one Google documents for installed apps: an iOS
// OAuth client (no secret), the authorization URL opened in the system's own
// browser sheet, PKCE instead of a client secret, and the code coming back on
// a custom scheme the app owns. Everything up to the code is here; the
// exchange is the same server endpoint the web already posts to, so refresh
// tokens still never touch the client.
//
// The Browser plugin is bound BY NAME, the way shared/badge.ts binds Badge:
// before `npm i @capacitor/browser` and `npx cap sync ios` the call rejects
// and connectNatively reports it, which is better than a build that will not
// compile on a checkout without the pod.

export function iosClientId(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_IOS_CLIENT_ID || "";
  } catch {
    return "";
  }
}

/**
 * Google's iOS clients redirect to their own id, reversed:
 * 123-abc.apps.googleusercontent.com becomes
 * com.googleusercontent.apps.123-abc. This string is also the URL scheme the
 * app has to declare in Info.plist, and getting it wrong is the whole failure
 * mode of this flow, so it is computed rather than typed twice.
 */
export function reverseClientId(clientId: string): string {
  const id = clientId.trim();
  const suffix = ".apps.googleusercontent.com";
  if (!id.endsWith(suffix)) return "";
  return "com.googleusercontent.apps." + id.slice(0, -suffix.length);
}

export function nativeRedirectUri(clientId: string): string {
  const scheme = reverseClientId(clientId);
  return scheme ? scheme + ":/oauth2redirect" : "";
}

// --- PKCE ---
//
// The proof that the app asking for the token is the app that asked for the
// code. It replaces the client secret, which an installed app cannot keep.

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafe(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, length);
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export interface AuthUrlOpts {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  loginHint?: string;
  selectAccount?: boolean;
}

export function buildAuthUrl(o: AuthUrlOpts): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    state: o.state,
    // Same two rules the web client follows: consent guarantees a refresh
    // token even for an account that authorized before, and select_account
    // forces the chooser when a NEW account is being added.
    prompt: o.selectAccount ? "select_account consent" : "consent",
    access_type: "offline",
    include_granted_scopes: "true",
  });
  if (o.loginHint) p.set("login_hint", o.loginHint);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

/**
 * The callback URL, checked. A `state` that does not match the one this app
 * generated means the URL did not come from the sign-in this app started, and
 * the only safe answer to that is to ignore it: an attacker who can open a
 * URL on the phone could otherwise hand the app their own authorization code
 * and end up with their account connected to somebody else's JARVIS.
 */
export function parseAuthCallback(url: URL, expectedState: string): { code: string } | { error: string } | null {
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) return null;
  const state = url.searchParams.get("state") || "";
  if (!expectedState || state !== expectedState) return { error: "That sign-in did not match this one" };
  const err = url.searchParams.get("error");
  if (err) return { error: err === "access_denied" ? "Sign-in cancelled" : err };
  const code = url.searchParams.get("code") || "";
  return code ? { code } : { error: "No authorization code" };
}

interface BrowserPlugin {
  open(options: { url: string; presentationStyle?: "popover" | "fullscreen" }): Promise<void>;
  close(): Promise<void>;
}

export function nativeGoogleAvailable(clientId: string = iosClientId()): boolean {
  return Capacitor.isNativePlatform() && !!nativeRedirectUri(clientId);
}

export interface NativeCodeDeps {
  /** The iOS OAuth client. Passed rather than read in tests, the same way
      config.ts's googleConfigured takes the web one. */
  clientId?: string;
  open?: (url: string) => Promise<void>;
  close?: () => Promise<void>;
  subscribe?: typeof onAppUrl;
  /** Milliseconds before an unanswered sheet gives up. */
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/**
 * The whole native first-connect: open the sheet, wait for the callback,
 * return the one-time code plus the verifier the server needs to prove it.
 * Rejects with something a person can read, never with a bare code.
 */
export async function requestGoogleCodeNative(
  opts: TokenOpts = {},
  deps: NativeCodeDeps = {},
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const clientId = deps.clientId ?? iosClientId();
  const redirectUri = nativeRedirectUri(clientId);
  if (!redirectUri) throw new Error("Google is not set up for this app yet");

  const verifier = randomUrlSafe();
  const state = randomUrlSafe(32);
  const challenge = await challengeOf(verifier);
  const url = buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint: opts.loginHint, selectAccount: opts.selectAccount });

  const Browser = registerPlugin<BrowserPlugin>("Browser");
  const open = deps.open ?? ((u: string) => Browser.open({ url: u }));
  const close = deps.close ?? (() => Browser.close().catch(() => { /* already gone */ }));
  const subscribe = deps.subscribe ?? onAppUrl;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));

  return new Promise<{ code: string; verifier: string; redirectUri: string }>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimer(timer);
      unsubscribe();
      void close();
      fn();
    };
    const unsubscribe = subscribe((incoming) => {
      const r = parseAuthCallback(incoming, state);
      if (!r) return false; // not ours: some other deep link
      if ("code" in r) finish(() => resolve({ code: r.code, verifier, redirectUri }));
      else finish(() => reject(new Error(r.error)));
      return true;
    });
    // A sheet the person swipes away sends nothing at all. Without this the
    // promise never settles and Connect Google spins forever.
    const timer = setTimer(() => finish(() => reject(new Error("Sign-in timed out"))), deps.timeoutMs ?? 300_000);
    open(url).catch(() => finish(() => reject(new Error("Could not open Google sign-in"))));
  });
}
