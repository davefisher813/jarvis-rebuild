// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// THE WINDOW OPENS INSIDE THE TAP (2026-10-10). startGoogleCode asks Google for its window synchronously, says plainly when the
// browser refused it, treats a closed window as the person's choice, and never leaves a tap hanging.
vi.mock("./config", () => ({ googleClientId: () => "client-1", GOOGLE_SCOPES: "scope-a scope-b" }));

import { startGoogleCode, googleSignInReady } from "./gis";
import { ReconnectCancelled, SignInBlocked, SignInTimedOut } from "./reconnect";

type Cfg = { callback: (r: { code?: string; error?: string; state?: string }) => void; error_callback?: (e: { type?: string }) => void; state?: string };
let last: Cfg | null = null;
let requested = 0;
let throwOnRequest = false;

beforeEach(() => {
  last = null; requested = 0; throwOnRequest = false;
  (window as unknown as { google: unknown }).google = { accounts: { oauth2: {
    initCodeClient: (c: Cfg) => { last = c; return { requestCode: () => { if (throwOnRequest) throw new Error("blocked"); requested++; } }; },
    initTokenClient: () => ({ requestAccessToken: () => {} }),
  } } };
});
afterEach(() => { delete (window as unknown as { google?: unknown }).google; vi.useRealTimers(); });

describe("startGoogleCode", () => {
  it("is ready once the script is loaded, and asks for the window before it returns", async () => {
    expect(googleSignInReady()).toBe(true);
    const p = startGoogleCode({ loginHint: "dave@gmail.com" });
    expect(requested).toBe(1);
    last!.callback({ code: "c1" });
    expect(await p).toBe("c1");
  });

  it("a window the browser refused says so with the fix", async () => {
    const p = startGoogleCode({});
    last!.error_callback!({ type: "popup_failed_to_open" });
    await expect(p).rejects.toBeInstanceOf(SignInBlocked);
  });

  it("a window that could not even be asked for is the same refusal", async () => {
    throwOnRequest = true;
    await expect(startGoogleCode({})).rejects.toBeInstanceOf(SignInBlocked);
  });

  it("a closed window is the person's choice, not an error", async () => {
    const p = startGoogleCode({ reconnect: "dave@gmail.com", state: "s1" });
    last!.error_callback!({ type: "popup_closed" });
    await expect(p).rejects.toBeInstanceOf(ReconnectCancelled);
  });

  it("a window that never answers releases the tap", async () => {
    vi.useFakeTimers();
    const p = startGoogleCode({}, 1000);
    const caught = p.catch((e) => e);
    vi.advanceTimersByTime(1001);
    expect(await caught).toBeInstanceOf(SignInTimedOut);
    // An answer after the release changes nothing.
    last!.callback({ code: "late" });
  });

  it("a state that does not match is refused", async () => {
    const p = startGoogleCode({ state: "mine" });
    last!.callback({ code: "c", state: "theirs" });
    await expect(p).rejects.toThrow("That sign-in did not match this one");
  });
});
