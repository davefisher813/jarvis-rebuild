// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthProvider";

// S3-Q18 (2026-09-04): "there is no Forgot Password anywhere" and "there is
// no way to delete an account." AuthProvider had no test file before this
// one. Both new methods are proven directly against a mocked Supabase
// client: the real client is null in every test run (no env vars set), so
// without this mock neither method could be exercised at all.

const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const signInWithOAuth = vi.fn();
const signInWithIdToken = vi.fn();
const signInWithOtp = vi.fn();
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const flags = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
      signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a),
      signInWithIdToken: (...a: unknown[]) => signInWithIdToken(...a),
      signInWithOtp: (...a: unknown[]) => signInWithOtp(...a),
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
  },
}));

vi.mock("./providers", async (orig) => ({
  ...(await orig<typeof import("./providers")>()),
  providerFlags: () => flags(),
}));

function Harness({ onReady }: { onReady: (v: ReturnType<typeof useAuth>) => void }) {
  const v = useAuth();
  onReady(v);
  return null;
}

function renderAuth(): () => ReturnType<typeof useAuth> {
  let value!: ReturnType<typeof useAuth>;
  render(
    <AuthProvider>
      <Harness onReady={(v) => { value = v; }} />
    </AuthProvider>,
  );
  return () => value;
}

beforeEach(() => {
  sessionStorage.clear();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "tok123", user: { id: "u1" } } } });
  onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  resetPasswordForEmail.mockReset();
  updateUser.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  signInWithIdToken.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  signUp.mockReset().mockResolvedValue({ error: null, data: { session: { access_token: "t" } } });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  flags.mockReset().mockResolvedValue({ apple: true });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("sendPasswordReset", () => {
  it("calls Supabase's resetPasswordForEmail with the given address", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().sendPasswordReset("dave@example.com");
    // SHELL-F-04 (2026-09-05): with no redirectTo the link went to the
    // project's Site URL, which in the native build is not this app at all.
    // jsdom's origin is http://localhost:3000, a real http origin, so that is
    // what webOrigin() hands over here.
    expect(resetPasswordForEmail).toHaveBeenCalledWith("dave@example.com", { redirectTo: window.location.origin });
  });

  it("throws Supabase's own error rather than swallowing it", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: new Error("rate limited") });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().sendPasswordReset("dave@example.com")).rejects.toThrow("rate limited");
  });
});

// WHERE EVERY AUTH EMAIL AND REDIRECT LANDS (P0, 2026-10-04). A tester resetting
// her password tapped the link and Safari went to localhost: the project's
// Site URL was the default, and Supabase falls back to it whenever the
// redirect the app names is not on its allow list. The app already named the
// production origin; these hold that, and hold the two calls that did not
// (Apple on the web, sign-up) to the same rule. jsdom's origin is a real http
// origin, so webOrigin() hands it over here exactly as the browser does.
describe("every auth email and redirect names where it lands", () => {
  it("the magic link asks to land on this origin", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().signInWithEmail("tester@example.com");
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "tester@example.com", options: { emailRedirectTo: window.location.origin } });
  });

  it("the password reset asks to land on this origin", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().sendPasswordReset("tester@example.com");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("tester@example.com", { redirectTo: window.location.origin });
  });

  it("the sign-up confirmation asks to land on this origin", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().signUpWithPassword("tester@example.com", "secret1");
    expect(signUp).toHaveBeenCalledWith({ email: "tester@example.com", password: "secret1", options: { emailRedirectTo: window.location.origin } });
  });

  it("Apple on the web asks to land on this origin", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().signInWithApple();
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "apple", options: { redirectTo: window.location.origin } });
  });
});

describe("deleteAccount", () => {
  it("POSTs to the deployed account-delete endpoint with the session's bearer token, then signs out locally", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().deleteAccount();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/delete",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer tok123" } }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a failed delete throws a real, specific error and never signs out", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) });
    vi.stubGlobal("fetch", fetchMock);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().deleteAccount()).rejects.toThrow(/404/);
    expect(signOut).not.toHaveBeenCalled();
  });

  // SHELL-F-03 (2026-09-05): the endpoint says why in its own words when it
  // has any, and that sentence is what the Account screen shows. A server
  // that cannot delete (no service-role key) must not read as a generic
  // number the person can do nothing with.
  it("shows the server's own reason when it gives one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Account deletion is not configured on the server" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().deleteAccount()).rejects.toThrow("Account deletion is not configured on the server");
    expect(signOut).not.toHaveBeenCalled();
  });
});

