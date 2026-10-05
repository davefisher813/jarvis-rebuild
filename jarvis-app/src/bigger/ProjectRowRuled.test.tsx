// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
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
    // AMENDED 2026-09-26 (pass-off): his typed step is SHOWN in Title Case.
    expect(row.querySelector(".r-next-v")?.textContent).toBe("Finalize Details");
    expect(row.querySelector(".goal-meter")?.textContent).toContain("3 of 4 Done");
    expect(row.querySelector(".gstat")?.textContent).toBe("On Track");
    expect(row.querySelector(".bp-bar")).toBeTruthy();
    expect(row.querySelector(".pp")).toBeNull();
  });

  // A row with nothing to say shows nothing (§AK): an unstarted project with
  // no status has no meter line at all, not an empty one.
  it("draws no meter line when there is no count, hold or status", () => {
    const { container } = render(<ProjectRowRuled {...base} meter="" status={null} bar={null} />);
    expect(container.querySelector(".goal-meter")).toBeNull();
    const held = render(<ProjectRowRuled {...base} meter="" status={null} bar={null} hold="On Hold Until Oct 3" />);
    expect(held.container.querySelector(".goal-meter")?.textContent).toContain("On Hold Until Oct 3");
  });

  // AMENDED 2026-10-05 (Dave, locked: "Clean rows, no pills anywhere"). Close is
  // not a capsule on the title's line any more. It is the row's swipe (left,
  // and right, which completes), a line in the long-press menu, and, because a
  // finished project's moment has come, one quiet word on the row.
  it("offers Close only when handed one: as the swipe, as one quiet word on the row, and never as a pill", () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<ProjectRowRuled {...base} status={{ text: "Done", tone: "good" }} onOpen={onOpen} onClose={onClose} />);
    expect(container.querySelector(".pill-act, .proj-close")).toBeNull();
    const ctx = container.querySelector(".row-ctx") as HTMLElement;
    expect(ctx).toHaveTextContent("Close");
    fireEvent.click(ctx);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    // The tray's first button is the same verb, and the rail behind a right swipe says it too.
    expect([...container.querySelectorAll(".task-swipe > button")].map((b) => b.textContent)).toEqual(["Close"]);
    fireEvent.click(container.querySelector(".task-verb")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".task-done-rail")).toHaveTextContent("Close");
    // With nothing to close there is no verb on the row at all.
    const plain = render(<ProjectRowRuled {...base} onOpen={onOpen} />);
    expect(plain.container.querySelector(".row-ctx, .task-verb")).toBeNull();
  });

  it("Move is the swipe when the work is not all done, and Close leads when it is", () => {
    const trayOf = (c: HTMLElement) => [...c.querySelectorAll(".task-swipe > button")].map((b) => b.textContent);
    const move = render(<ProjectRowRuled {...base} onOpen={() => {}} onHold={() => {}} />);
    expect(trayOf(move.container)).toEqual(["Move"]);
    expect(move.container.querySelector(".task-done-rail"), "nothing to complete").toBeNull();
    const both = render(<ProjectRowRuled {...base} onOpen={() => {}} onHold={() => {}} onClose={() => {}} />);
    expect(trayOf(both.container)).toEqual(["Close", "Move"]);
  });

  // A hold opens the menu: Close It and Move to Goal, the same two verbs.
  it("a hold opens the menu, and the tap that ends the hold does not open the project", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onHold = vi.fn();
    const { container } = render(<ProjectRowRuled {...base} onOpen={onOpen} onHold={onHold} />);
    const row = container.querySelector(".proj-row-ruled") as HTMLElement;
    // The held row is the swipe controller's own hold (useSwipe onLongPress, via shared/useRowMenu): a mouse hold is mousedown.
    fireEvent.mouseDown(row);
    act(() => { vi.advanceTimersByTime(700); });
    expect(Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent)).toEqual(["Move to Goal", "Cancel"]);
    fireEvent.click(screen.getByText("Move to Goal"));
    expect(onHold).toHaveBeenCalledTimes(1);
    fireEvent.mouseUp(row);
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
