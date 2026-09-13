// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setSessionOpen, isSessionOpen, useSessionOpen } from "./sessionChrome";

// Health Push B, H-11 / R8: the shell hides its chrome while a session is on
// screen, and finds out through this store.
afterEach(() => setSessionOpen(false));

describe("sessionChrome", () => {
  it("starts closed", () => {
    expect(isSessionOpen()).toBe(false);
  });
  it("a hook re-renders when the gym opens and closes a session", () => {
    const { result } = renderHook(() => useSessionOpen());
    expect(result.current).toBe(false);
    act(() => setSessionOpen(true));
    expect(result.current).toBe(true);
    act(() => setSessionOpen(false));
    expect(result.current).toBe(false);
  });
  it("setting the same value twice notifies nobody", () => {
    let renders = 0;
    renderHook(() => { renders++; return useSessionOpen(); });
    const before = renders;
    act(() => setSessionOpen(false));
    expect(renders).toBe(before);
  });
});