// SHELL-F-04 (2026-09-05): "Forgot Password sends a link that has nowhere to
// land." The email arrived, the link opened the app in a browser, Supabase
// signed that browser in from the URL, and JARVIS showed the ordinary app
// with nowhere to type a new password: a locked-out person stayed locked out.
describe("password recovery", () => {
  const fireAuthEvent = (event: string) => {
    const cb = onAuthStateChange.mock.calls[0]![0] as (e: string, s: unknown) => void;
    act(() => cb(event, { access_token: "tok123", user: { id: "u1" } }));
  };

  it("raises recovery when Supabase says the session came from a reset link", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    expect(get().recovery).toBe(false);
    fireAuthEvent("PASSWORD_RECOVERY");
    await waitFor(() => expect(get().recovery).toBe(true));
  });

  it("an ordinary sign-in is not a recovery", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    fireAuthEvent("SIGNED_IN");
    expect(get().recovery).toBe(false);
  });

  it("setting the password writes it and ends the recovery", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    fireAuthEvent("PASSWORD_RECOVERY");
    await waitFor(() => expect(get().recovery).toBe(true));
    await act(async () => { await get().updatePassword("hunter2!"); });
    expect(updateUser).toHaveBeenCalledWith({ password: "hunter2!" });
    await waitFor(() => expect(get().recovery).toBe(false));
  });

  it("a save that fails keeps the screen that can still fix it", async () => {
    updateUser.mockResolvedValue({ error: new Error("weak password") });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    fireAuthEvent("PASSWORD_RECOVERY");
    await waitFor(() => expect(get().recovery).toBe(true));
    await expect(get().updatePassword("short")).rejects.toThrow("weak password");
    expect(get().recovery).toBe(true);
  });

  it("signing out ends the recovery too, for a link opened by mistake", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    fireAuthEvent("PASSWORD_RECOVERY");
    await waitFor(() => expect(get().recovery).toBe(true));
    await act(async () => { await get().signOut(); });
    await waitFor(() => expect(get().recovery).toBe(false));
  });
});

