import { describe, it, expect, beforeEach } from "vitest";
import {
  reverseClientId, nativeRedirectUri, buildAuthUrl, parseAuthCallback,
  challengeOf, randomUrlSafe, requestGoogleCodeNative,
} from "./nativeAuth";
import { onAppUrl, deliverAppUrl, resetAppUrlForTest } from "../../native/appUrl";
import { GOOGLE_SCOPES } from "./config";

// UP-LAUNCH-12 (2026-09-05). The native first-connect, tested everywhere it
// can be: the URL that goes out, the callback that comes back, and the state
// check between them. The one part no test can reach is the system sheet
// itself, so it is injected.

const CLIENT = "123-abc.apps.googleusercontent.com";

beforeEach(() => { resetAppUrlForTest(); });

// The flow hashes the verifier before it opens anything. That hash runs off
// the main thread, so no fixed wait is guaranteed to outlast it: a single
// setTimeout(0) was enough on a quiet laptop and not on a loaded CI runner,
// where the sheet had not opened yet, the test read opened[0] as undefined,
// and the late flow then subscribed after the next test's reset and answered
// its URL. Tests wait for the sheet itself (rig().opening) instead.

describe("the iOS client's own scheme", () => {
  it("reverses the client id, which is both the redirect and the URL scheme", () => {
    expect(reverseClientId(CLIENT)).toBe("com.googleusercontent.apps.123-abc");
    expect(nativeRedirectUri(CLIENT)).toBe("com.googleusercontent.apps.123-abc:/oauth2redirect");
  });

  it("says nothing at all for a client id that is not one", () => {
    // An empty redirect is what makes nativeGoogleAvailable false, so a
    // half-configured build falls back to the web flow instead of opening a
    // sheet that can never come back.
    for (const bad of ["", "not-a-client", "123-abc.apps.google.com"]) {
      expect(reverseClientId(bad)).toBe("");
      expect(nativeRedirectUri(bad)).toBe("");
    }
  });
});

describe("the authorization URL", () => {
  const url = () => new URL(buildAuthUrl({
    clientId: CLIENT, redirectUri: nativeRedirectUri(CLIENT), challenge: "chal", state: "st",
  }));

  it("asks Google for a code with PKCE and no secret", () => {
    const u = url();
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe(CLIENT);
    expect(u.searchParams.has("client_secret")).toBe(false);
  });

  it("asks for exactly the scopes the web asks for, and offline access", () => {
    // A native connect that authorized fewer scopes than the web one would
    // silently break Email on the phone and nowhere else.
    expect(url().searchParams.get("scope")).toBe(GOOGLE_SCOPES);
    expect(url().searchParams.get("access_type")).toBe("offline");
    expect(url().searchParams.get("prompt")).toBe("consent");
  });

  it("forces the chooser only when a new account is being added", () => {
    const add = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: "x:/y", challenge: "c", state: "s", selectAccount: true }));
    expect(add.searchParams.get("prompt")).toBe("select_account consent");
    const back = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: "x:/y", challenge: "c", state: "s", loginHint: "a@b.com" }));
    expect(back.searchParams.get("login_hint")).toBe("a@b.com");
  });
});

describe("the callback", () => {
  it("returns the code when the state matches the sign-in this app started", () => {
    const u = new URL("com.googleusercontent.apps.123-abc:/oauth2redirect?code=xyz&state=st");
    expect(parseAuthCallback(u, "st")).toEqual({ code: "xyz" });
  });

  it("refuses a code whose state does not match, which is the whole point of state", () => {
    // Anything on the phone can open a URL. Without this check, somebody
    // else's authorization code could be handed to the app and their Gmail
    // would end up connected to this JARVIS account.
    const u = new URL("com.googleusercontent.apps.123-abc:/oauth2redirect?code=xyz&state=theirs");
    expect(parseAuthCallback(u, "mine")).toEqual({ error: "That sign-in did not match this one" });
    expect(parseAuthCallback(u, "")).toEqual({ error: "That sign-in did not match this one" });
  });

  it("says cancelled in words when the person backs out", () => {
    const u = new URL("com.googleusercontent.apps.123-abc:/oauth2redirect?error=access_denied&state=st");
    expect(parseAuthCallback(u, "st")).toEqual({ error: "Sign-in cancelled" });
  });

  it("ignores a URL that is not an OAuth callback at all", () => {
    // Deep links share this bus with the sign-in, so "not mine" has to be a
    // real answer rather than an error.
    expect(parseAuthCallback(new URL("jarvis://task/123"), "st")).toBeNull();
  });
});

