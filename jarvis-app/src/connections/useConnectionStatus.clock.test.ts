// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { onDeviceClock, useConnectionStatus, summarize, ASK_DEADLINE_MS } from "./useConnectionStatus";
import { STATUS_STALE_MS, type AccountStatus, type StatusResponse } from "./connectionStatus";

// THE ROOT OF THE FALSE AMBER BANNER (Dave 2026-10-13): ages were the SERVER's clock judged against the phone's, an ask that never answered froze
// the last answer for good, and coming back from sleep showed the old answer's age until the next tick. These hold each one.
const acct = (checkedAt: string): AccountStatus => ({
  email: "dave@bffsa.org", auth_state: "valid", state: "connected", transient: null, lastSuccessfulRefreshAt: checkedAt, lastSuccessfulSyncAt: checkedAt,
  syncCoverage: null, lastError: null, lastErrorAt: null, sendReady: { ready: true, reason: "" }, delivery: { kind: "poll", liveness: "fresh" }, receipt: null, checkedAt,
}) as unknown as AccountStatus;

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("the answer is read on this device's clock", () => {
  it("a phone running twenty minutes fast still sees a fresh proof as fresh", () => {
    const serverNow = Date.parse("2026-10-13T20:00:00Z");
    const phoneNow = new Date(serverNow + 20 * 60e3);   // the phone's clock is fast
    const answer: StatusResponse = { checkedAt: new Date(serverNow).toISOString(), accounts: [acct(new Date(serverNow - 60e3).toISOString())] };
    const mine = onDeviceClock(answer, phoneNow.getTime());
    expect(summarize(mine, phoneNow, true).views.get("dave@bffsa.org")!.state).toBe("connected");
    // The same answer judged the old way would have been stale.
    expect(summarize(answer, phoneNow, true).views.get("dave@bffsa.org")!.state).toBe("stale");
  });
  it("keeps the proof's own age as the server saw it, and ages it by how long ago this device heard", () => {
    const heard = Date.parse("2026-10-13T20:00:00Z");
    const answer: StatusResponse = { checkedAt: "2026-10-13T12:00:00Z", accounts: [acct("2026-10-13T11:56:00Z")] }; // proven 4 minutes before it was sent
    const mine = onDeviceClock(answer, heard);
    expect(Date.parse(mine.accounts[0]!.checkedAt)).toBe(heard - 4 * 60e3);
    const later = new Date(heard + STATUS_STALE_MS);   // 4 + 15 minutes old
    expect(summarize(mine, later, true).views.get("dave@bffsa.org")!.state).toBe("stale");
  });
});

describe("an answer too old to trust is never what a banner is drawn from", () => {
  it("is `unconfirmed`, not `worst`", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const old: StatusResponse = { checkedAt: now.toISOString(), accounts: [acct(new Date(now.getTime() - STATUS_STALE_MS - 60e3).toISOString())] };
    const s = summarize(old, now, true);
    expect(s.unconfirmed).toBe(true);
    expect(s.worst).toBeNull();
  });
  it("a proven problem still is", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const bad = { ...acct(now.toISOString()), state: "pending_auth", auth_state: "revoked" } as unknown as AccountStatus;
    expect(summarize({ checkedAt: now.toISOString(), accounts: [bad] }, now, true).worst?.view.state).toBe("pending_auth");
  });
});

describe("the ask", () => {
  it("has a deadline, so one that never answers cannot freeze the status", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => { signal = init?.signal ?? undefined; init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); }));
    renderHook(() => useConnectionStatus("tok", "u1", hang as unknown as typeof fetch));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(hang).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ASK_DEADLINE_MS + 10); });
    expect(signal?.aborted).toBe(true);
    // And the guard let go: coming back asks again.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(hang.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("coming back to the app asks again, forced, at once", async () => {
    const calls: string[] = [];
    const ok = vi.fn(async (u: unknown) => { calls.push(String(u)); return ({ ok: true, status: 200, json: async () => ({ checkedAt: new Date().toISOString(), accounts: [acct(new Date().toISOString())] }) }) as Response; });
    const { result } = renderHook(() => useConnectionStatus("tok", "u1", ok as unknown as typeof fetch));
    await waitFor(() => expect(result.current.answer).not.toBeNull());
    const before = calls.length;
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(calls.at(-1)).toContain("refresh=1");
    expect(result.current.worst).toBeNull();
  });
});
