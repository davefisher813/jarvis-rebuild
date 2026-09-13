// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import ProjectRowRuled from "./ProjectRowRuled";

// THE PROJECT ROW IS THE GOAL ROW (Dave 2026-09-13), and a hold on it moves
// the project to another goal without opening it ("do the suggestions as
// well").
afterEach(() => { cleanup(); vi.useRealTimers(); });

const base = {
  title: "Remodel Bridge Website",
  glyphTone: "cat-fg-blue",
  meter: "3 of 4 Done",
  status: { text: "On Track", tone: "good" as const },
  bar: { done: 3, total: 4, pct: 75 },
};

describe("ProjectRowRuled", () => {
  it("draws the goal row's anatomy: folder, NEXT, the count with its status, the bar, no pie", () => {
    const { container } = render(<ProjectRowRuled {...base} next="Finalize details" onOpen={() => {}} />);
    const row = container.querySelector(".proj-row-ruled") as HTMLElement;
    expect(row.classList.contains("goal-row-ruled")).toBe(true);
    expect(row.querySelector(".gm-slot")).toBeTruthy();
    expect(row.querySelector(".r-next-k")?.textContent).toBe("Next");
    expect(row.querySelector(".r-next-v")?.textContent).toBe("Finalize details");
    expect(row.querySelector(".goal-meter")?.textContent).toContain("3 of 4 Done");
    expect(row.querySelector(".gstat")?.textContent).toBe("On Track");
    expect(row.querySelector(".bp-bar")).toBeTruthy();
    expect(row.querySelector(".pp")).toBeNull();
  });

  it("offers Close only when handed one, on the title's line", () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<ProjectRowRuled {...base} status={{ text: "Done", tone: "good" }} onOpen={onOpen} onClose={onClose} />);
    const close = container.querySelector(".proj-line1 .proj-close") as HTMLElement;
    expect(close).toBeTruthy();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a hold asks to move it, and the tap that ends the hold does not open it", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onHold = vi.fn();
    const { container } = render(<ProjectRowRuled {...base} onOpen={onOpen} onHold={onHold} />);
    const row = container.querySelector(".proj-row-ruled") as HTMLElement;
    fireEvent.pointerDown(row, { pointerType: "mouse", clientX: 5, clientY: 5 });
    act(() => { vi.advanceTimersByTime(700); });
    expect(onHold).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("without a move, a tap simply opens the project", () => {
    const onOpen = vi.fn();
    const { container } = render(<ProjectRowRuled {...base} onOpen={onOpen} />);
    fireEvent.click(container.querySelector(".proj-row-ruled") as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
