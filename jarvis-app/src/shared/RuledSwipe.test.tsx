// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import RuledSwipe from "./RuledSwipe";
import GoalRowRuled from "../bigger/GoalRowRuled";

// SWIPE IS THE STANDARD (Dave 2026-10-13: "Virtually everything should be swipeable"). The ruled row that steps, milestones and
// goals wear: right completes, left deletes, a hold is the menu, a tap opens.
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("RuledSwipe", () => {
  it("draws the Done rail and the Delete tray, and a tap opens", () => {
    const onOpen = vi.fn();
    const { container } = render(<RuledSwipe label="Call Marco" className="task-row p2" onRight={() => {}} onDelete={() => {}} onOpen={onOpen}><span>Call Marco</span></RuledSwipe>);
    expect(container.querySelector(".task-done-rail")).toHaveTextContent("Done");
    expect(screen.getByRole("button", { name: "Delete Call Marco" })).toBeInTheDocument();
    fireEvent.click(container.querySelector(".task-row") as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("the Delete button deletes, and a hold lists Done then Delete", () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    const onRight = vi.fn();
    const { container } = render(<RuledSwipe label="Call Marco" className="task-row p2" onRight={onRight} onDelete={onDelete}>x</RuledSwipe>);
    const row = container.querySelector(".task-row") as HTMLElement;
    fireEvent.mouseDown(row);
    act(() => { vi.advanceTimersByTime(700); });
    expect([...document.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["Done", "Delete", "Cancel"]);
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Done"));
    expect(onRight).toHaveBeenCalledTimes(1);
    fireEvent.mouseUp(row);
    fireEvent.click(screen.getByRole("button", { name: "Delete Call Marco" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a row with neither verb is the plain row it was", () => {
    const onOpen = vi.fn();
    const { container } = render(<RuledSwipe label="x" className="task-row p2" onOpen={onOpen}>x</RuledSwipe>);
    expect(container.querySelector(".task-swipe")).toBeNull();
    fireEvent.click(container.querySelector(".task-row") as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("GoalRowRuled swipe", () => {
  const goal = { title: "Run a Half", tone: "cat-fg-green", body: "", status: null, bar: null };
  it("swipes right to Achieved and left to Delete, and a tap still opens the goal", () => {
    const onAchieve = vi.fn(); const onDelete = vi.fn(); const onOpen = vi.fn();
    const { container } = render(<GoalRowRuled {...goal} onOpen={onOpen} onAchieve={onAchieve} onDelete={onDelete} />);
    expect(container.querySelector(".task-done-rail")).toHaveTextContent("Achieved");
    fireEvent.click(screen.getByRole("button", { name: "Delete Run a Half" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".goal-row-ruled") as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("a finished goal has no Achieved, and a goal with no writes does not move", () => {
    const fin = render(<GoalRowRuled {...goal} onOpen={() => {}} onDelete={() => {}} />);
    expect(fin.container.querySelector(".task-done-rail")).toBeNull();
    cleanup();
    const still = render(<GoalRowRuled {...goal} onOpen={() => {}} />);
    expect(still.container.querySelector(".task-swipe")).toBeNull();
  });
});
