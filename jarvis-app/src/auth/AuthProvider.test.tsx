// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthProvider";

// S3-Q18 (2026-09-04): "there is no Forgot Password anywhere" and "there is
// no way to delete an account." AuthProvider had no test file before this
// one. Both new methods are proven directly against a mocked Supabase
// client: the real client is null in every test run (no env vars set), so
// without this mock neither method could be exercised at all.

const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const resetPasswordForEmail = vi.fn();
const signOut = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
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
  signOut.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("sendPasswordReset", () => {
  it("calls Supabase's resetPasswordForEmail with the given address", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await get().sendPasswordReset("dave@example.com");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("dave@example.com");
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve("no such endpoint") });
    vi.stubGlobal("fetch", fetchMock);
    const get = renderAuth();
    await waitFor(() => expect(get().ready).toBe(true));
    await expect(get().deleteAccount()).rejects.toThrow(/404/);
    expect(signOut).not.toHaveBeenCalled();
  });
});
