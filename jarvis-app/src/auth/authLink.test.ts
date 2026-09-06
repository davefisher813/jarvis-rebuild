import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseAuthLink, redeemAuthLink, humanAuthError, startAuthLinks, NATIVE_AUTH_REDIRECT, type AuthClient } from "./authLink";
import { deliverAppUrl, resetAppUrlForTest } from "../native/appUrl";

// UP-LAUNCH-11 (2026-09-05). The link is the way in now, so the link landing
// is not a nicety. On the phone it used to open Safari, Safari signed ITSELF
// in, and the app the person came from stayed signed out with nothing to say.

beforeEach(() => { resetAppUrlForTest(); });

const client = (over: Partial<AuthClient["auth"]> = {}): AuthClient => ({
  auth: {
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
    ...over,
  } as AuthClient["auth"],
});

describe("what an incoming link is", () => {
  it("reads the PKCE code out of the query", () => {
    expect(parseAuthLink(new URL(NATIVE_AUTH_REDIRECT + "?code=abc123"))).toEqual({ kind: "code", code: "abc123" });
  });

  it("reads the older token_hash form too, because which one arrives is a project setting", () => {
    expect(parseAuthLink(new URL("jarvis://auth?token_hash=xyz&type=magiclink")))
      .toEqual({ kind: "otp", tokenHash: "xyz", type: "magiclink" });
    expect(parseAuthLink(new URL("jarvis://auth?token_hash=xyz&type=recovery")))
      .toEqual({ kind: "otp", tokenHash: "xyz", type: "recovery" });
  });

  it("reads the hash as well as the query, because the implicit flow uses it", () => {
    // A URL's hash is not part of its searchParams, which is exactly how a
    // link that works in one project silently does nothing in another.
    expect(parseAuthLink(new URL("jarvis://auth#code=fromhash"))).toEqual({ kind: "code", code: "fromhash" });
  });

  it("carries an error through instead of dropping it", () => {
    const r = parseAuthLink(new URL("jarvis://auth?error=access_denied&error_description=Email+link+is+invalid+or+has+expired"));
    expect(r).toEqual({ kind: "error", message: "That link has expired · Ask for a new one" });
  });

  it("is not confused by a URL that is some other deep link", () => {
    expect(parseAuthLink(new URL("jarvis://task/7"))).toBeNull();
  });
});

describe("redeeming it", () => {
  it("exchanges a code with the client that is actually running", async () => {
    const c = client();
    expect(await redeemAuthLink(new URL("jarvis://auth?code=abc"), c)).toEqual({ ok: true });
    expect(c.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("verifies a token hash with its type, so a recovery link stays a recovery", async () => {
    // The type is what makes AuthProvider raise PASSWORD_RECOVERY and show
    // the Set a New Password screen instead of the app (SHELL-F-04).
    const c = client();
    await redeemAuthLink(new URL("jarvis://auth?token_hash=t&type=recovery"), c);
    expect(c.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "t", type: "recovery" });
  });

  it("says what went wrong in words a person can act on", async () => {
    const c = client({ exchangeCodeForSession: vi.fn(async () => ({ error: { message: "Token has expired or is invalid" } })) });
    expect(await redeemAuthLink(new URL("jarvis://auth?code=old"), c))
      .toEqual({ ok: false, message: "That link has expired · Ask for a new one" });
  });

  it("never throws at the caller, whatever the client does", async () => {
    const c = client({ exchangeCodeForSession: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await redeemAuthLink(new URL("jarvis://auth?code=x"), c)).toEqual({ ok: false, message: "offline" });
  });

  it("answers null for a URL that is not an auth link, so other handlers still see it", async () => {
    expect(await redeemAuthLink(new URL("jarvis://task/7"), client())).toBeNull();
  });
});

describe("on the bus", () => {
  it("claims an auth link and passes on everything else", async () => {
    const c = client();
    startAuthLinks(c);
    expect(await deliverAppUrl("jarvis://auth?code=abc")).toBe(true);
    expect(await deliverAppUrl("jarvis://task/7")).toBe(false);
  });

  it("tells somebody when a link fails, rather than swallowing the tap", async () => {
    const said: string[] = [];
    startAuthLinks(client({ exchangeCodeForSession: vi.fn(async () => ({ error: { message: "Email link is invalid or has expired" } })) }), (m) => said.push(m));
    await deliverAppUrl("jarvis://auth?code=old");
    expect(said).toEqual(["That link has expired · Ask for a new one"]);
  });

  it("stops listening when it is asked to", async () => {
    const c = client();
    const stop = startAuthLinks(c);
    stop();
    expect(await deliverAppUrl("jarvis://auth?code=abc")).toBe(false);
    expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("the words on a failed link", () => {
  it("turns Supabase's own sentences into an instruction", () => {
    expect(humanAuthError("Email link is invalid or has expired")).toBe("That link has expired · Ask for a new one");
    expect(humanAuthError("Token+has+already+been+used")).toBe("That link has been used already · Ask for a new one");
    // Anything unrecognised is passed through rather than replaced by a
    // vaguer sentence of our own.
    expect(humanAuthError("Signups not allowed for otp")).toBe("Signups not allowed for otp");
  });
});
