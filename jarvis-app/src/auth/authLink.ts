import { Capacitor } from "@capacitor/core";
import { onAppUrl } from "../native/appUrl";
import { webOrigin } from "../shared/apiBase";

// WHERE AN EMAIL LINK LANDS (UP-LAUNCH-11, 2026-09-05), fork option B.
//
// The magic link is the way in now, and passwords are the legacy path. That
// only works if the link can actually reach the app. On the web it always
// could: the Supabase client's detectSessionInUrl reads the address bar on
// boot. On the phone it could not, and the failure was silent in the worst
// way: the link opens Safari, Safari signs ITSELF in, and the app the person
// came from is still signed out. SHELL-F-04 fixed the half of that where a
// recovery link had nowhere to type a new password; this is the other half.
//
// So: the emails point at jarvis://auth on the phone, iOS hands that URL to
// the app, and the token in it is redeemed by the client that is actually
// running.
//
// Supabase sends one of two shapes, and both are handled because which one
// arrives depends on a project setting nobody remembers changing:
//   ?code=...                    the PKCE flow, redeemed with exchangeCodeForSession
//   ?token_hash=...&type=...     the older link, redeemed with verifyOtp
// Anything with an `error` is Supabase saying no, usually an expired link,
// and that has to reach the person rather than being dropped.

export const NATIVE_AUTH_REDIRECT = "jarvis://auth";

/**
 * Where Supabase should point the link. On the phone that is the app's own
 * scheme; on the web it is wherever the app is served from, which webOrigin
 * already works out for the native build's API calls. Undefined means "use
 * the project's Site URL", which is the right answer only for a local dev
 * build with no origin of its own.
 */
export function authRedirectTo(): string | undefined {
  if (Capacitor.isNativePlatform()) return NATIVE_AUTH_REDIRECT;
  const origin = webOrigin();
  return origin || undefined;
}

export type AuthLink =
  | { kind: "code"; code: string }
  | { kind: "otp"; tokenHash: string; type: string }
  | { kind: "error"; message: string };

/**
 * What an incoming URL is, if it is an auth link at all. Reads the query and
 * the hash both: the implicit flow puts everything after a #, and a URL's
 * hash is not part of its searchParams.
 */
export function parseAuthLink(url: URL): AuthLink | null {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const get = (k: string) => url.searchParams.get(k) ?? hash.get(k);

  const error = get("error_description") || get("error");
  if (error) return { kind: "error", message: humanAuthError(error) };

  const tokenHash = get("token_hash");
  const type = get("type");
  if (tokenHash && type) return { kind: "otp", tokenHash, type };

  const code = get("code");
  if (code) return { kind: "code", code };

  return null;
}

/** Supabase's own words, made into a sentence a person can act on. */
export function humanAuthError(raw: string): string {
  const s = decodeURIComponent(raw).replace(/\+/g, " ");
  if (/expired/i.test(s)) return "That link has expired · Ask for a new one";
  if (/already|used/i.test(s)) return "That link has been used already · Ask for a new one";
  return s;
}

// The narrow slice of the Supabase client this needs, so the handler can be
// tested without one.
export interface AuthClient {
  auth: {
    exchangeCodeForSession(code: string): Promise<{ error: { message: string } | null }>;
    verifyOtp(params: { token_hash: string; type: string }): Promise<{ error: { message: string } | null }>;
  };
}

export type LinkOutcome = { ok: true } | { ok: false; message: string };

/**
 * Redeem one link. Returns null when the URL was not an auth link at all, so
 * the caller can pass it on to whatever else is listening.
 */
export async function redeemAuthLink(url: URL, client: AuthClient): Promise<LinkOutcome | null> {
  const link = parseAuthLink(url);
  if (!link) return null;
  if (link.kind === "error") return { ok: false, message: link.message };
  try {
    const res = link.kind === "code"
      ? await client.auth.exchangeCodeForSession(link.code)
      : await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    if (res.error) return { ok: false, message: humanAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? humanAuthError(e.message) : "Couldn't finish signing in" };
  }
}

/**
 * Listen for auth links on the app URL bus. Returns the unsubscribe.
 * onFailure is how an expired link reaches a person: without it the tap does
 * nothing at all, which is the failure this item exists to end.
 */
export function startAuthLinks(client: AuthClient, onFailure: (message: string) => void = () => {}): () => void {
  return onAppUrl(async (url) => {
    const out = await redeemAuthLink(url, client);
    if (!out) return false;
    if (!out.ok) onFailure(out.message);
    return true;
  });
}
