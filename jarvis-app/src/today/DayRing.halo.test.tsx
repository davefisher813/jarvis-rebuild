// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DayRing from "./DayRing";

// PREMIUM FEEL (2026-10-10): the day ring's halo is the moment the last due
// task is ticked, once. A day already finished shows the full ring at rest on
// every later visit; content never re-animates on a tab visit.

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("DayRing: the halo plays on the tick that fills it, and only then", () => {
  it("opening Today on a finished day shows the full ring still", () => {
    const { container } = render(<DayRing done={3} total={3} />);
    const ring = container.querySelector(".dring")!;
    expect(ring).toHaveClass("done");
    expect(ring).not.toHaveClass("just-full");
    expect(container.querySelector(".burst"), "no confetti span either").toBeNull();
  });

  it("the tick that fills the ring plays the halo once, and it leaves", () => {
    const { container, rerender } = render(<DayRing done={2} total={3} />);
    expect(container.querySelector(".dring")).not.toHaveClass("just-full");
    rerender(<DayRing done={3} total={3} />);
    expect(container.querySelector(".dring")).toHaveClass("done", "just-full");
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.querySelector(".dring")).not.toHaveClass("just-full");
    expect(container.querySelector(".dring")).toHaveClass("done");
  });

  it("the arc's share is set as a percentage, the type the registered --pct glides on", () => {
    const { container } = render(<DayRing done={1} total={4} />);
    expect((container.querySelector(".dring") as HTMLElement).style.getPropertyValue("--pct")).toBe("25%");
  });

  it("a day with nothing due draws nothing", () => {
    const { container } = render(<DayRing done={0} total={0} />);
    expect(container.firstChild).toBeNull();
  });
});