describe("PKCE", () => {
  it("makes a verifier long enough to be one, and a fresh one every time", () => {
    const a = randomUrlSafe();
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomUrlSafe());
  });

  it("challenges with the base64url of the SHA-256, per the spec", async () => {
    // The known answer from RFC 7636's own example.
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("the whole native connect", () => {
  function rig(overrides: { failOpen?: boolean } = {}) {
    const opened: string[] = [];
    let closed = 0;
    let timerFired: (() => void) | null = null;
    let markOpen: () => void = () => {};
    // Resolves once the sheet is open, which is after the hash, the
    // subscription and the timer: everything a test goes on to poke.
    const opening = new Promise<void>((res) => { markOpen = res; });
    return {
      opened,
      opening,
      closedCount: () => closed,
      fireTimer: () => timerFired?.(),
      deps: {
        // The client id is passed rather than read from the build env, the
        // same way config.ts's googleConfigured takes the web one.
        clientId: CLIENT,
        open: async (u: string) => { if (overrides.failOpen) throw new Error("no pod"); opened.push(u); markOpen(); },
        close: async () => { closed += 1; },
        subscribe: onAppUrl,
        setTimer: (fn: () => void) => { timerFired = fn; return 1; },
        clearTimer: () => { timerFired = null; },
      },
    };
  }

  it("opens the sheet, takes the code from the callback, and closes it", async () => {
    const r = rig();
    const p = requestGoogleCodeNative({}, r.deps);
    await r.opening;
    expect(r.opened).toHaveLength(1);
    const state = new URL(r.opened[0]!).searchParams.get("state")!;
    await deliverAppUrl(`com.googleusercontent.apps.123-abc:/oauth2redirect?code=the-code&state=${state}`);
    const out = await p;
    expect(out.code).toBe("the-code");
    expect(out.verifier).toHaveLength(64);
    expect(r.closedCount()).toBe(1);
  });

  it("a sheet swiped away gives up instead of spinning forever", async () => {
    const r = rig();
    const p = requestGoogleCodeNative({}, r.deps);
    await r.opening;
    r.fireTimer();
    await expect(p).rejects.toThrow(/timed out/);
  });

  it("says so when there is no browser plugin in the build", async () => {
    const r = rig({ failOpen: true });
    await expect(requestGoogleCodeNative({}, r.deps)).rejects.toThrow(/Could not open/);
  });

  it("leaves other deep links alone while it waits", async () => {
    const r = rig();
    const p = requestGoogleCodeNative({}, r.deps);
    await r.opening;
    const seen: string[] = [];
    // A realistic second handler: it claims its own scheme and passes on
    // everything else, which is the contract every handler on this bus has.
    onAppUrl((u) => { if (u.protocol !== "jarvis:") return false; seen.push(u.href); return true; });
    await deliverAppUrl("jarvis://task/7");
    expect(seen).toEqual(["jarvis://task/7"]);
    const state = new URL(r.opened[0]!).searchParams.get("state")!;
    await deliverAppUrl(`com.googleusercontent.apps.123-abc:/oauth2redirect?code=c&state=${state}`);
    await expect(p).resolves.toMatchObject({ code: "c" });
  });

  it("unsubscribes when it is done, so a second sign-in is not answered by the first", async () => {
    const r = rig();
    const p = requestGoogleCodeNative({}, r.deps);
    await r.opening;
    const state = new URL(r.opened[0]!).searchParams.get("state")!;
    await deliverAppUrl(`com.googleusercontent.apps.123-abc:/oauth2redirect?code=one&state=${state}`);
    await p;
    // Nothing is listening now, so the same URL again is handled by nobody.
    expect(await deliverAppUrl(`com.googleusercontent.apps.123-abc:/oauth2redirect?code=two&state=${state}`)).toBe(false);
  });
});
