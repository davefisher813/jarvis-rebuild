// @vitest-environment jsdom
// The admin probe (slice 09 QA, 2026-10-04): only the server's own 401 or 403
// is a no. A dropped connection or a 5xx is asked again, then reported as an
// error the Admin screen can retry, instead of stranding the owner on "Not
// Authorized" with the AI Allowed switches out of reach.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../data/NotesProvider", () => ({ useAccessToken: () => "tok" }));
import { useAdminProbe } from "./useIsAdmin";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

function answer(...statuses: (number | "drop")[]) {
  const calls: string[] = [];
  let i = 0;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    calls.push(String(url));
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s === "drop") throw new TypeError("network");
    return new Response("{}", { status: s });
  }) as typeof fetch;
  return calls;
}

describe("useAdminProbe", () => {
  it("a 200 is a yes", async () => {
    answer(200);
    const { result } = renderHook(() => useAdminProbe());
    expect(result.current.state).toBe("checking");
    await waitFor(() => expect(result.current.state).toBe("yes"));
  });

  it("a 403 is a no, asked once", async () => {
    const calls = answer(403);
    const { result } = renderHook(() => useAdminProbe());
    await waitFor(() => expect(result.current.state).toBe("no"));
    expect(calls).toHaveLength(1);
  });

  it("a 502 then a 200 is a yes after one retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = answer(502, 200);
    const { result } = renderHook(() => useAdminProbe());
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await waitFor(() => expect(result.current.state).toBe("yes"));
    expect(calls).toHaveLength(2);
  });

  it("three dropped connections are an error, and recheck asks again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = answer("drop", "drop", "drop", 200);
    const { result } = renderHook(() => useAdminProbe());
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(calls).toHaveLength(3);
    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.state).toBe("yes"));
    expect(calls).toHaveLength(4);
  });
});
