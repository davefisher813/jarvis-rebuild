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

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
  },
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
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "tok123", user: { id: "u1" } } } });
  onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  resetPasswordForEmail.mockReset();
  updateUser.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
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
