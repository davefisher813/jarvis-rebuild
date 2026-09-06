import { Capacitor, registerPlugin } from "@capacitor/core";

// SIGN IN WITH APPLE, ON THE PHONE (UP-LAUNCH-10, 2026-09-05).
//
// SHELL-F-18 put the button on the Sign In screen and wired it to
// AuthProvider's signInWithApple, which is signInWithOAuth({provider:"apple"}):
// the WEB redirect. On the web that is correct and complete. On the phone it
// is wrong twice over: it bounces the person out to Safari for a sign-in iOS
// can do in a sheet with Face ID, and the redirect has to come back to an
// origin that in the App Store build is capacitor://localhost.
//
// The native flow is Apple's own sheet. It returns an identity token, which
// Supabase accepts directly through signInWithIdToken, so there is no
// redirect and no browser at all.
//
// THE NONCE, which is the part that is easy to get wrong: Apple is given the
// SHA-256 HASH of a random string, and Supabase is given the RAW string.
// Supabase hashes what it is given and compares. Send the same value to both
// and every sign-in fails with a nonce mismatch, which is a confusing enough
// error that it is worth this paragraph.
//
// The plugin is bound BY NAME (registerPlugin), the same way shared/badge.ts
// binds Badge and nativeAuth.ts binds Browser: this module compiles and tests
// on a checkout with no pod, and a call before `npm i
// @capacitor-community/apple-sign-in` rejects into an honest message.

export interface AppleAuthResponse {
  identityToken: string;
  authorizationCode?: string;
  /** Apple sends the name ONCE, on the very first authorization, and never
      again. Whatever is not captured here is gone for good. */
  givenName?: string;
  familyName?: string;
  /** The real address, or a privaterelay.appleid.com alias under Hide My Email. */
  email?: string;
  user?: string;
}

interface ApplePlugin {
  authorize(options: { clientId?: string; redirectURI?: string; scopes?: string; state?: string; nonce?: string }):
    Promise<{ response: AppleAuthResponse }>;
}

export function appleNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A raw nonce: url-safe, long enough to be one, new every time. */
export function rawNonce(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** What Apple is given: the SHA-256 of the raw nonce, hex. */
export async function hashedNonce(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return hex(new Uint8Array(digest));
}

/** Apple's relay address, which is a real inbox but not the person's own. */
export function isPrivateRelay(email: string | undefined): boolean {
  return !!email && email.toLowerCase().endsWith("@privaterelay.appleid.com");
}

/** "Alex Fisher" from the two parts Apple sends once, or empty. */
export function fullName(r: Pick<AppleAuthResponse, "givenName" | "familyName">): string {
  return [r.givenName, r.familyName].filter((s) => !!s && s.trim()).join(" ").trim();
}

export interface AppleSignInDeps {
  authorize?: ApplePlugin["authorize"];
  makeNonce?: () => string;
}

export interface AppleSignInResult {
  identityToken: string;
  /** The RAW nonce, which is what Supabase must be given. */
  nonce: string;
  name: string;
  email?: string;
}

/**
 * Run Apple's sheet and hand back what Supabase needs. Throws with something
 * a person can read: a cancelled sheet is not an error worth a stack trace,
 * and a missing pod is a build problem, not a sign-in problem.
 */
export async function signInWithAppleNative(deps: AppleSignInDeps = {}): Promise<AppleSignInResult> {
  const plugin = registerPlugin<ApplePlugin>("SignInWithApple");
  const authorize = deps.authorize ?? plugin.authorize.bind(plugin);
  const raw = (deps.makeNonce ?? rawNonce)();
  const nonce = await hashedNonce(raw);
  let res: { response: AppleAuthResponse };
  try {
    res = await authorize({ scopes: "name email", nonce });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // The plugin surfaces Apple's own cancellation as an error. It is a
    // choice the person made, so it reads like one.
    if (/cancel/i.test(msg)) throw new Error("Sign-in cancelled");
    throw new Error("Couldn't reach Apple · Try again");
  }
  const r = res?.response;
  if (!r?.identityToken) throw new Error("Apple did not return a sign-in token");
  return { identityToken: r.identityToken, nonce: raw, name: fullName(r), ...(r.email ? { email: r.email } : {}) };
}
