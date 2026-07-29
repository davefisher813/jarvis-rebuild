// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePushDepth } from "./pushNav";

afterEach(() => vi.useRealTimers());

describe("usePushDepth", () => {
  it("no animation on first mount, whatever the depth (tab switches stay instant)", () => {
    expect(renderHook(() => usePushDepth(0)).result.current).toBe("");
    expect(renderHook(() => usePushDepth(2)).result.current).toBe("");
  });

  it("going deeper pushes, coming back pops", () => {
    const { result, rerender } = renderHook(({ d }) => usePushDepth(d), { initialProps: { d: 0 } });
    rerender({ d: 1 });
    expect(result.current).toBe("screen-push");
    rerender({ d: 0 });
    expect(result.current).toBe("screen-pop");
  });

  it("skipping levels still reads direction correctly (admin back to settings)", () => {
    const { result, rerender } = renderHook(({ d }) => usePushDepth(d), { initialProps: { d: 3 } });
    rerender({ d: 1 });
    expect(result.current).toBe("screen-pop");
  });

  it("clears the class after the animation so later remounts stay still", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ d }) => usePushDepth(d), { initialProps: { d: 0 } });
    rerender({ d: 1 });
    expect(result.current).toBe("screen-push");
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe("");
  });

  it("equal-depth swaps do not animate (sibling screens at the same level)", () => {
    const { result, rerender } = renderHook(({ d }) => usePushDepth(d), { initialProps: { d: 1 } });
    rerender({ d: 1 });
    expect(result.current).toBe("");
  });
});
