// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDayKey } from "./useDayKey";

// TODAY-F-02 (2026-09-05): Today's once-per-open work is keyed to mount, and
// nothing remounted it when the date changed underneath. This key is what
// makes the day part of the component's identity.

describe("useDayKey", () => {
  afterEach(() => vi.useRealTimers());

  const at = (y: number, m: number, d: number, h: number, min: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(y, m, d, h, min));
  };

  it("holds steady through the day", () => {
    at(2026, 8, 5, 9, 0);
    const { result } = renderHook(() => useDayKey());
    const first = result.current;
    act(() => { vi.setSystemTime(new Date(2026, 8, 5, 23, 30)); vi.advanceTimersByTime(60_000); });
    expect(result.current).toBe(first);
  });

  it("changes when the clock crosses midnight with the app still open", () => {
    at(2026, 8, 5, 23, 59);
    const { result } = renderHook(() => useDayKey());
    expect(result.current).toBe("2026-09-05");
    act(() => { vi.setSystemTime(new Date(2026, 8, 6, 0, 1)); vi.advanceTimersByTime(60_000); });
    expect(result.current).toBe("2026-09-06");
  });

  it("changes the moment a phone that slept overnight comes back", () => {
    at(2026, 8, 5, 23, 0);
    const { result } = renderHook(() => useDayKey());
    act(() => {
      vi.setSystemTime(new Date(2026, 8, 6, 7, 30));
      // No timer tick: the tab was hidden, so this is the foreground event.
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe("2026-09-06");
  });
});
