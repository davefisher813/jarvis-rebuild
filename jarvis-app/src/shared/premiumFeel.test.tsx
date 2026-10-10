// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RollingNumber from "./RollingNumber";
import Payoff from "./Payoff";
import ToastHost from "./ToastHost";
import { showToast, hideToast } from "./toast";

// PREMIUM FEEL (Dave 2026-10-09, pass-off item 17): the shared reward and
// transition components. The stylesheet half is held by laws/motion.test.ts
// and encourage/celebrationForms.test.tsx; this is what the components do.

const html = document.documentElement;
let rafQueue: FrameRequestCallback[] = [];
const flushFrames = (at: number) => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb(at)); };

beforeEach(() => {
  delete html.dataset.motion;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafQueue = []; });
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); hideToast(); });

describe("RollingNumber: a change of a few rolls, a big change counts, Reduce Motion snaps", () => {
  it("a small rise rolls the new figure up into place, at once and with no tween", () => {
    const { container, rerender } = render(<RollingNumber value={4} />);
    expect(container.textContent).toBe("4");
    rerender(<RollingNumber value={5} />);
    const span = container.querySelector("span")!;
    expect(span.textContent, "the new value is there from the first frame").toBe("5");
    expect(span).toHaveClass("num-roll", "num-roll-up");
    expect(rafQueue.length, "nothing counts frame by frame").toBe(0);
  });

  it("a small fall rolls down, and the roll clears itself when it ends", () => {
    const { container, rerender } = render(<RollingNumber value={5} />);
    rerender(<RollingNumber value={4} />);
    const span = container.querySelector("span")!;
    expect(span).toHaveClass("num-roll-down");
    fireEvent.animationEnd(span);
    expect(container.querySelector("span")).not.toHaveClass("num-roll");
    expect(container.textContent).toBe("4");
  });

  it("a big change counts on a short ease-out and lands exactly, by 360 ms", () => {
    const { container, rerender } = render(<RollingNumber value={0} />);
    rerender(<RollingNumber value={1200} />);
    expect(container.querySelector(".num-roll")).toBeNull();
    act(() => flushFrames(120));
    const mid = Number(container.textContent!.replace(/,/g, ""));
    expect(mid).toBeGreaterThan(600); // expo out: most of the way early
    expect(mid).toBeLessThan(1200);
    act(() => flushFrames(360));
    expect(container.textContent).toBe("1,200");
    expect(rafQueue.length, "and stops").toBe(0);
  });

  it("a new value mid-count carries on from the figure on screen, never jumping back to where the count began", () => {
    const { container, rerender } = render(<RollingNumber value={0} />);
    rerender(<RollingNumber value={1200} />);
    act(() => flushFrames(120));
    const mid = Number(container.textContent!.replace(/,/g, ""));
    expect(mid).toBeGreaterThan(600);
    rerender(<RollingNumber value={1500} />);
    act(() => flushFrames(0)); // the new count's first frame (performance.now is pinned at 0)
    const next = Number(container.textContent!.replace(/,/g, ""));
    expect(next, "it never drops below where it was").toBeGreaterThanOrEqual(mid);
    act(() => flushFrames(360));
    expect(container.textContent).toBe("1,500");
  });

  it("the app's own Motion setting (Reduced) snaps, as the phone's does", () => {
    html.dataset.motion = "reduce";
    const { container, rerender } = render(<RollingNumber value={0} />);
    rerender(<RollingNumber value={3} />);
    expect(container.textContent).toBe("3");
    expect(container.querySelector(".num-roll")).toBeNull();
    rerender(<RollingNumber value={900} />);
    expect(container.textContent).toBe("900");
    expect(rafQueue.length).toBe(0);
  });
});

describe("Payoff: a refined moment, no praise word", () => {
  it("draws the green disc with its tick and leaves by Done, never Nice", () => {
    const { container } = render(<Payoff kind="project" title="Ship the App" line="3 Tasks" onDone={() => {}} />);
    const mark = container.querySelector(".payoff-mark")!;
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark.querySelector("svg.ic, .ic")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByText("Nice")).toBeNull();
    expect(container.querySelector(".payoff-burst"), "the empty dots box is gone").toBeNull();
  });
});

describe("ToastHost: every message arrives", () => {
  it("a second message is a fresh card, so its arrival plays again", () => {
    const { container } = render(<ToastHost />);
    act(() => showToast({ message: "Saved" }));
    const first = container.querySelector(".toast");
    expect(first).not.toBeNull();
    act(() => showToast({ message: "Moved to Tomorrow" }));
    const second = container.querySelector(".toast");
    expect(second?.textContent).toContain("Moved to Tomorrow");
    expect(second, "a new element, not the old one with new words").not.toBe(first);
  });
});
