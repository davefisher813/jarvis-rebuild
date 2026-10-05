// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SchedulePage from "./SchedulePage";
import LockedRow from "./LockedRow";
import SkippedBlocks from "./SkippedBlocks";
import { protectedRangesOn, DEFAULT_ROUTINE, type RoutineData } from "../../routine/types";
import { retimeBlockOn, skipBlockOn } from "../../routine/blockAdjust";

// JUST THIS DAY (2026-10-01): the day timeline reads the resolved time, says
// when the day carries an exception, and keeps a skipped block reachable.
const DAY = "2026-10-01";
const OTHER = "2026-10-02";
const rule: RoutineData = {
  ...DEFAULT_ROUTINE,
  protectedBlocks: [{ id: "bf", label: "Breakfast", startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6], kind: "meal" }],
};
const page = (selected: string, routine: RoutineData, extra: Record<string, unknown> = {}) => (
  <SchedulePage
    year={2026} month={9} selected={selected} todayDate={DAY} dots={{}} dayEvents={[]} mode="day"
    locked={protectedRangesOn(routine, selected)}
    skippedBlocks={protectedRangesOn(routine, selected, { withSkipped: true }).filter((r) => r.skipped)}
    windowStartMin={7 * 60} windowEndMin={21 * 60}
    {...extra}
  />
);

describe("the day timeline", () => {
  it("shows the block at its usual time when the day has no exception", () => {
    const { container } = render(page(DAY, rule));
    const row = container.querySelector(".sched-locked")!;
    expect(row.querySelector(".sched-time")!.textContent).toBe("9:30AM");
    expect(row.textContent).not.toContain("Just Today");
  });

  it("shows a retimed block at its day time, says Just Today, and leaves other days alone", () => {
    const moved = retimeBlockOn(rule, "bf", DAY, 11 * 60, 12 * 60)!;
    const here = render(page(DAY, moved));
    const row = here.container.querySelector(".sched-locked")!;
    expect(row.querySelector(".sched-time")!.textContent).toBe("11:00AM");
    expect(row.textContent).toContain("Just Today");
    here.unmount();
    const there = render(page(OTHER, moved));
    expect(there.container.querySelector(".sched-locked .sched-time")!.textContent).toBe("9:30AM");
    expect(there.container.textContent).not.toContain("Just Today");
  });

  it("a skipped block leaves the timeline and stays reachable with Back to Normal", () => {
    const skipped = skipBlockOn(rule, "bf", DAY)!;
    const onBack = vi.fn();
    const { container } = render(page(DAY, skipped, { onBackToNormal: onBack }));
    expect(container.querySelector(".sched-locked")).toBeNull();
    expect(screen.getByText(/Skipped Today/)).toBeInTheDocument();
    // THE CATALOG (Dave 2026-10-05): the state word carries no dot of its own;
    // the separator is its own span (R6).
    expect(container.querySelector(".skipped-w")!.textContent).toBe("Skipped Today");
    expect(container.querySelector(".skipped-t > .sched-sep")).not.toBeNull();
    fireEvent.click(screen.getByText("Back to Normal"));
    expect(onBack).toHaveBeenCalledWith("bf");
  });
});

describe("LockedRow", () => {
  const l = { s: 660, e: 720, label: "Breakfast", id: "bf", kind: "meal", justToday: true };

  it("offers Back to Normal on a row with an exception, and the tap does not open the row", () => {
    const onBack = vi.fn();
    const onOpen = vi.fn();
    render(<LockedRow l={l} past={false} onOpen={onOpen} onBackToNormal={onBack} />);
    fireEvent.click(screen.getByText("Back to Normal"));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a row without an exception says nothing and offers nothing", () => {
    render(<LockedRow l={{ ...l, justToday: false }} past={false} onOpen={() => {}} onBackToNormal={() => {}} />);
    expect(screen.queryByText("Just Today")).toBeNull();
    expect(screen.queryByText("Back to Normal")).toBeNull();
  });
});

describe("SkippedBlocks", () => {
  it("renders nothing when nothing is skipped", () => {
    const { container } = render(<SkippedBlocks blocks={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
