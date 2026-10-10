// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import MoveHeadliner from "./MoveHeadliner";

// PREMIUM FEEL (Dave 2026-10-09, pass-off item 17): the first task on Today,
// Your Move, gets the same check-off every task row has. It used to hand the
// tap straight to onToggle, which dealt the next task into the row at once,
// so the one row Dave sees first had no moment at all.

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Your Move: the check-off lands before the next task is dealt", () => {
  it("a tap fills the box and marks the row just done, and writes the record once the moment has landed", () => {
    const onToggle = vi.fn();
    const { container, getByLabelText } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onToggle={onToggle} />);
    fireEvent.click(getByLabelText("Mark done"));
    expect(container.querySelector(".task-check")).toHaveClass("done");
    expect(container.querySelector(".row")).toHaveClass("just-done");
    expect(getByLabelText("Mark done")).toHaveAttribute("aria-checked", "true");
    expect(onToggle, "not yet: the tick is still drawing").not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".row")).not.toHaveClass("just-done");
  });

  it("a second tap during the moment completes nothing twice", () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onToggle={onToggle} />);
    fireEvent.click(getByLabelText("Mark done"));
    fireEvent.click(getByLabelText("Mark done"));
    act(() => { vi.advanceTimersByTime(1200); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("the write is never dropped: leaving the page mid-moment still completes the task", () => {
    const onToggle = vi.fn();
    const { getByLabelText, unmount } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onToggle={onToggle} />);
    fireEvent.click(getByLabelText("Mark done"));
    unmount();
    act(() => { vi.advanceTimersByTime(600); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("the stylesheet's check-off reaches this row: it is keyed on .just-done, not on .task-row alone", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "..", "styles", "components.css"), "utf8");
    expect(css).toMatch(/\.just-done \.task-check\.done::before \{\s*animation: checkDraw/);
  });
});
