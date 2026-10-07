// @vitest-environment jsdom
// THE APP'S ONE READ OF A CONNECTION'S STATUS (Foundation Fix Spec 1). Held
// here: it asks the one endpoint with the person's own session, it keeps the
// last answer so an offline device shows the last KNOWN status instead of a
// fresh invented one, it never shows another person's answer, and the worst
// account is what a surface leads with.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { summarize, useConnectionStatus } from "./useConnectionStatus";
import { deriveStatus, type AccountStatus, type StatusResponse } from "./connectionStatus";

const NOW = new Date();
const mk = (email: string, o: Partial<Parameters<typeof deriveStatus>[0]> = {}): AccountStatus =>
  deriveStatus({ email, refresh: { ok: true, scope: "gmail.send" }, read: { ok: true, status: 200, emailAddress: email }, lastSyncAt: new Date(NOW.getTime() - 60e3).toISOString(), now: NOW, ...o });
const answer = (...accounts: AccountStatus[]): StatusResponse => ({ checkedAt: NOW.toISOString(), accounts });

const okFetch = (a: StatusResponse) => vi.fn(async () => ({ ok: true, status: 200, json: async () => a }) as Response);

beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { vi.restoreAllMocks(); });

describe("summarize", () => {
  it("leads with the worst account, and offers Reconnect only for a confirmed auth loss", () => {
    const good = mk("a@x.com");
    const limited = mk("b@x.com", { read: { ok: false, status: 429 } });
    const revoked = mk("c@x.com", { refresh: { ok: false, error: "invalid_grant" }, read: null });
    const s = summarize(answer(good, limited, revoked), NOW, true);
    expect(s.worst?.account.email).toBe("c@x.com");
    expect(s.needsReconnect).toBe(true);
    const calm = summarize(answer(good, limited), NOW, true);
    expect(calm.worst?.account.email).toBe("b@x.com");
    expect(calm.needsReconnect).toBe(false);
    expect(summarize(answer(good), NOW, true).worst).toBeNull();
  });

  it("an offline device has no connected accounts, only the last known status", () => {
    const s = summarize(answer(mk("a@x.com")), NOW, false);
    expect(s.worst?.view.state).toBe("offline");
    expect(s.needsReconnect).toBe(false);
  });
});

describe("useConnectionStatus", () => {
  it("asks the endpoint with the session's own Bearer and keeps the answer", async () => {
    const f = okFetch(answer(mk("a@x.com")));
    const { result } = renderHook(() => useConnectionStatus("jwt-1", "user-1", f as unknown as typeof fetch));
    await waitFor(() => expect(result.current.answer?.accounts).toHaveLength(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/connections/status");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(result.current.worst).toBeNull();
    expect(localStorage.getItem("jarvis.connections.status.v1")).toContain("a@x.com");
  });

  it("with no session it asks nothing and shows nothing", async () => {
    const f = okFetch(answer(mk("a@x.com")));
    const { result } = renderHook(() => useConnectionStatus(null, null, f as unknown as typeof fetch));
    await act(async () => { await Promise.resolve(); });
    expect(f).not.toHaveBeenCalled();
    expect(result.current.answer).toBeNull();
  });

  it("a failed or malformed read leaves the last answer alone and never invents one", async () => {
    const good = okFetch(answer(mk("a@x.com")));
    const first = renderHook(() => useConnectionStatus("jwt", "user-1", good as unknown as typeof fetch));
    await waitFor(() => expect(first.result.current.answer).not.toBeNull());
    first.unmount();
    const down = vi.fn(async () => { throw new Error("offline"); });
    const second = renderHook(() => useConnectionStatus("jwt", "user-1", down as unknown as typeof fetch));
    await act(async () => { await Promise.resolve(); });
    expect(second.result.current.answer?.accounts[0]?.email).toBe("a@x.com");
    const junk = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }) as Response);
    const third = renderHook(() => useConnectionStatus("jwt", "user-1", junk as unknown as typeof fetch));
    await act(async () => { await Promise.resolve(); });
    expect(third.result.current.answer?.accounts[0]?.email).toBe("a@x.com");
  });

  it("another person's stored answer is never shown", async () => {
    localStorage.setItem("jarvis.connections.status.v1", JSON.stringify({ userId: "someone-else", answer: answer(mk("theirs@x.com")) }));
    const f = vi.fn(async () => { throw new Error("offline"); });
    const { result } = renderHook(() => useConnectionStatus("jwt", "user-1", f as unknown as typeof fetch));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.answer).toBeNull();
  });

  it("offline, it does not ask, and says it is showing the last known status", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    localStorage.setItem("jarvis.connections.status.v1", JSON.stringify({ userId: "user-1", answer: answer(mk("a@x.com")) }));
    const f = okFetch(answer(mk("a@x.com")));
    const { result } = renderHook(() => useConnectionStatus("jwt", "user-1", f as unknown as typeof fetch));
    await act(async () => { await Promise.resolve(); });
    expect(f).not.toHaveBeenCalled();
    expect(result.current.online).toBe(false);
    expect(result.current.worst?.view).toMatchObject({ state: "offline", detail: "Offline · Showing the Last Known Status" });
  });
});