// ACCOUNT > CHANGE PASSWORD (2026-10-04, Dave). updateUser({ password }) works
// on any live session without the old password, so the old one is proven first
// by signing in with it, and nothing is written when that fails.
describe("changePassword", () => {
  const withEmail = (email: string | undefined) =>
    getSession.mockResolvedValue({ data: { session: { access_token: "tok123", user: { id: "u1", ...(email ? { email } : {}) } } } });

  it("checks the current password with the account's own email, then writes the new one", async () => {
    withEmail("dave@example.com");
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().changePassword("old-pass-1", "new-pass-2");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "dave@example.com", password: "old-pass-1" });
    expect(updateUser).toHaveBeenCalledWith({ password: "new-pass-2" });
    // The proof comes first: a write that ran before it would be the hole this closes.
    expect(signInWithPassword.mock.invocationCallOrder[0]!).toBeLessThan(updateUser.mock.invocationCallOrder[0]!);
  });

  it("a wrong current password throws Supabase's own refusal and writes nothing", async () => {
    withEmail("dave@example.com");
    signInWithPassword.mockResolvedValue({ error: Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials" }) });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().changePassword("wrong", "new-pass-2")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("a refusal to write the new password comes back as it was sent", async () => {
    withEmail("dave@example.com");
    updateUser.mockResolvedValue({ error: Object.assign(new Error("same"), { code: "same_password" }) });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().changePassword("old-pass-1", "old-pass-1")).rejects.toMatchObject({ code: "same_password" });
  });

  it("an account with no email has nothing to check against, and says so", async () => {
    withEmail(undefined);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().changePassword("old-pass-1", "new-pass-2")).rejects.toThrow(/no email/);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

// THE RECOVERY WINDOW SURVIVES A RELOAD (P0, 2026-10-04). On a first visit the
// service worker's first claim used to reload the page about three seconds
// after a reset link landed, and the in-memory flag went with it: the person
// was signed in by the recovery session and shown the ordinary app, with no
// place to set the new password.
describe("the recovery window survives a reload", () => {
  const KEY = "jarvis.auth.recovery.v1";
  beforeEach(() => { sessionStorage.removeItem(KEY); });
  const fireAuthEvent = (event: string) => {
    const cb = onAuthStateChange.mock.calls[0]![0] as (e: string, s: unknown) => void;
    act(() => cb(event, { access_token: "tok123", user: { id: "u1" } }));
  };

  it("the landing is remembered by the tab", async () => {
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    fireAuthEvent("PASSWORD_RECOVERY");
    await waitFor(() => expect(get().recovery).toBe(true));
    expect(sessionStorage.getItem(KEY)).toBe("1");
  });

  it("a reload after the landing still shows the new-password screen", async () => {
    sessionStorage.setItem(KEY, "1");
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    expect(get().recovery).toBe(true);
  });

  it("a remembered recovery with no session behind it is dropped", async () => {
    sessionStorage.setItem(KEY, "1");
    getSession.mockResolvedValue({ data: { session: null } });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    expect(get().recovery).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("saving the new password forgets it", async () => {
    sessionStorage.setItem(KEY, "1");
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await act(async () => { await get().updatePassword("hunter2!"); });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(get().recovery).toBe(false);
  });

  it("a failed save keeps it, so the person can try again after a reload", async () => {
    sessionStorage.setItem(KEY, "1");
    updateUser.mockResolvedValue({ error: new Error("weak password") });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().updatePassword("short")).rejects.toThrow("weak password");
    expect(sessionStorage.getItem(KEY)).toBe("1");
  });

  it("signing out forgets it", async () => {
    sessionStorage.setItem(KEY, "1");
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await act(async () => { await get().signOut(); });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(get().recovery).toBe(false);
  });
});

// SHELL-F-10 (2026-09-05): "Sign out leaves the previous account's device
// data for the next sign-in." Dave signs out, a family member signs in on
// the same phone, and Quick Capture lists Dave's last ten capture titles.
describe("signOut clears the device", () => {
  it("takes the last person's captures, searches and mail rules with it", async () => {
    localStorage.setItem("jarvis.captures.v1", "x");
    localStorage.setItem("jarvis.recent-searches", "x");
    localStorage.setItem("jarvis.mail.vip.v1", "x");
    localStorage.setItem("jarvis.music.v1", "x");
    // Unsent work stays: it is not identity, and losing it is the bug
    // S3-Q17 closed.
    localStorage.setItem("jarvis.mail.outbox.v1", "x");

    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await act(async () => { await get().signOut(); });

    expect(localStorage.getItem("jarvis.captures.v1")).toBeNull();
    expect(localStorage.getItem("jarvis.recent-searches")).toBeNull();
    expect(localStorage.getItem("jarvis.mail.vip.v1")).toBeNull();
    expect(localStorage.getItem("jarvis.music.v1")).toBeNull();
    expect(localStorage.getItem("jarvis.mail.outbox.v1")).toBe("x");
  });
});

// DEMO WEEK (Dave 2026-10-01): the web Apple path REDIRECTS the browser to the
// backend. With Apple not switched on, that lands the person on a raw Supabase
// JSON error page that no code of ours can catch, so the provider is checked
// FIRST and the redirect never starts.
describe("signInWithApple when the backend has not switched Apple on", () => {
  it("never starts the redirect, and says what to do instead", async () => {
    flags.mockResolvedValue({ apple: false, email: true });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().signInWithApple()).rejects.toThrow("Apple sign-in is not switched on yet · Use email instead");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("an unknown answer counts as not switched on", async () => {
    flags.mockResolvedValue(null);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().signInWithApple()).rejects.toThrow(/not switched on yet/);
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("once it is switched on, the redirect starts as before", async () => {
    flags.mockResolvedValue({ apple: true });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().signInWithApple();
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "apple", options: { redirectTo: window.location.origin } });
  });

  it("a raw Unsupported provider error from the backend is never passed on", async () => {
    flags.mockResolvedValue({ apple: true });
    signInWithOAuth.mockResolvedValue({ error: { message: "Unsupported provider: provider is not enabled" } });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().signInWithApple()).rejects.toThrow("Apple sign-in is not switched on yet · Use email instead");
  });
});
